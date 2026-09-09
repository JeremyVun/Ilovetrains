package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

const repoFixtures = "../fixtures"

func repoRoutes(t *testing.T) []Route {
	t.Helper()
	routes, err := loadRoutes(filepath.Join(repoFixtures, "stub-routes.json"), repoFixtures)
	if err != nil {
		t.Fatalf("loading committed routes: %v", err)
	}
	return routes
}

func TestMatchIgnoresUnlistedQueryKeys(t *testing.T) {
	routes := []Route{{Path: "/trip", Query: map[string]string{"name_origin": "200060", "name_destination": "215020"}, Fixture: "trip_central_parramatta.json"}}
	query := url.Values{}
	query.Set("name_origin", "200060")
	query.Set("name_destination", "215020")
	query.Set("itdDate", "20260909")
	query.Set("itdTime", "1013")
	query.Set("outputFormat", "rapidJSON")

	route, ok := match(routes, "/trip", query)
	if !ok || route.Fixture != "trip_central_parramatta.json" {
		t.Fatalf("got %+v, %v; want the Central to Parramatta fixture", route, ok)
	}
}

func TestMatchNeedsEveryListedKey(t *testing.T) {
	routes := []Route{{Path: "/trip", Query: map[string]string{"name_origin": "200060", "name_destination": "215020"}}}
	query := url.Values{}
	query.Set("name_origin", "200060")
	if _, ok := match(routes, "/trip", query); ok {
		t.Fatal("a missing listed key matched")
	}
	query.Set("name_destination", "213820")
	if _, ok := match(routes, "/trip", query); ok {
		t.Fatal("a different value matched")
	}
	if _, ok := match(routes, "/departure_mon", url.Values{}); ok {
		t.Fatal("another path matched")
	}
}

func TestFirstMatchWins(t *testing.T) {
	routes := []Route{
		{Path: "/trip", Query: map[string]string{"name_origin": "200060", "itdDate": "20260901"}, Fixture: "past.json"},
		{Path: "/trip", Query: map[string]string{"name_origin": "200060"}, Fixture: "live.json"},
	}
	past := url.Values{"name_origin": {"200060"}, "itdDate": {"20260901"}}
	if route, _ := match(routes, "/trip", past); route.Fixture != "past.json" {
		t.Fatalf("got %q, want past.json", route.Fixture)
	}
	live := url.Values{"name_origin": {"200060"}, "itdDate": {"20260909"}}
	if route, _ := match(routes, "/trip", live); route.Fixture != "live.json" {
		t.Fatalf("got %q, want live.json", route.Fixture)
	}
}

func TestFeedRouteMatchesOnPathAlone(t *testing.T) {
	routes := repoRoutes(t)
	route, ok := match(routes, "/v2/gtfs/realtime/sydneytrains", url.Values{})
	if !ok || !strings.HasSuffix(route.Fixture, ".pb") {
		t.Fatalf("got %+v, %v; want the realtime capture", route, ok)
	}
}

func TestServesFixtureVerbatim(t *testing.T) {
	server := &stub{routes: repoRoutes(t), dir: repoFixtures, logf: func(string, ...any) {}}
	for _, test := range []struct {
		target      string
		fixture     string
		contentType string
	}{
		{"/trip?name_origin=200060&name_destination=215020&itdDate=20260909", "trip_central_parramatta.json", "application/json"},
		{"/trip?name_origin=200060&name_destination=215020&itdDate=20260901", "trip_central_parramatta_past.json", "application/json"},
		{"/v2/gtfs/realtime/sydneytrains", "gtfs_realtime_sydneytrains_20260906.pb", "application/x-protobuf"},
	} {
		recorder := httptest.NewRecorder()
		server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, test.target, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s: HTTP %d", test.target, recorder.Code)
		}
		if got := recorder.Header().Get("Content-Type"); got != test.contentType {
			t.Errorf("%s: content type %q, want %q", test.target, got, test.contentType)
		}
		want, err := os.ReadFile(filepath.Join(repoFixtures, test.fixture))
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(recorder.Body.Bytes(), want) {
			t.Errorf("%s: body is not %s byte for byte", test.target, test.fixture)
		}
	}
}

