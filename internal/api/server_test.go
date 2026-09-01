package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"trains/internal/tfnsw"
)

// sydney is the offset every served timestamp uses; `at` round-trips through it.
var sydney = mustLoadSydney()

func mustLoadSydney() *time.Location {
	loc, err := time.LoadLocation(tfnsw.TimeZone)
	if err != nil {
		panic(err)
	}
	return loc
}

// testNow is a fixed 17:52 Sydney, so bucket arithmetic in these tests is
// readable as wall-clock times rather than offsets from whenever they ran.
var testNow = time.Date(2026, 9, 1, 17, 52, 0, 0, sydney)

// fakeUpstream stands in for the TfNSW client so handler tests never touch the
// network.
type fakeUpstream struct {
	departures     *tfnsw.DeparturesResponse
	stops          *tfnsw.StopsResponse
	err            error
	errAfterFirst  error
	departureCalls atomic.Int32
	stopCalls      atomic.Int32
	lastLimit      atomic.Int32

	mu     sync.Mutex
	lastAt time.Time
}

func (f *fakeUpstream) Departures(_ context.Context, from, to string, limit int, at time.Time) (*tfnsw.DeparturesResponse, error) {
	call := f.departureCalls.Add(1)
	f.lastLimit.Store(int32(limit))
	f.mu.Lock()
	f.lastAt = at
	f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	if call > 1 && f.errAfterFirst != nil {
		return nil, f.errAfterFirst
	}
	response := *f.departures
	response.From.ID, response.To.ID = from, to
	// The real client echoes the window it queried; the fake must too, or the
	// handler tests cannot see what reached upstream.
	if !at.IsZero() {
		echoed := at.In(sydney).Format(time.RFC3339)
		response.At = &echoed
	}
	return &response, nil
}

func (f *fakeUpstream) at() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastAt
}

func (f *fakeUpstream) Stops(_ context.Context, _ string) (*tfnsw.StopsResponse, error) {
	call := f.stopCalls.Add(1)
	if f.err != nil {
		return nil, f.err
	}
	if call > 1 && f.errAfterFirst != nil {
		return nil, f.errAfterFirst
	}
	return f.stops, nil
}

func sampleDepartures() *tfnsw.DeparturesResponse {
	estimated := "2026-08-31T22:50:00+10:00"
	platform := "Platform 18"
	return &tfnsw.DeparturesResponse{
		From:        tfnsw.Place{ID: "200060", Name: "Central Station"},
		To:          tfnsw.Place{ID: "215020", Name: "Parramatta Station"},
		GeneratedAt: "2026-08-31T22:47:00+10:00",
		Journeys: []tfnsw.Journey{{
			Departure:           tfnsw.Departure{Scheduled: "2026-08-31T22:48:00+10:00", Estimated: &estimated, Platform: &platform},
			Arrival:             tfnsw.Arrival{Scheduled: "2026-08-31T23:19:00+10:00"},
			Line:                tfnsw.Line{Name: "T1", Mode: "train"},
			DestinationHeadsign: "Penrith via Parramatta",
			Legs:                1,
		}},
	}
}

func sampleStops() *tfnsw.StopsResponse {
	return &tfnsw.StopsResponse{Stops: []tfnsw.Stop{
		{ID: "200060", Name: "Central Station", Modes: []string{"train", "metro"},
			Location: &tfnsw.Location{Lat: -33.884024, Lon: 151.206203}},
		{ID: "200070", Name: "Town Hall Station", Modes: []string{"train"}},
	}}
}

func newTestServer(t *testing.T, upstream Upstream) http.Handler {
	t.Helper()
	return New(upstream, filepath.Join(t.TempDir(), "no-web-dir")).Handler()
}

// pinnedServer returns a server whose clock is fixed at testNow, so `at`
// windows read as wall-clock times instead of offsets from whenever the test ran.
func pinnedServer(t *testing.T, upstream Upstream) (*Server, http.Handler) {
	t.Helper()
	server := New(upstream, filepath.Join(t.TempDir(), "no-web-dir"))
	server.now = func() time.Time { return testNow }
	return server, server.Handler()
}

