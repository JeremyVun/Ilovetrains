package cache

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// fakeClock lets TTL and stale-window behavior be tested without sleeping.
type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

func withClock[T any](c *Cache[T]) *fakeClock {
	clock := &fakeClock{now: time.Date(2026, 8, 31, 12, 0, 0, 0, time.UTC)}
	c.now = clock.Now
	return clock
}

func constant(value string, calls *atomic.Int32) func(context.Context) (string, error) {
	return func(context.Context) (string, error) {
		calls.Add(1)
		return value, nil
	}
}

func failing(err error, calls *atomic.Int32) func(context.Context) (string, error) {
	return func(context.Context) (string, error) {
		calls.Add(1)
		return "", err
	}
}

func TestServesFreshValueWithoutRefetching(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	clock := withClock(c)
	var calls atomic.Int32

	for range 3 {
		got, err := c.Do(context.Background(), "k", constant("v1", &calls))
		if err != nil {
			t.Fatalf("Do: %v", err)
		}
		if got.Value != "v1" || got.Stale {
			t.Fatalf("got %+v, want fresh v1", got)
		}
		clock.Advance(9 * time.Second)
	}
	if calls.Load() != 1 {
		t.Errorf("fetches = %d, want 1", calls.Load())
	}
}

func TestRefetchesAfterTTL(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	clock := withClock(c)
	var calls atomic.Int32

	if _, err := c.Do(context.Background(), "k", constant("v1", &calls)); err != nil {
		t.Fatalf("Do: %v", err)
	}
	clock.Advance(30 * time.Second)
	got, err := c.Do(context.Background(), "k", constant("v2", &calls))
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if got.Value != "v2" {
		t.Errorf("value = %q, want v2", got.Value)
	}
	if calls.Load() != 2 {
		t.Errorf("fetches = %d, want 2", calls.Load())
	}
}

func TestKeysAreIndependent(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	withClock(c)
	var calls atomic.Int32

	for _, key := range []string{"a", "b", "a"} {
		if _, err := c.Do(context.Background(), key, constant(key, &calls)); err != nil {
			t.Fatalf("Do(%s): %v", key, err)
		}
	}
	if calls.Load() != 2 {
		t.Errorf("fetches = %d, want 2", calls.Load())
	}
}

func TestConcurrentMissesCostOneFetch(t *testing.T) {
	// The whole point of single-flight: a CDN miss storm on a cold key must
	// spend one TfNSW request, not one per waiting client.
	c := New[string](30*time.Second, 10*time.Minute)
	withClock(c)

	var calls atomic.Int32
	release := make(chan struct{})
	started := make(chan struct{})
	fetch := func(context.Context) (string, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		<-release
		return "v1", nil
	}

	const waiters = 50
	results := make(chan Result[string], waiters)
	errs := make(chan error, waiters)
	var wg sync.WaitGroup
	for range waiters {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := c.Do(context.Background(), "k", fetch)
			results <- got
			errs <- err
		}()
	}

	<-started
	// Give the other goroutines a chance to pile up behind the leader.
	time.Sleep(20 * time.Millisecond)
	close(release)
	wg.Wait()
	close(results)
	close(errs)

	if calls.Load() != 1 {
		t.Errorf("fetches = %d, want 1", calls.Load())
	}
	for err := range errs {
		if err != nil {
			t.Fatalf("waiter error: %v", err)
		}
	}
	for got := range results {
		if got.Value != "v1" {
			t.Fatalf("waiter got %q, want v1", got.Value)
		}
	}
}

func TestServesStaleWhenUpstreamFails(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	clock := withClock(c)
	var calls atomic.Int32

	if _, err := c.Do(context.Background(), "k", constant("v1", &calls)); err != nil {
		t.Fatalf("Do: %v", err)
	}
	clock.Advance(2 * time.Minute)

	got, err := c.Do(context.Background(), "k", failing(errors.New("upstream down"), &calls))
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if got.Value != "v1" {
		t.Errorf("value = %q, want the cached v1", got.Value)
	}
	if !got.Stale {
		t.Error("Stale = false, want true")
	}
	if got.Age != 2*time.Minute {
		t.Errorf("age = %v, want 2m", got.Age)
	}
}

func TestStopsServingStaleAfterWindow(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	clock := withClock(c)
	var calls atomic.Int32
	wantErr := errors.New("upstream down")

	if _, err := c.Do(context.Background(), "k", constant("v1", &calls)); err != nil {
		t.Fatalf("Do: %v", err)
	}
	clock.Advance(10*time.Minute + time.Second)

	_, err := c.Do(context.Background(), "k", failing(wantErr, &calls))
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want the upstream error", err)
	}
}

func TestFailedFetchWithNoCacheReturnsError(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	withClock(c)
	var calls atomic.Int32
	wantErr := errors.New("upstream down")

	_, err := c.Do(context.Background(), "k", failing(wantErr, &calls))
	if !errors.Is(err, wantErr) {
		t.Fatalf("err = %v, want the upstream error", err)
	}
}

func TestFailedFetchDoesNotEvictUsableValue(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	clock := withClock(c)
	var calls atomic.Int32

	if _, err := c.Do(context.Background(), "k", constant("v1", &calls)); err != nil {
		t.Fatalf("Do: %v", err)
	}
	clock.Advance(time.Minute)
	if _, err := c.Do(context.Background(), "k", failing(errors.New("down"), &calls)); err != nil {
		t.Fatalf("Do: %v", err)
	}
	// Upstream recovers.
	got, err := c.Do(context.Background(), "k", constant("v2", &calls))
	if err != nil {
		t.Fatalf("Do: %v", err)
	}
	if got.Value != "v2" || got.Stale {
		t.Errorf("got %+v, want fresh v2", got)
	}
}

func TestWaiterRespectsItsOwnCancellation(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	withClock(c)

	release := make(chan struct{})
	started := make(chan struct{})
	var once sync.Once
	fetch := func(context.Context) (string, error) {
		once.Do(func() { close(started) })
		<-release
		return "v1", nil
	}

	leaderDone := make(chan struct{})
	go func() {
		defer close(leaderDone)
		if _, err := c.Do(context.Background(), "k", fetch); err != nil {
			t.Errorf("leader: %v", err)
		}
	}()
	<-started

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.Do(ctx, "k", fetch); !errors.Is(err, context.Canceled) {
		t.Errorf("waiter err = %v, want context.Canceled", err)
	}

	close(release)
	<-leaderDone
}

func TestSweepDropsUnusableEntries(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	clock := withClock(c)
	var calls atomic.Int32

	if _, err := c.Do(context.Background(), "old", constant("v1", &calls)); err != nil {
		t.Fatalf("Do: %v", err)
	}
	clock.Advance(time.Hour)
	if _, err := c.Do(context.Background(), "new", constant("v2", &calls)); err != nil {
		t.Fatalf("Do: %v", err)
	}

	c.mu.Lock()
	_, stillThere := c.items["old"]
	size := len(c.items)
	c.mu.Unlock()
	if stillThere {
		t.Error("unusable entry survived the sweep")
	}
	if size != 1 {
		t.Errorf("cache size = %d, want 1", size)
	}
}
