// Package cache provides an in-memory TTL cache with single-flight fetching
// and stale-on-error fallback, as required by docs/contracts/api.md: a cache
// miss storm costs at most one upstream request per key per TTL, and an
// upstream failure serves recent stale data rather than an error.
package cache

import (
	"context"
	"sync"
	"time"
)

// Result is the outcome of a Do call. Stale is true when the upstream fetch
// failed and a previously cached value within the stale window was served
// instead; Age is how old that value is (zero for a fresh upstream fetch).
type Result[T any] struct {
	Value T
	Stale bool
	Age   time.Duration
}

type entry[T any] struct {
	value    T
	storedAt time.Time
}

type call[T any] struct {
	done  chan struct{}
	value T
	err   error
}

// Cache holds values of a single type keyed by string. It is safe for
// concurrent use.
type Cache[T any] struct {
	ttl      time.Duration
	staleFor time.Duration
	now      func() time.Time

	mu        sync.Mutex
	items     map[string]entry[T]
	flights   map[string]*call[T]
	lastSweep time.Time
}

const sweepInterval = time.Minute

// New returns a cache whose entries are fresh for ttl and remain servable as
// stale-on-upstream-error until they are staleFor old.
func New[T any](ttl, staleFor time.Duration) *Cache[T] {
	return &Cache[T]{
		ttl:      ttl,
		staleFor: staleFor,
		now:      time.Now,
		items:    make(map[string]entry[T]),
		flights:  make(map[string]*call[T]),
	}
}

// SetClock replaces the cache's time source. It exists so callers can age
// entries deterministically in tests instead of sleeping out a TTL.
func (c *Cache[T]) SetClock(now func() time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = now
}

// Do returns the cached value for key if it is fresh. Otherwise exactly one
// caller per key runs fetch while the others wait for its result. If fetch
// fails and a cached value no older than staleFor exists, that value is
// returned with Stale set; otherwise the fetch error is returned.
func (c *Cache[T]) Do(ctx context.Context, key string, fetch func(context.Context) (T, error)) (Result[T], error) {
	if v, age, ok := c.fresh(key); ok {
		return Result[T]{Value: v, Age: age}, nil
	}

	fl, leader := c.join(key)
	if leader {
		fl.value, fl.err = fetch(ctx)
		c.finish(key, fl)
	} else {
		select {
		case <-fl.done:
		case <-ctx.Done():
			var zero Result[T]
			return zero, ctx.Err()
		}
	}

	if fl.err == nil {
		return Result[T]{Value: fl.value}, nil
	}
	if v, age, ok := c.stale(key); ok {
		return Result[T]{Value: v, Stale: true, Age: age}, nil
	}
	var zero Result[T]
	return zero, fl.err
}

func (c *Cache[T]) fresh(key string) (T, time.Duration, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	if !ok {
		var zero T
		return zero, 0, false
	}
	age := c.now().Sub(e.storedAt)
	if age >= c.ttl {
		var zero T
		return zero, 0, false
	}
	return e.value, age, true
}

func (c *Cache[T]) stale(key string) (T, time.Duration, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	if !ok {
		var zero T
		return zero, 0, false
	}
	age := c.now().Sub(e.storedAt)
	if age > c.staleFor {
		var zero T
		return zero, 0, false
	}
	return e.value, age, true
}

func (c *Cache[T]) join(key string) (*call[T], bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if fl, ok := c.flights[key]; ok {
		return fl, false
	}
	fl := &call[T]{done: make(chan struct{})}
	c.flights[key] = fl
	return fl, true
}

func (c *Cache[T]) finish(key string, fl *call[T]) {
	c.mu.Lock()
	if fl.err == nil {
		c.items[key] = entry[T]{value: fl.value, storedAt: c.now()}
	}
	delete(c.flights, key)
	c.sweepLocked()
	c.mu.Unlock()
	close(fl.done)
}

// sweepLocked drops entries that can no longer be served fresh or stale, so a
// caller enumerating keys cannot grow the map without bound.
func (c *Cache[T]) sweepLocked() {
	now := c.now()
	if now.Sub(c.lastSweep) < sweepInterval {
		return
	}
	c.lastSweep = now
	horizon := c.ttl
	if c.staleFor > horizon {
		horizon = c.staleFor
	}
	for k, e := range c.items {
		if now.Sub(e.storedAt) > horizon {
			delete(c.items, k)
		}
	}
}
