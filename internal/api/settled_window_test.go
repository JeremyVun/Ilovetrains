package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"sync"
	"testing"
	"time"

	"trains/internal/tfnsw"
)

func hourStoreHolds(server *Server, at time.Time) bool {
	key := "200060|215020|6|" + bucketKey(floorToBucket(at)) + "|" + modesKey(tfnsw.AllModes())
	_, ok := server.departuresPast.Get(key)
	return ok
}

func decodeDepartures(t *testing.T, body []byte) tfnsw.DeparturesResponse {
	t.Helper()
	var response tfnsw.DeparturesResponse
	if err := json.Unmarshal(body, &response); err != nil {
		t.Fatalf("decoding body %q: %v", body, err)
	}
	return response
}

func arrivedDepartures() *tfnsw.DeparturesResponse {
	return travellingDepartures(testNow.Add(-5 * time.Minute))
}

// I1 boundary: a bucket exactly 20 minutes old is not settled-eligible.
func TestProbeBucketExactlyTwentyMinutesOldStaysLive(t *testing.T) {
	bucket := time.Date(2026, 9, 1, 17, 30, 0, 0, sydney)
	clock := bucket.Add(settledAge)
	upstream := &fakeUpstream{departures: arrivedDepartures()}
	server, handler := movingServer(t, upstream, &clock)
	target := "/api/v1/departures?from=200060&to=215020&at=" + url.QueryEscape(bucket.Format(time.RFC3339))

	got := get(t, handler, target)
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", got.Code, got.Body)
	}
	if cc := got.Header().Get("Cache-Control"); cc != departuresCacheControl {
		t.Errorf("at exactly %v: Cache-Control = %q, want live %q", settledAge, cc, departuresCacheControl)
	}
	if hourStoreHolds(server, bucket) {
		t.Error("at exactly 20 minutes the window landed in the hour store")
	}

	clock = clock.Add(time.Second)
	server.departures.SetClock(func() time.Time { return clock.Add(time.Hour) })
	got = get(t, handler, target)
	if cc := got.Header().Get("Cache-Control"); cc != departuresPastCacheControl {
		t.Errorf("one second past %v: Cache-Control = %q, want past %q", settledAge, cc, departuresPastCacheControl)
	}
}

// I1: while a journey runs, every answer is live and its body is no older than
// the live TTL, however long the bucket has been settled-eligible.
func TestProbeInTransitWindowIsAlwaysLiveAndNeverOlderThanLiveTTL(t *testing.T) {
	clock := testNow
	moving := func(now time.Time) *tfnsw.DeparturesResponse {
		response := travellingDepartures(now.Add(5 * time.Minute))
		response.GeneratedAt = now.Format(time.RFC3339)
		return response
	}
	upstream := &fakeUpstream{departures: moving(clock)}
	server, handler := movingServer(t, upstream, &clock)
	target := departuresAt(-25 * time.Minute)

	for step := 0; step < 36; step++ {
		upstream.departures = moving(clock)
		got := get(t, handler, target)
		if got.Code != http.StatusOK {
			t.Fatalf("step %d: status = %d: %s", step, got.Code, got.Body)
		}
		if cc := got.Header().Get("Cache-Control"); cc != departuresCacheControl {
			t.Fatalf("step %d: Cache-Control = %q, want live", step, cc)
		}
		if got.Header().Get("X-Data-Stale") != "" {
			t.Fatalf("step %d: stale header on a fresh window", step)
		}
		body := decodeDepartures(t, got.Body.Bytes())
		generated, err := time.Parse(time.RFC3339, body.GeneratedAt)
		if err != nil {
			t.Fatal(err)
		}
		if age := clock.Sub(generated); age >= departuresTTL {
			t.Fatalf("step %d: body is %v old, live TTL is %v", step, age, departuresTTL)
		}
		clock = clock.Add(10 * time.Second)
	}
	if hourStoreHolds(server, testNow.Add(-25*time.Minute)) {
		t.Error("an in-transit window reached the hour store")
	}
	if calls := upstream.departureCalls.Load(); calls != 12 {
		t.Errorf("upstream calls = %d over 6 minutes at 10 s steps, want 12 (one per 30 s)", calls)
	}
}