// departuresAt builds a request for a window `offset` from testNow, with the
// timestamp percent-encoded the way a correct client sends it.
func departuresAt(offset time.Duration) string {
	return "/api/v1/departures?from=200060&to=215020&at=" +
		url.QueryEscape(testNow.Add(offset).Format(time.RFC3339))
}

func get(t *testing.T, handler http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
	return recorder
}

func decodeError(t *testing.T, recorder *httptest.ResponseRecorder) errorBody {
	t.Helper()
	var body errorBody
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding error body %q: %v", recorder.Body.String(), err)
	}
	return body
}

func TestDeparturesContract(t *testing.T) {
	upstream := &fakeUpstream{departures: sampleDepartures()}
	got := get(t, newTestServer(t, upstream), "/api/v1/departures?from=200060&to=215020")

	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
	}
	wantHeaders := map[string]string{
		"Content-Type":                "application/json; charset=utf-8",
		"Cache-Control":               departuresCacheControl,
		"Access-Control-Allow-Origin": "*",
		"Vary":                        "Accept-Encoding",
	}
	for name, want := range wantHeaders {
		if value := got.Header().Get(name); value != want {
			t.Errorf("%s = %q, want %q", name, value, want)
		}
	}
	if got.Header().Get("X-Data-Stale") != "" {
		t.Error("X-Data-Stale set on fresh data")
	}
	if got.Header().Get("Set-Cookie") != "" {
		t.Error("response set a cookie; the service is stateless")
	}

	var body tfnsw.DeparturesResponse
	if err := json.Unmarshal(got.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.From.ID != "200060" || body.To.ID != "215020" {
		t.Errorf("from/to = %+v / %+v", body.From, body.To)
	}
	if len(body.Journeys) != 1 || body.Journeys[0].Line.Name != "T1" {
		t.Errorf("journeys = %+v", body.Journeys)
	}
	// The default journey count comes from the contract, not the caller.
	if upstream.lastLimit.Load() != defaultLimit {
		t.Errorf("limit = %d, want %d", upstream.lastLimit.Load(), defaultLimit)
	}
}

func TestDeparturesRepeatQueryHitsCache(t *testing.T) {
	upstream := &fakeUpstream{departures: sampleDepartures()}
	handler := newTestServer(t, upstream)
	for range 3 {
		if got := get(t, handler, "/api/v1/departures?from=200060&to=215020"); got.Code != http.StatusOK {
			t.Fatalf("status = %d", got.Code)
		}
	}
	if upstream.departureCalls.Load() != 1 {
		t.Errorf("upstream calls = %d, want 1", upstream.departureCalls.Load())
	}
	// A different limit is a different cache key.
	get(t, handler, "/api/v1/departures?from=200060&to=215020&limit=3")
	if upstream.departureCalls.Load() != 2 {
		t.Errorf("upstream calls = %d, want 2", upstream.departureCalls.Load())
	}
	if upstream.lastLimit.Load() != 3 {
		t.Errorf("limit = %d, want 3", upstream.lastLimit.Load())
	}
}

func TestDeparturesBadRequests(t *testing.T) {
	handler := newTestServer(t, &fakeUpstream{departures: sampleDepartures()})
	cases := []struct{ name, target string }{
		{"missing from", "/api/v1/departures?to=215020"},
		{"missing to", "/api/v1/departures?from=200060"},
		{"empty from", "/api/v1/departures?from=&to=215020"},
		{"malformed stop id", "/api/v1/departures?from=200060&to=../etc"},
		{"same stop", "/api/v1/departures?from=200060&to=200060"},
		{"limit not a number", "/api/v1/departures?from=200060&to=215020&limit=lots"},
		{"limit too large", "/api/v1/departures?from=200060&to=215020&limit=11"},
		{"limit zero", "/api/v1/departures?from=200060&to=215020&limit=0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := get(t, handler, tc.target)
			if got.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", got.Code, got.Body)
			}
			// Bad requests are deterministic, so the contract makes them
			// cacheable rather than letting them reach the origin every time.
			if cc := got.Header().Get("Cache-Control"); cc != errorCacheableControl {
				t.Errorf("Cache-Control = %q, want %q", cc, errorCacheableControl)
			}
			if code := decodeError(t, got).Error.Code; code != "bad_request" {
				t.Errorf("code = %q, want bad_request", code)
			}
		})
	}
}

