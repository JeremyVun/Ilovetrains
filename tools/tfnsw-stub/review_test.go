package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func repoStub(t *testing.T, logf func(string, ...any)) *stub {
	t.Helper()
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &stub{routes: repoRoutes(t), dir: repoFixtures, logf: logf}
}

func TestEncodedKeysMatchAndRepeatedKeysReadTheFirstValue(t *testing.T) {
	server := repoStub(t, nil)

	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/trip?name%5Forigin=200060&name%5Fdestination=%32%31%35%30%32%30", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("percent-encoded keys and values: HTTP %d", recorder.Code)
	}

	recorder = httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/trip?name_origin=999999&name_origin=200060&name_destination=215020", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("a repeated key matched on its second value: HTTP %d", recorder.Code)
	}
	var miss struct {
		Query map[string]string `json:"query"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &miss); err != nil {
		t.Fatal(err)
	}
	if miss.Query["name_origin"] != "999999" {
		t.Errorf("the miss body reports %q for the repeated key, want the first value", miss.Query["name_origin"])
	}
}

func TestHeadAndPostMisses(t *testing.T) {
	server := httptest.NewServer(repoStub(t, nil))
	defer server.Close()

	head, err := http.Head(server.URL + "/trip?name_origin=1&name_destination=2")
	if err != nil {
		t.Fatal(err)
	}
	headBody, _ := io.ReadAll(head.Body)
	head.Body.Close()
	if head.StatusCode != http.StatusNotFound || len(headBody) != 0 || head.Header.Get("Content-Type") != "application/json" {
		t.Errorf("HEAD miss: %d %q %q", head.StatusCode, head.Header.Get("Content-Type"), headBody)
	}

	post, err := http.Post(server.URL+"/trip?name_origin=1&name_destination=2", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	postBody, _ := io.ReadAll(post.Body)
	post.Body.Close()
	if post.StatusCode != http.StatusNotFound || !bytes.Contains(postBody, []byte(`"no fixture"`)) {
		t.Errorf("POST miss: %d %s", post.StatusCode, postBody)
	}

	hit, err := http.Post(server.URL+"/trip?name_origin=200060&name_destination=215020", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	hit.Body.Close()
	if hit.StatusCode != http.StatusOK {
		t.Errorf("the stub answers only GET: POST hit was HTTP %d", hit.StatusCode)
	}
}

func TestConcurrentRequestsServeTheSameBytes(t *testing.T) {
	server := httptest.NewServer(repoStub(t, nil))
	defer server.Close()
	want, err := os.ReadFile(filepath.Join(repoFixtures, "trip_central_parramatta.json"))
	if err != nil {
		t.Fatal(err)
	}

	var wg sync.WaitGroup
	errs := make(chan error, 64)
	for i := 0; i < 64; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, err := http.Get(server.URL + "/trip?name_origin=200060&name_destination=215020&itdTime=" + fmt.Sprint(i))
			if err != nil {
				errs <- err
				return
			}
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if resp.StatusCode != http.StatusOK || !bytes.Equal(body, want) {
				errs <- fmt.Errorf("HTTP %d with %d bytes", resp.StatusCode, len(body))
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestAFixtureThatVanishesAfterLoadIsAServerError(t *testing.T) {
	dir := t.TempDir()
	fixture := filepath.Join(dir, "gone.json")
	if err := os.WriteFile(fixture, []byte(`{"journeys":[]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	routesPath := filepath.Join(dir, "routes.json")
	if err := os.WriteFile(routesPath, []byte(`[{"path":"/trip","fixture":"gone.json"}]`), 0o600); err != nil {
		t.Fatal(err)
	}
	routes, err := loadRoutes(routesPath, dir)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(fixture); err != nil {
		t.Fatal(err)
	}

	recorder := httptest.NewRecorder()
	(&stub{routes: routes, dir: dir, logf: func(string, ...any) {}}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/trip", nil))
	if recorder.Code != http.StatusInternalServerError {
		t.Errorf("HTTP %d, want 500 rather than a 404 that tells a fixer to capture a fixture that exists in the table", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "gone.json") {
		t.Errorf("the error does not name the fixture: %s", recorder.Body.String())
	}
}

func TestASymlinkedFixtureCannotLeaveTheDirectory(t *testing.T) {
	outside := t.TempDir()
	secret := filepath.Join(outside, "secret.json")
	if err := os.WriteFile(secret, []byte(`{"leaked":true}`), 0o600); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.Symlink(secret, filepath.Join(dir, "link.json")); err != nil {
		t.Fatal(err)
	}
	routesPath := filepath.Join(dir, "routes.json")
	if err := os.WriteFile(routesPath, []byte(`[{"path":"/trip","fixture":"link.json"}]`), 0o600); err != nil {
		t.Fatal(err)
	}

	routes, err := loadRoutes(routesPath, dir)
	if err != nil {
		return
	}
	recorder := httptest.NewRecorder()
	(&stub{routes: routes, dir: dir, logf: func(string, ...any) {}}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/trip", nil))
	if recorder.Code == http.StatusOK && strings.Contains(recorder.Body.String(), "leaked") {
		t.Fatalf("a symlink under --fixtures served %s, outside the directory the stub claims to read", secret)
	}
}

func TestLogLinesCarryNoHeaderOrQuery(t *testing.T) {
	var lines []string
	server := repoStub(t, func(format string, args ...any) { lines = append(lines, fmt.Sprintf(format, args...)) })
	for _, target := range []string{
		"/trip?name_origin=200060&name_destination=215020&apikey=SECRET-VALUE",
		"/trip?name_origin=SECRET-VALUE&name_destination=none",
	} {
		request := httptest.NewRequest(http.MethodGet, target, nil)
		request.Header.Set("Authorization", "apikey SECRET-VALUE")
		server.ServeHTTP(httptest.NewRecorder(), request)
	}
	if len(lines) != 2 {
		t.Fatalf("logged %d lines, want one per request", len(lines))
	}
	for _, line := range lines {
		if strings.Contains(line, "SECRET-VALUE") || strings.Contains(strings.ToLower(line), "authorization") {
			t.Errorf("log line echoes request data: %q", line)
		}
	}
}

func TestAnchorlessRoutesHoldNoJourneysAndListAsDash(t *testing.T) {
	var out bytes.Buffer
	routes := repoRoutes(t)
	if err := writeAnchors(&out, routes); err != nil {
		t.Fatal(err)
	}
	listed := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(listed) != len(routes) {
		t.Fatalf("%d lines for %d routes", len(listed), len(routes))
	}
	for i, route := range routes {
		if !strings.HasPrefix(route.Fixture, "trip_") {
			continue
		}
		journeys := len(tripJourneys(t, route.Fixture))
		if (route.Anchor == "") != (journeys == 0) {
			t.Errorf("%s: anchor %q with %d journeys", route.Fixture, route.Anchor, journeys)
		}
		if route.Anchor == "" && !strings.HasSuffix(listed[i], " -") {
			t.Errorf("%s: --list-anchors prints %q, want a trailing dash", route.Fixture, listed[i])
		}
	}
}

// Home keeps a row while floor(departure minute) >= floor(now minute) on the
// controlling departure (web/js/rowmodel.js), so every journey must clear the
// anchor on the first service leg's controlling time.
func TestAnchorsKeepEveryJourneyOnHome(t *testing.T) {
	for _, route := range repoRoutes(t) {
		if !strings.HasPrefix(route.Fixture, "trip_") || route.Anchor == "" {
			continue
		}
		anchor, err := time.Parse(time.RFC3339, route.Anchor)
		if err != nil {
			t.Fatal(err)
		}
		anchorMinute := anchor.Truncate(time.Minute)
		for index, journey := range tripJourneys(t, route.Fixture) {
			leg, ok := firstServiceLeg(journey)
			if !ok {
				t.Errorf("%s journey %d has no service leg", route.Fixture, index)
				continue
			}
			value := controllingDeparture(leg)
			departure, err := time.Parse(time.RFC3339, value)
			if err != nil {
				t.Fatalf("%s journey %d: %v", route.Fixture, index, err)
			}
			if departure.Truncate(time.Minute).Before(anchorMinute) {
				t.Errorf("%s journey %d: departure %s is before anchor %s, so Home drops it", route.Fixture, index, value, route.Anchor)
			}
			if index == 0 && departure.Sub(anchor) > 10*time.Minute {
				t.Errorf("%s: first departure %s is %s after the anchor", route.Fixture, value, departure.Sub(anchor))
			}
		}
	}
}

type fixtureLeg struct {
	Origin struct {
		DepartureTimePlanned   string `json:"departureTimePlanned"`
		DepartureTimeEstimated string `json:"departureTimeEstimated"`
	} `json:"origin"`
	Transportation struct {
		Product struct {
			Class int `json:"class"`
		} `json:"product"`
	} `json:"transportation"`
}

type fixtureJourney struct {
	Legs []fixtureLeg `json:"legs"`
}

func tripJourneys(t *testing.T, fixture string) []fixtureJourney {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(repoFixtures, fixture))
	if err != nil {
		t.Fatal(err)
	}
	var parsed struct {
		Journeys []fixtureJourney `json:"journeys"`
	}
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	return parsed.Journeys
}

// Realtime replaces the timetable once the operator reports it, so a leg with
// an estimated departure leaves at that time rather than at its planned one.
func controllingDeparture(leg fixtureLeg) string {
	if leg.Origin.DepartureTimeEstimated != "" {
		return leg.Origin.DepartureTimeEstimated
	}
	return leg.Origin.DepartureTimePlanned
}

func firstServiceLeg(journey fixtureJourney) (fixtureLeg, bool) {
	for _, leg := range journey.Legs {
		if class := leg.Transportation.Product.Class; class != 99 && class != 100 {
			return leg, true
		}
	}
	return fixtureLeg{}, false
}