// I2: the first request after arrival promotes; the hour that follows is free.
func TestProbePromotedWindowCostsNothingForAnHour(t *testing.T) {
	clock := testNow
	upstream := &fakeUpstream{departures: arrivedDepartures()}
	_, handler := movingServer(t, upstream, &clock)
	target := departuresAt(-25 * time.Minute)

	if got := get(t, handler, target); got.Header().Get("Cache-Control") != departuresPastCacheControl {
		t.Fatalf("first request Cache-Control = %q, want past", got.Header().Get("Cache-Control"))
	}
	for minute := 1; minute < 60; minute++ {
		clock = testNow.Add(time.Duration(minute) * time.Minute)
		got := get(t, handler, target)
		if cc := got.Header().Get("Cache-Control"); cc != departuresPastCacheControl {
			t.Fatalf("minute %d: Cache-Control = %q, want past", minute, cc)
		}
		if got.Header().Get("X-Data-Stale") != "" {
			t.Fatalf("minute %d: stale header inside the hour", minute)
		}
	}
	clock = testNow.Add(departuresPastTTL - time.Second)
	get(t, handler, target)
	if calls := upstream.departureCalls.Load(); calls != 1 {
		t.Fatalf("upstream calls = %d inside the hour, want 1", calls)
	}
	clock = testNow.Add(departuresPastTTL)
	got := get(t, handler, target)
	if calls := upstream.departureCalls.Load(); calls != 2 {
		t.Errorf("upstream calls = %d at the hour, want 2", calls)
	}
	if cc := got.Header().Get("Cache-Control"); cc != departuresPastCacheControl {
		t.Errorf("re-promoted Cache-Control = %q, want past", cc)
	}
}

// Characterisation of the builder's "30 s older body" hazard: promotion may
// use a body up to departuresTTL old, so an estimate that moved inside the
// final 30 seconds freezes at its previous value. The bound is the live TTL.
func TestProbePromotionMayUseABodyUpToLiveTTLOld(t *testing.T) {
	clock := testNow
	upstream := &fakeUpstream{departures: travellingDepartures(testNow.Add(10 * time.Second))}
	_, handler := movingServer(t, upstream, &clock)
	target := departuresAt(-25 * time.Minute)

	get(t, handler, target)
	clock = clock.Add(5 * time.Second)
	truth := testNow.Add(40 * time.Second)
	upstream.departures = travellingDepartures(truth)

	clock = testNow.Add(15 * time.Second)
	got := get(t, handler, target)
	if cc := got.Header().Get("Cache-Control"); cc != departuresPastCacheControl {
		t.Fatalf("Cache-Control = %q, want past: the 15 s old body says the train is in", cc)
	}
	if arrival := estimatedArrival(t, got); arrival == truth.Format(time.RFC3339) {
		t.Fatal("promoted body carries the moved arrival; the hazard is gone and this probe is obsolete")
	}
	if calls := upstream.departureCalls.Load(); calls != 1 {
		t.Errorf("upstream calls = %d, want 1: promotion reused the live store's body", calls)
	}

	clock = testNow.Add(20 * time.Minute)
	got = get(t, handler, target)
	if arrival := estimatedArrival(t, got); arrival != testNow.Add(10*time.Second).Format(time.RFC3339) {
		t.Errorf("hour store serves %q, want the 15 s old estimate frozen for the hour", arrival)
	}
}