func TestDeparturesAcceptsLimitBounds(t *testing.T) {
	handler := newTestServer(t, &fakeUpstream{departures: sampleDepartures()})
	for _, limit := range []int{1, maxLimit} {
		target := fmt.Sprintf("/api/v1/departures?from=200060&to=215020&limit=%d", limit)
		if got := get(t, handler, target); got.Code != http.StatusOK {
			t.Errorf("limit %d: status = %d, want 200", limit, got.Code)
		}
	}
}

func TestBucketRoundsDown(t *testing.T) {
	// Rounding down, never to nearest: a bucket must never name a window that
	// has not happened yet, and the boundary minute belongs to the bucket it
	// opens.
	cases := []struct{ at, want string }{
		{"2026-09-01T17:30:00+10:00", "2026-09-01T17:30:00+10:00"}, // on the boundary
		{"2026-09-01T17:30:01+10:00", "2026-09-01T17:30:00+10:00"}, // one second in
		{"2026-09-01T17:39:59+10:00", "2026-09-01T17:30:00+10:00"}, // last instant
		{"2026-09-01T17:40:00+10:00", "2026-09-01T17:40:00+10:00"}, // next bucket
		{"2026-09-01T17:00:00+10:00", "2026-09-01T17:00:00+10:00"}, // on the hour
		{"2026-09-01T17:59:59+10:00", "2026-09-01T17:50:00+10:00"}, // last of the hour
		{"2026-09-01T00:00:00+10:00", "2026-09-01T00:00:00+10:00"}, // midnight
		{"2026-09-01T00:09:59+10:00", "2026-09-01T00:00:00+10:00"}, // day boundary
	}
	for _, tc := range cases {
		parsed, err := time.Parse(time.RFC3339, tc.at)
		if err != nil {
			t.Fatalf("parsing %q: %v", tc.at, err)
		}
		got := floorToBucket(parsed).In(sydney).Format(time.RFC3339)
		if got != tc.want {
			t.Errorf("floorToBucket(%s) = %s, want %s", tc.at, got, tc.want)
		}
	}
}

func TestBucketMatchesSydneyWallClock(t *testing.T) {
	// floorToBucket floors absolute time, which is the same as flooring Sydney
	// wall-clock time only because every Sydney offset is a whole number of
	// hours. Both DST changeovers are swept minute by minute to hold that
	// assumption to its face.
	//
	// The claim is checked on the result's wall-clock FIELDS rather than by
	// rebuilding an instant with time.Date: on the autumn changeover 02:00–03:00
	// happens twice, so a local time does not name one instant and the rebuilt
	// oracle would be the thing that is wrong.
	for _, start := range []string{"2026-04-05T00:00:00+11:00", "2026-10-04T00:00:00+10:00"} {
		from, err := time.Parse(time.RFC3339, start)
		if err != nil {
			t.Fatalf("parsing %q: %v", start, err)
		}
		for minute := range 36 * 60 {
			at := from.Add(time.Duration(minute) * time.Minute).Add(37 * time.Second)
			bucket := floorToBucket(at)
			local, bucketLocal := at.In(sydney), bucket.In(sydney)

			if bucketLocal.Second() != 0 || bucketLocal.Nanosecond() != 0 || bucketLocal.Minute()%10 != 0 {
				t.Fatalf("floorToBucket(%s) = %s, want a clean 10-minute boundary",
					local.Format(time.RFC3339), bucketLocal.Format(time.RFC3339))
			}
			if bucket.After(at) || at.Sub(bucket) >= bucketSize {
				t.Fatalf("floorToBucket(%s) = %s, want the bucket it falls in",
					local.Format(time.RFC3339), bucketLocal.Format(time.RFC3339))
			}
			if bucketLocal.Day() != local.Day() || bucketLocal.Hour() != local.Hour() ||
				bucketLocal.Minute() != local.Minute()-local.Minute()%10 {
				t.Fatalf("floorToBucket(%s) = %s, want the same hour with the minute floored",
					local.Format(time.RFC3339), bucketLocal.Format(time.RFC3339))
			}
		}
	}
}

