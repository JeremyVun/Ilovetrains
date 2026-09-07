package cache

import (
	"context"
	"testing"
	"time"
)

// Stale's doc comment says "past its TTL"; the method returns a fresh entry
// too. The handler only calls it after Get missed, so nothing depends on the
// distinction, but the comment promises a filter that is not there.
func TestProbeStaleAlsoReturnsAFreshEntry(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	withClock(c)
	c.Put("k", "v")
	if got, ok := c.Stale("k"); !ok || got != "v" {
		t.Errorf("Stale on a fresh entry = %q, %v; the doc comment says it is TTL-gated", got, ok)
	}
}

// Put is the only write the hour store receives now, so its sweep is the only
// sweep that store gets; without it the store could only grow.
func TestProbePutSweepsWhatDoWouldHave(t *testing.T) {
	c := New[string](time.Hour, 24*time.Hour)
	clock := withClock(c)
	c.Put("old", "v")
	clock.Advance(25 * time.Hour)
	c.Put("new", "v")
	if _, ok := c.Stale("old"); ok {
		t.Error("Put did not sweep an entry past the stale window")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.items) != 1 {
		t.Errorf("items = %d, want 1", len(c.items))
	}
}

// Put must not race or disturb a flight in progress on the same key. The hour
// store never runs Do, so this is defensive; -race is the point.
func TestProbePutDuringAFlightIsSafe(t *testing.T) {
	c := New[string](30*time.Second, 10*time.Minute)
	release := make(chan struct{})
	done := make(chan Result[string])
	go func() {
		r, _ := c.Do(t.Context(), "k", func(context.Context) (string, error) {
			<-release
			return "fetched", nil
		})
		done <- r
	}()
	time.Sleep(20 * time.Millisecond)
	c.Put("k", "put")
	close(release)
	r := <-done
	if r.Value != "fetched" {
		t.Errorf("leader saw %q, want its own fetch", r.Value)
	}
	if got, _ := c.Get("k"); got != "fetched" {
		t.Errorf("after the flight, Get = %q; the fetch landed last", got)
	}
}