// I3: a stale-on-error body is not promoted, and the day-long fallback still
// answers after the hour store's entry has expired.
func TestProbeStaleNeverPromotedAndDayFallbackOutlivesTheHour(t *testing.T) {
	clock := testNow
	upstream := &fakeUpstream{departures: travellingDepartures(testNow.Add(10 * time.Second))}
	server, handler := movingServer(t, upstream, &clock)
	at := testNow.Add(-25 * time.Minute)
	target := departuresAt(-25 * time.Minute)

	get(t, handler, target)
	upstream.err = fmt.Errorf("%w: HTTP 500", tfnsw.ErrUpstream)
	clock = testNow.Add(time.Minute)
	got := get(t, handler, target)
	if got.Code != http.StatusOK || got.Header().Get("X-Data-Stale") != "true" {
		t.Fatalf("want the live stale copy, got %d stale=%q", got.Code, got.Header().Get("X-Data-Stale"))
	}
	if cc := got.Header().Get("Cache-Control"); cc != departuresCacheControl {
		t.Errorf("stale in-transit body: Cache-Control = %q, want live", cc)
	}
	if hourStoreHolds(server, at) {
		t.Error("a stale body was promoted into the hour store")
	}

	upstream.err = nil
	clock = testNow.Add(2 * time.Minute)
	got = get(t, handler, target)
	if cc := got.Header().Get("Cache-Control"); cc != departuresPastCacheControl {
		t.Fatalf("recovered fetch Cache-Control = %q, want past", cc)
	}
	promoted := decodeDepartures(t, got.Body.Bytes()).GeneratedAt

	upstream.err = fmt.Errorf("%w: HTTP 500", tfnsw.ErrUpstream)
	for _, age := range []time.Duration{departuresPastTTL + time.Minute, 12 * time.Hour, 23 * time.Hour} {
		clock = testNow.Add(2 * time.Minute).Add(age)
		got = get(t, handler, target)
		if got.Code != http.StatusOK {
			t.Fatalf("hour store entry %v old, upstream down: status = %d, want 200: %s", age, got.Code, got.Body)
		}
		if got.Header().Get("X-Data-Stale") != "true" {
			t.Errorf("hour store entry %v old: X-Data-Stale missing", age)
		}
		if cc := got.Header().Get("Cache-Control"); cc != departuresPastCacheControl {
			t.Errorf("hour store entry %v old: Cache-Control = %q, want past", age, cc)
		}
		if body := decodeDepartures(t, got.Body.Bytes()); body.GeneratedAt != promoted {
			t.Errorf("hour store entry %v old: generatedAt = %q, want the promoted %q", age, body.GeneratedAt, promoted)
		}
	}

	upstream.err = nil
	clock = clock.Add(time.Minute)
	got = get(t, handler, target)
	if got.Header().Get("X-Data-Stale") != "" || got.Header().Get("Cache-Control") != departuresPastCacheControl {
		t.Errorf("recovery: stale=%q cc=%q, want a fresh past answer", got.Header().Get("X-Data-Stale"), got.Header().Get("Cache-Control"))
	}
}

// I3, negative space: a settled-eligible bucket that was never fetched has no
// fallback and is a 502, exactly as before.
func TestProbeColdSettledBucketOnUpstreamFailureIs502(t *testing.T) {
	clock := testNow
	upstream := &fakeUpstream{err: fmt.Errorf("%w: HTTP 500", tfnsw.ErrUpstream)}
	_, handler := movingServer(t, upstream, &clock)
	got := get(t, handler, departuresAt(-25*time.Minute))
	if got.Code != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", got.Code)
	}
}

type slowUpstream struct {
	*fakeUpstream
	delay time.Duration
}

func (s *slowUpstream) DeparturesWithOptions(ctx context.Context, from, to string, limit int, at time.Time,
	options tfnsw.DeparturesOptions) (*tfnsw.DeparturesResponse, error) {
	time.Sleep(s.delay)
	return s.fakeUpstream.DeparturesWithOptions(ctx, from, to, limit, at, options)
}