func TestDeparturesAtIsBucketedAndEchoed(t *testing.T) {
	// The client pages on the echoed value, so it must be the bucket the server
	// actually queried, not the instant the client happened to send.
	upstream := &fakeUpstream{departures: sampleDepartures()}
	_, handler := pinnedServer(t, upstream)

	got := get(t, handler, departuresAt(-67*time.Minute)) // 16:45 → bucket 16:40
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
	}
	want := time.Date(2026, 9, 1, 16, 40, 0, 0, sydney)
	if !upstream.at().Equal(want) {
		t.Errorf("upstream at = %s, want the bucket %s",
			upstream.at().In(sydney).Format(time.RFC3339), want.Format(time.RFC3339))
	}
	var body tfnsw.DeparturesResponse
	if err := json.Unmarshal(got.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if body.At == nil || *body.At != "2026-09-01T16:40:00+10:00" {
		t.Errorf("at = %v, want the echoed bucket 2026-09-01T16:40:00+10:00", body.At)
	}
}

func TestDeparturesWithoutAtEchoesNull(t *testing.T) {
	// The live board is unchanged by this feature: no window asked for, no
	// window claimed, and upstream is asked for now.
	upstream := &fakeUpstream{departures: sampleDepartures()}
	_, handler := pinnedServer(t, upstream)

	got := get(t, handler, "/api/v1/departures?from=200060&to=215020")
	if !upstream.at().IsZero() {
		t.Errorf("upstream at = %v, want the zero time (now)", upstream.at())
	}
	if cc := got.Header().Get("Cache-Control"); cc != departuresCacheControl {
		t.Errorf("Cache-Control = %q, want the live policy %q", cc, departuresCacheControl)
	}
	if !strings.Contains(got.Body.String(), `"at":null`) {
		t.Errorf("body = %s, want \"at\":null", got.Body)
	}
}

func TestDeparturesCachePolicyPerTier(t *testing.T) {
	// The tier is chosen by how far into the past the BUCKET is, and 20 minutes
	// is the line: a newer bucket can still hold a train that has not left, so
	// it cannot be cached as settled.
	cases := []struct {
		name    string
		offset  time.Duration
		want    string
		settled bool
	}{
		{"live board", 0, departuresCacheControl, false},
		{"future window", 90 * time.Minute, departuresCacheControl, false},
		{"ten minutes back", -10 * time.Minute, departuresCacheControl, false},
		// 17:52 - 25m = 17:27, bucket 17:20, which is 32 min back: settled.
		{"twenty-five minutes back", -25 * time.Minute, departuresPastCacheControl, true},
		{"an hour back", -time.Hour, departuresPastCacheControl, true},
		{"a day back", -24 * time.Hour, departuresPastCacheControl, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			upstream := &fakeUpstream{departures: sampleDepartures()}
			server, handler := pinnedServer(t, upstream)

			target := departuresAt(tc.offset)
			if tc.name == "live board" {
				target = "/api/v1/departures?from=200060&to=215020"
			}
			got := get(t, handler, target)
			if got.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
			}
			if cc := got.Header().Get("Cache-Control"); cc != tc.want {
				t.Errorf("Cache-Control = %q, want %q", cc, tc.want)
			}

			// The in-memory TTL must mirror the s-maxage the header promises,
			// so a cold CDN cannot cost an upstream call the header said it
			// would not. Ageing the store the answer should NOT be in must
			// change nothing; ageing the one it should be in must refetch.
			wrongStore, rightStore := server.departuresPast, server.departures
			if tc.settled {
				wrongStore, rightStore = server.departures, server.departuresPast
			}
			wrongStore.SetClock(func() time.Time { return time.Now().Add(30 * 24 * time.Hour) })
			get(t, handler, target)
			if upstream.departureCalls.Load() != 1 {
				t.Errorf("upstream calls = %d, want 1: the answer is in the other tier's cache",
					upstream.departureCalls.Load())
			}
			rightStore.SetClock(func() time.Time { return time.Now().Add(30 * 24 * time.Hour) })
			get(t, handler, target)
			if upstream.departureCalls.Load() != 2 {
				t.Errorf("upstream calls = %d, want 2: expiring its own tier must refetch",
					upstream.departureCalls.Load())
			}
		})
	}
}

