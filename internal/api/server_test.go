package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"trains/internal/tfnsw"
)

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
}

func (f *fakeUpstream) Departures(_ context.Context, from, to string, limit int) (*tfnsw.DeparturesResponse, error) {
	call := f.departureCalls.Add(1)
	f.lastLimit.Store(int32(limit))
	if f.err != nil {
		return nil, f.err
	}
	if call > 1 && f.errAfterFirst != nil {
		return nil, f.errAfterFirst
	}
	response := *f.departures
	response.From.ID, response.To.ID = from, to
	return &response, nil
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
		{ID: "200060", Name: "Central Station", Modes: []string{"train", "metro"}},
	}}
}

func newTestServer(t *testing.T, upstream Upstream) http.Handler {
	t.Helper()
	return New(upstream, filepath.Join(t.TempDir(), "no-web-dir")).Handler()
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
	if len(body.Stops) != 1 || body.Stops[0].ID != "200060" {
		t.Errorf("stops = %+v", body.Stops)
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