// I4: concurrent settled-eligible misses share one fetch, arrived or not.
func TestProbeConcurrentSettledMissesFetchOnce(t *testing.T) {
	cases := []struct {
		name string
		body *tfnsw.DeparturesResponse
		want string
	}{
		{"all arrived", arrivedDepartures(), departuresPastCacheControl},
		{"in transit", travellingDepartures(testNow.Add(5 * time.Minute)), departuresCacheControl},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := testNow
			upstream := &slowUpstream{fakeUpstream: &fakeUpstream{departures: tc.body}, delay: 200 * time.Millisecond}
			_, handler := movingServer(t, upstream, &clock)
			target := departuresAt(-25 * time.Minute)

			const n = 32
			var wg sync.WaitGroup
			codes := make([]int, n)
			controls := make([]string, n)
			for i := 0; i < n; i++ {
				wg.Add(1)
				go func(i int) {
					defer wg.Done()
					got := get(t, handler, target)
					codes[i], controls[i] = got.Code, got.Header().Get("Cache-Control")
				}(i)
			}
			wg.Wait()
			for i := 0; i < n; i++ {
				if codes[i] != http.StatusOK || controls[i] != tc.want {
					t.Errorf("request %d: %d %q, want 200 %q", i, codes[i], controls[i], tc.want)
				}
			}
			if calls := upstream.departureCalls.Load(); calls != 1 {
				t.Errorf("upstream calls = %d for %d concurrent misses, want 1", calls, n)
			}
			get(t, handler, target)
			if calls := upstream.departureCalls.Load(); calls != 1 {
				t.Errorf("upstream calls = %d after the storm, want 1", calls)
			}
		})
	}
}

// I5: no live-path request reaches the hour store, whatever its journeys say.
func TestProbeLivePathNeverTouchesTheHourStore(t *testing.T) {
	cases := []struct {
		name   string
		target string
		at     time.Time
	}{
		{"absent at", "/api/v1/departures?from=200060&to=215020", time.Time{}},
		{"ten minutes back", departuresAt(-10 * time.Minute), testNow.Add(-10 * time.Minute)},
		{"future", departuresAt(90 * time.Minute), testNow.Add(90 * time.Minute)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := testNow
			upstream := &fakeUpstream{departures: arrivedDepartures()}
			server, handler := movingServer(t, upstream, &clock)
			got := get(t, handler, tc.target)
			if cc := got.Header().Get("Cache-Control"); cc != departuresCacheControl {
				t.Errorf("Cache-Control = %q, want live", cc)
			}
			key := "200060|215020|6|" + bucketKey(floorToBucket(tc.at)) + "|" + modesKey(tfnsw.AllModes())
			if tc.at.IsZero() {
				key = "200060|215020|6||" + modesKey(tfnsw.AllModes())
			}
			if _, ok := server.departuresPast.Get(key); ok {
				t.Error("live-path answer landed in the hour store")
			}
			if _, ok := server.departuresPast.Stale(key); ok {
				t.Error("live-path answer landed in the hour store")
			}
		})
	}
}

// I5: a live window's stale window is still 10 minutes, then 502; the day-long
// fallback belongs only to a promoted window.
func TestProbeLiveWindowStaleWindowIsStillTenMinutes(t *testing.T) {
	clock := testNow
	upstream := &fakeUpstream{departures: arrivedDepartures(), errAfterFirst: fmt.Errorf("%w: HTTP 500", tfnsw.ErrUpstream)}
	_, handler := movingServer(t, upstream, &clock)
	target := "/api/v1/departures?from=200060&to=215020"

	get(t, handler, target)
	clock = testNow.Add(9 * time.Minute)
	if got := get(t, handler, target); got.Code != http.StatusOK || got.Header().Get("X-Data-Stale") != "true" {
		t.Fatalf("9 minutes: %d stale=%q, want stale 200", got.Code, got.Header().Get("X-Data-Stale"))
	}
	clock = testNow.Add(11 * time.Minute)
	if got := get(t, handler, target); got.Code != http.StatusBadGateway {
		t.Errorf("11 minutes: status = %d, want 502", got.Code)
	}
}