func TestDeparturesSettledWindowIsCachedForAnHour(t *testing.T) {
	// A live board is worth 30 seconds. What already ran is worth an hour —
	// and re-fetching it would be worse than the cache, because upstream drops
	// the realtime actuals from a window a few hours after it passes.
	upstream := &fakeUpstream{departures: sampleDepartures()}
	server, handler := pinnedServer(t, upstream)
	target := departuresAt(-time.Hour)

	for range 3 {
		if got := get(t, handler, target); got.Code != http.StatusOK {
			t.Fatalf("status = %d", got.Code)
		}
	}
	if upstream.departureCalls.Load() != 1 {
		t.Fatalf("upstream calls = %d, want 1", upstream.departureCalls.Load())
	}

	// Still one call well past the live TTL, which a past window must outlive.
	server.departuresPast.SetClock(func() time.Time { return time.Now().Add(departuresTTL + time.Minute) })
	get(t, handler, target)
	if upstream.departureCalls.Load() != 1 {
		t.Errorf("upstream calls = %d after %v, want the past window still cached",
			upstream.departureCalls.Load(), departuresTTL+time.Minute)
	}

	// Past the hour it refetches.
	server.departuresPast.SetClock(func() time.Time { return time.Now().Add(departuresPastTTL + time.Minute) })
	get(t, handler, target)
	if upstream.departureCalls.Load() != 2 {
		t.Errorf("upstream calls = %d after %v, want a refetch",
			upstream.departureCalls.Load(), departuresPastTTL+time.Minute)
	}
}

func TestDeparturesCacheKeyIncludesTheBucket(t *testing.T) {
	upstream := &fakeUpstream{departures: sampleDepartures()}
	_, handler := pinnedServer(t, upstream)

	// Two instants inside one bucket are one key: scrolling must not re-ask
	// upstream for a window it already has.
	get(t, handler, departuresAt(-61*time.Minute)) // 16:51 → 16:50
	get(t, handler, departuresAt(-69*time.Minute)) // 16:43 → 16:40
	get(t, handler, departuresAt(-68*time.Minute)) // 16:44 → 16:40
	if upstream.departureCalls.Load() != 2 {
		t.Errorf("upstream calls = %d, want 2 (two distinct buckets)", upstream.departureCalls.Load())
	}

	// The live board and an explicit window must never share an entry: their
	// bodies differ, so a shared key would serve one as the other.
	get(t, handler, "/api/v1/departures?from=200060&to=215020")
	if upstream.departureCalls.Load() != 3 {
		t.Errorf("upstream calls = %d, want the live board fetched separately",
			upstream.departureCalls.Load())
	}
	// And the bucket must not swallow the other key parts either.
	get(t, handler, departuresAt(-61*time.Minute)+"&limit=3")
	if upstream.departureCalls.Load() != 4 {
		t.Errorf("upstream calls = %d, want limit still part of the key",
			upstream.departureCalls.Load())
	}
}

func TestDeparturesAtBadRequests(t *testing.T) {
	// The window is bounded because every bucket is a cache key and a possible
	// upstream request; TfNSW quota is a hard budget.
	_, handler := pinnedServer(t, &fakeUpstream{departures: sampleDepartures()})
	cases := []struct{ name, target string }{
		{"not a time", "/api/v1/departures?from=200060&to=215020&at=soon"},
		{"date only", "/api/v1/departures?from=200060&to=215020&at=2026-09-01"},
		{"no offset", "/api/v1/departures?from=200060&to=215020&at=2026-09-01T17:30:00"},
		{"too far past", departuresAt(-25 * time.Hour)},
		{"far too far past", departuresAt(-30 * 24 * time.Hour)},
		{"too far future", departuresAt(3 * time.Hour)},
		{"far too far future", departuresAt(48 * time.Hour)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := get(t, handler, tc.target)
			if got.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", got.Code, got.Body)
			}
			if cc := got.Header().Get("Cache-Control"); cc != errorCacheableControl {
				t.Errorf("Cache-Control = %q, want %q", cc, errorCacheableControl)
			}
			if code := decodeError(t, got).Error.Code; code != "bad_request" {
				t.Errorf("code = %q, want bad_request", code)
			}
		})
	}
}