func TestMissBody(t *testing.T) {
	server := &stub{routes: repoRoutes(t), dir: repoFixtures, logf: func(string, ...any) {}}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/trip?name_origin=200060&name_destination=999999", nil))

	if recorder.Code != http.StatusNotFound {
		t.Fatalf("HTTP %d, want 404", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content type %q, want application/json", got)
	}
	var body struct {
		Error string            `json:"error"`
		Path  string            `json:"path"`
		Query map[string]string `json:"query"`
		Hint  string            `json:"hint"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error != "no fixture" || body.Path != "/trip" {
		t.Errorf("got %+v", body)
	}
	if body.Query["name_destination"] != "999999" || body.Query["name_origin"] != "200060" {
		t.Errorf("query %+v", body.Query)
	}
	if !strings.Contains(body.Hint, "probe-tfnsw.sh") || !strings.Contains(body.Hint, "stub-routes.json") {
		t.Errorf("hint %q", body.Hint)
	}
}

func TestUnmatchedSchedulePathIsAMiss(t *testing.T) {
	server := &stub{routes: repoRoutes(t), dir: repoFixtures, logf: func(string, ...any) {}}
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/v1/gtfs/schedule/sydneytrains", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("HTTP %d, want 404", recorder.Code)
	}
}

func TestListAnchors(t *testing.T) {
	var out bytes.Buffer
	routes := []Route{
		{Path: "/trip", Query: map[string]string{"name_destination": "215020", "name_origin": "200060"}, Fixture: "trip_central_parramatta.json", Anchor: "2026-08-31T22:44:00+10:00"},
		{Path: "/v2/gtfs/realtime/sydneytrains", Fixture: "gtfs_realtime_sydneytrains_20260906.pb"},
	}
	if err := writeAnchors(&out, routes); err != nil {
		t.Fatal(err)
	}
	want := "/trip name_destination=215020&name_origin=200060 trip_central_parramatta.json 2026-08-31T22:44:00+10:00\n" +
		"/v2/gtfs/realtime/sydneytrains - gtfs_realtime_sydneytrains_20260906.pb -\n"
	if out.String() != want {
		t.Fatalf("got:\n%s\nwant:\n%s", out.String(), want)
	}
}

func TestListAnchorsRunExitsAfterPrinting(t *testing.T) {
	if err := run(0, repoFixtures, filepath.Join(repoFixtures, "stub-routes.json"), true); err != nil {
		t.Fatalf("--list-anchors: %v", err)
	}
}

// Every committed anchor names a real Sydney instant a few minutes before its
// fixture's first planned departure, which is what a regression case pins its
// browser clock to.
func TestCommittedAnchorsPrecedeTheirFixture(t *testing.T) {
	sydney, err := time.LoadLocation("Australia/Sydney")
	if err != nil {
		t.Fatal(err)
	}
	for _, route := range repoRoutes(t) {
		if route.Anchor == "" {
			continue
		}
		anchor, err := time.Parse(time.RFC3339, route.Anchor)
		if err != nil {
			t.Fatalf("%s: %v", route.Fixture, err)
		}
		if _, offset := anchor.In(sydney).Zone(); offset != 10*3600 {
			t.Errorf("%s: anchor %s is not Sydney standard time", route.Fixture, route.Anchor)
		}
		if !strings.HasPrefix(route.Fixture, "trip_") {
			continue
		}
		departure := firstControllingDeparture(t, route.Fixture)
		gap := departure.Sub(anchor)
		if gap <= 0 || gap > 10*time.Minute {
			t.Errorf("%s: anchor %s is %s from the first departure %s", route.Fixture, route.Anchor, gap, departure)
		}
	}
}

func TestEveryTripFixtureHasARoute(t *testing.T) {
	entries, err := filepath.Glob(filepath.Join(repoFixtures, "trip_*.json"))
	if err != nil {
		t.Fatal(err)
	}
	routes := repoRoutes(t)
	for _, entry := range entries {
		name := filepath.Base(entry)
		found := false
		for _, route := range routes {
			if route.Fixture == name {
				found = true
			}
		}
		if !found {
			t.Errorf("%s has no route in stub-routes.json", name)
		}
	}
}

func TestLoadRoutesRejectsAMissingFixture(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "routes.json")
	if err := os.WriteFile(path, []byte(`[{"path":"/trip","fixture":"absent.json"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadRoutes(path, dir); err == nil {
		t.Fatal("a route naming a missing fixture loaded")
	}
}

func TestLoadRoutesRejectsAFixtureOutsideTheDirectory(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "routes.json")
	if err := os.WriteFile(path, []byte(`[{"path":"/trip","fixture":"../../etc/hosts"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadRoutes(path, dir); err == nil {
		t.Fatal("a route escaping the fixtures directory loaded")
	}
}

func firstControllingDeparture(t *testing.T, fixture string) time.Time {
	t.Helper()
	journeys := tripJourneys(t, fixture)
	if len(journeys) == 0 {
		t.Fatalf("%s has no journeys to anchor to", fixture)
	}
	leg, ok := firstServiceLeg(journeys[0])
	if !ok {
		t.Fatalf("%s has no service leg to anchor to", fixture)
	}
	departure, err := time.Parse(time.RFC3339, controllingDeparture(leg))
	if err != nil {
		t.Fatal(err)
	}
	return departure
}