// I6: only a readable effective arrival in the past settles a window.
func TestProbeUnreadableArrivalKeepsTheWindowLive(t *testing.T) {
	past := testNow.Add(-5 * time.Minute).Format(time.RFC3339)
	future := testNow.Add(5 * time.Minute).Format(time.RFC3339)
	garbage := "soon"
	journey := func(scheduled string, estimated *string, cancelled bool) tfnsw.Journey {
		j := sampleDepartures().Journeys[0]
		j.Arrival = tfnsw.Arrival{Scheduled: scheduled, Estimated: estimated}
		j.Cancelled = cancelled
		return j
	}
	cases := []struct {
		name     string
		journeys []tfnsw.Journey
		settled  bool
	}{
		{"empty scheduled, no estimate (upstream omitted the planned arrival)", []tfnsw.Journey{journey("", nil, false)}, false},
		{"garbage estimate over a past schedule", []tfnsw.Journey{journey(past, &garbage, false)}, false},
		{"garbage schedule under a past estimate", []tfnsw.Journey{journey(garbage, &past, false)}, true},
		{"past estimate over a future schedule", []tfnsw.Journey{journey(future, &past, false)}, true},
		{"future estimate over a past schedule", []tfnsw.Journey{journey(past, &future, false)}, false},
		{"one arrived, one running", []tfnsw.Journey{journey(past, nil, false), journey(future, nil, false)}, false},
		{"cancelled with an empty arrival", []tfnsw.Journey{journey("", nil, true)}, true},
		{"nil journeys slice", nil, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			clock := testNow
			response := sampleDepartures()
			response.Journeys = tc.journeys
			upstream := &fakeUpstream{departures: response}
			server, handler := movingServer(t, upstream, &clock)
			got := get(t, handler, departuresAt(-25*time.Minute))
			if got.Code != http.StatusOK {
				t.Fatalf("status = %d: %s", got.Code, got.Body)
			}
			want := departuresCacheControl
			if tc.settled {
				want = departuresPastCacheControl
			}
			if cc := got.Header().Get("Cache-Control"); cc != want {
				t.Errorf("Cache-Control = %q, want %q", cc, want)
			}
			if held := hourStoreHolds(server, testNow.Add(-25*time.Minute)); held != tc.settled {
				t.Errorf("hour store holds = %v, want %v", held, tc.settled)
			}
		})
	}
}

// Defect question: `now` is read before the fetch, so an arrival that lands
// during the fetch is classified against the older clock and stays live for
// one more round. The skew only ever delays promotion; it never advances it.
func TestProbeArrivalDuringTheFetchDelaysPromotionByOneRound(t *testing.T) {
	clock := testNow
	arrival := testNow.Add(5 * time.Second)
	upstream := &fakeUpstream{departures: travellingDepartures(arrival)}
	advancing := &advancingUpstream{fakeUpstream: upstream, clock: &clock, by: 10 * time.Second}
	_, handler := movingServer(t, advancing, &clock)
	target := departuresAt(-25 * time.Minute)

	got := get(t, handler, target)
	if cc := got.Header().Get("Cache-Control"); cc != departuresCacheControl {
		t.Errorf("Cache-Control = %q, want live: classified against the pre-fetch clock", cc)
	}
	clock = clock.Add(departuresTTL)
	got = get(t, handler, target)
	if cc := got.Header().Get("Cache-Control"); cc != departuresPastCacheControl {
		t.Errorf("next round Cache-Control = %q, want past", cc)
	}
}

type advancingUpstream struct {
	*fakeUpstream
	clock *time.Time
	by    time.Duration
}

func (a *advancingUpstream) DeparturesWithOptions(ctx context.Context, from, to string, limit int, at time.Time,
	options tfnsw.DeparturesOptions) (*tfnsw.DeparturesResponse, error) {
	*a.clock = a.clock.Add(a.by)
	return a.fakeUpstream.DeparturesWithOptions(ctx, from, to, limit, at, options)
}

// Defect question: after promotion, a body in both stores is the same pointer.
// Nothing mutates a response after the fetch, so the sharing is inert; this
// pins that the hour store's copy is what the live store fetched.
func TestProbePromotedBodyIsTheFetchedBody(t *testing.T) {
	clock := testNow
	upstream := &fakeUpstream{departures: arrivedDepartures()}
	server, handler := movingServer(t, upstream, &clock)
	at := testNow.Add(-25 * time.Minute)
	key := "200060|215020|6|" + bucketKey(floorToBucket(at)) + "|" + modesKey(tfnsw.AllModes())

	get(t, handler, departuresAt(-25*time.Minute))
	live, _ := server.departures.Get(key)
	hour, ok := server.departuresPast.Get(key)
	if !ok || live != hour {
		t.Errorf("hour store holds %p, live store %p, ok=%v", hour, live, ok)
	}
}