func TestDeparturesAtAcceptsTheWindowEdges(t *testing.T) {
	// A client that computes exactly now-24h or now+2h is inside the window,
	// not 400ing on a rounding artefact.
	upstream := &fakeUpstream{departures: sampleDepartures()}
	_, handler := pinnedServer(t, upstream)
	for _, offset := range []time.Duration{-maxPastWindow, maxFutureWindow, 0} {
		if got := get(t, handler, departuresAt(offset)); got.Code != http.StatusOK {
			t.Errorf("offset %v: status = %d, want 200: %s", offset, got.Code, got.Body)
		}
	}
}

func TestDeparturesAtToleratesAnUnencodedOffset(t *testing.T) {
	// `+` is a space in a URL query, so an offset the client forgot to
	// percent-encode arrives as "2026-09-01T16:40:00 10:00". Its meaning is not
	// in doubt, so it is honoured rather than 400ed — and it must land on the
	// same bucket as the properly encoded form.
	upstream := &fakeUpstream{departures: sampleDepartures()}
	_, handler := pinnedServer(t, upstream)

	got := get(t, handler, "/api/v1/departures?from=200060&to=215020&at=2026-09-01T16:40:00+10:00")
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
	}
	want := time.Date(2026, 9, 1, 16, 40, 0, 0, sydney)
	if !upstream.at().Equal(want) {
		t.Errorf("upstream at = %s, want %s",
			upstream.at().In(sydney).Format(time.RFC3339), want.Format(time.RFC3339))
	}
	// The encoded form is the same request, so it is also the same cache entry.
	get(t, handler, departuresAt(-72*time.Minute)) // 16:40
	if upstream.departureCalls.Load() != 1 {
		t.Errorf("upstream calls = %d, want 1: both spellings are one bucket",
			upstream.departureCalls.Load())
	}
}

func TestDeparturesAtAcceptsUTC(t *testing.T) {
	// Clients may send Z rather than the Sydney offset; the bucket is an
	// instant, so both name the same window.
	upstream := &fakeUpstream{departures: sampleDepartures()}
	_, handler := pinnedServer(t, upstream)

	if got := get(t, handler, "/api/v1/departures?from=200060&to=215020&at=2026-09-01T06:44:00Z"); got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
	}
	want := time.Date(2026, 9, 1, 16, 40, 0, 0, sydney)
	if !upstream.at().Equal(want) {
		t.Errorf("upstream at = %s, want %s",
			upstream.at().In(sydney).Format(time.RFC3339), want.Format(time.RFC3339))
	}
}

func TestUpstreamFailureMapsToStatus(t *testing.T) {
	cases := []struct {
		name     string
		err      error
		status   int
		wantCode string
	}{
		{"unavailable", fmt.Errorf("%w: HTTP 500", tfnsw.ErrUpstream), http.StatusBadGateway, "upstream_unavailable"},
		{"timeout", fmt.Errorf("%w: too slow", tfnsw.ErrTimeout), http.StatusGatewayTimeout, "upstream_timeout"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			handler := newTestServer(t, &fakeUpstream{err: tc.err})
			got := get(t, handler, "/api/v1/departures?from=200060&to=215020")
			if got.Code != tc.status {
				t.Fatalf("status = %d, want %d: %s", got.Code, tc.status, got.Body)
			}
			if cc := got.Header().Get("Cache-Control"); cc != noStore {
				t.Errorf("Cache-Control = %q, want %q", cc, noStore)
			}
			body := decodeError(t, got)
			if body.Error.Code != tc.wantCode {
				t.Errorf("code = %q, want %q", body.Error.Code, tc.wantCode)
			}
			if body.Error.Message == "" {
				t.Error("error message is empty")
			}
		})
	}
}

func TestServesStaleDataWhenUpstreamFails(t *testing.T) {
	upstream := &fakeUpstream{
		departures:    sampleDepartures(),
		errAfterFirst: fmt.Errorf("%w: HTTP 500", tfnsw.ErrUpstream),
	}
	server := New(upstream, filepath.Join(t.TempDir(), "no-web-dir"))
	handler := server.Handler()

	if got := get(t, handler, "/api/v1/departures?from=200060&to=215020"); got.Code != http.StatusOK {
		t.Fatalf("warm-up status = %d", got.Code)
	}
	// Expire the cached entry without waiting out the TTL.
	server.departures.SetClock(func() time.Time { return time.Now().Add(departuresTTL + time.Minute) })

	got := get(t, handler, "/api/v1/departures?from=200060&to=215020")
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 from stale cache: %s", got.Code, got.Body)
	}
	if got.Header().Get("X-Data-Stale") != "true" {
		t.Error("X-Data-Stale not set on stale data")
	}
	// Clients must be able to read the staleness flag cross-origin.
	if expose := got.Header().Get("Access-Control-Expose-Headers"); expose != "X-Data-Stale" {
		t.Errorf("Access-Control-Expose-Headers = %q, want X-Data-Stale", expose)
	}
	var body tfnsw.DeparturesResponse
	if err := json.Unmarshal(got.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	// generatedAt is the age of the data, which the client must be able to show.
	if body.GeneratedAt != sampleDepartures().GeneratedAt {
		t.Errorf("generatedAt = %q, want the cached fetch time", body.GeneratedAt)
	}
}

func TestStopsContract(t *testing.T) {
	upstream := &fakeUpstream{stops: sampleStops()}
	handler := newTestServer(t, upstream)
	got := get(t, handler, "/api/v1/stops?q=central")

	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
	}
	if cc := got.Header().Get("Cache-Control"); cc != stopsCacheControl {
		t.Errorf("Cache-Control = %q, want %q", cc, stopsCacheControl)
	}
	var body tfnsw.StopsResponse
	if err := json.Unmarshal(got.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if len(body.Stops) != 2 || body.Stops[0].ID != "200060" {
		t.Errorf("stops = %+v", body.Stops)
	}
	// Coordinates reach the client so it can rank saved trips by how near the
	// station is; the position it compares them against never leaves the phone.
	location := body.Stops[0].Location
	if location == nil || location.Lat != -33.884024 || location.Lon != 151.206203 {
		t.Errorf("location = %+v, want Central's coordinates", location)
	}
	// A station upstream has no coordinates for is null, not (0, 0) — which is
	// in the Atlantic and would win every nearest-station comparison outright.
	if body.Stops[1].Location != nil {
		t.Errorf("location = %+v, want null", *body.Stops[1].Location)
	}
	if !strings.Contains(got.Body.String(), `"location":null`) {
		t.Errorf("body = %s, want an explicit \"location\":null", got.Body)
	}

	// Repeating the search must not cost a second upstream request.
	get(t, handler, "/api/v1/stops?q=central")
	if upstream.stopCalls.Load() != 1 {
		t.Errorf("upstream calls = %d, want 1", upstream.stopCalls.Load())
	}
}

func TestStopsRejectsShortQuery(t *testing.T) {
	handler := newTestServer(t, &fakeUpstream{stops: sampleStops()})
	for _, target := range []string{"/api/v1/stops", "/api/v1/stops?q=", "/api/v1/stops?q=c", "/api/v1/stops?q=%20%20"} {
		got := get(t, handler, target)
		if got.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400", target, got.Code)
		}
		if code := decodeError(t, got).Error.Code; code != "bad_request" {
			t.Errorf("%s: code = %q, want bad_request", target, code)
		}
	}
}

func TestHealthz(t *testing.T) {
	got := get(t, newTestServer(t, &fakeUpstream{}), "/healthz")
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", got.Code)
	}
	if cc := got.Header().Get("Cache-Control"); cc != noStore {
		t.Errorf("Cache-Control = %q, want %q", cc, noStore)
	}
	var body map[string]bool
	if err := json.Unmarshal(got.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding body: %v", err)
	}
	if !body["ok"] {
		t.Errorf("body = %v, want ok true", body)
	}
}

func TestUnknownAPIPathAnswersInErrorEnvelope(t *testing.T) {
	got := get(t, newTestServer(t, &fakeUpstream{}), "/api/v1/nope")
	if got.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", got.Code)
	}
	if code := decodeError(t, got).Error.Code; code != "not_found" {
		t.Errorf("code = %q, want not_found", code)
	}
}

func TestStaticFilesAreServedWithoutShadowingTheAPI(t *testing.T) {
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "index.html"), []byte("<!doctype html>board"), 0o600); err != nil {
		t.Fatalf("writing index.html: %v", err)
	}
	handler := New(&fakeUpstream{departures: sampleDepartures()}, webDir).Handler()

	root := get(t, handler, "/")
	if root.Code != http.StatusOK {
		t.Fatalf("GET / = %d, want 200", root.Code)
	}
	if body := root.Body.String(); body != "<!doctype html>board" {
		t.Errorf("body = %q, want index.html", body)
	}
	// The static root must not swallow API routes.
	api := get(t, handler, "/api/v1/departures?from=200060&to=215020")
	if api.Code != http.StatusOK {
		t.Errorf("GET departures = %d, want 200", api.Code)
	}
	if health := get(t, handler, "/healthz"); health.Code != http.StatusOK {
		t.Errorf("GET /healthz = %d, want 200", health.Code)
	}
}

// Without an explicit Cache-Control, Cloudflare edge-caches static extensions
// for 4h and a deployed service-worker bump does not reach returning phones
// until it expires (observed live 2026-09-01). no-cache = revalidate; the
// service worker owns client-side speed.
func TestStaticFilesCarryNoCache(t *testing.T) {
	webDir := t.TempDir()
	for _, name := range []string{"sw.js", "app.css", "index.html"} {
		if err := os.WriteFile(filepath.Join(webDir, name), []byte("x"), 0o600); err != nil {
			t.Fatalf("writing %s: %v", name, err)
		}
	}
	handler := New(&fakeUpstream{}, webDir).Handler()

	for _, path := range []string{"/sw.js", "/app.css", "/", "/index.html"} {
		if cc := get(t, handler, path).Header().Get("Cache-Control"); cc != "no-cache" {
			t.Errorf("GET %s Cache-Control = %q, want no-cache", path, cc)
		}
	}
}

// Chrome will not offer to install a PWA whose manifest arrives as text/plain,
// which is what Go's MIME table does with .webmanifest left to itself.
func TestWebManifestIsServedAsManifestJSON(t *testing.T) {
	webDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(webDir, "manifest.webmanifest"), []byte(`{"name":"Next departures"}`), 0o600); err != nil {
		t.Fatalf("writing manifest: %v", err)
	}
	handler := New(&fakeUpstream{}, webDir).Handler()

	got := get(t, handler, "/manifest.webmanifest")
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", got.Code)
	}
	if ct := got.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/manifest+json") {
		t.Errorf("Content-Type = %q, want application/manifest+json", ct)
	}
}

func TestMissingWebDirIsNotAnError(t *testing.T) {
	// The client is built in a later phase; the backend must run without it.
	handler := newTestServer(t, &fakeUpstream{})
	if got := get(t, handler, "/"); got.Code != http.StatusNotFound {
		t.Errorf("GET / = %d, want 404", got.Code)
	}
}

func TestPreflightIsAnswered(t *testing.T) {
	handler := newTestServer(t, &fakeUpstream{})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodOptions, "/api/v1/stops?q=central", nil))
	if recorder.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", recorder.Code)
	}
	if origin := recorder.Header().Get("Access-Control-Allow-Origin"); origin != "*" {
		t.Errorf("Access-Control-Allow-Origin = %q, want *", origin)
	}
}
