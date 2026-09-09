package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Route matches a request by path and a subset of its query. Unlisted query
// keys, which carry the date, time and output format the server computes from
// its own clock, are ignored so a captured response keeps answering.
type Route struct {
	Path    string            `json:"path"`
	Query   map[string]string `json:"query,omitempty"`
	Fixture string            `json:"fixture"`
	Anchor  string            `json:"anchor,omitempty"`
}

type stub struct {
	routes []Route
	dir    string
	logf   func(string, ...any)
}

func loadRoutes(routesPath, fixturesDir string) ([]Route, error) {
	body, err := os.ReadFile(routesPath)
	if err != nil {
		return nil, err
	}
	var routes []Route
	if err := json.Unmarshal(body, &routes); err != nil {
		return nil, fmt.Errorf("reading %s: %w", routesPath, err)
	}
	if len(routes) == 0 {
		return nil, fmt.Errorf("%s lists no routes", routesPath)
	}
	for _, route := range routes {
		if err := route.validate(fixturesDir); err != nil {
			return nil, err
		}
	}
	return routes, nil
}

func (r Route) validate(fixturesDir string) error {
	if !strings.HasPrefix(r.Path, "/") {
		return fmt.Errorf("route %q: path must start with /", r.Fixture)
	}
	if r.Fixture == "" {
		return fmt.Errorf("route %s: fixture is empty", r.Path)
	}
	path, err := fixturePath(fixturesDir, r.Fixture)
	if err != nil {
		return err
	}
	if _, err := os.Stat(path); err != nil {
		return err
	}
	if r.Anchor != "" {
		if _, err := time.Parse(time.RFC3339, r.Anchor); err != nil {
			return fmt.Errorf("route %s: anchor %q: %w", r.Fixture, r.Anchor, err)
		}
	}
	return nil
}

// Both sides are resolved before the containment check so a symlink in the
// fixtures directory cannot serve a file from outside it.
func fixturePath(dir, fixture string) (string, error) {
	root, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", fmt.Errorf("fixture %q: %w", fixture, err)
	}
	resolved, err := filepath.EvalSymlinks(filepath.Join(root, filepath.FromSlash(fixture)))
	if err != nil {
		return "", fmt.Errorf("fixture %q: %w", fixture, err)
	}
	within, err := filepath.Rel(root, resolved)
	if err != nil || within == ".." || strings.HasPrefix(within, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("fixture %q escapes %s", fixture, dir)
	}
	return resolved, nil
}

func (r Route) matches(path string, query url.Values) bool {
	if r.Path != path {
		return false
	}
	for key, want := range r.Query {
		if !query.Has(key) || query.Get(key) != want {
			return false
		}
	}
	return true
}

func match(routes []Route, path string, query url.Values) (Route, bool) {
	for _, route := range routes {
		if route.matches(path, query) {
			return route, true
		}
	}
	return Route{}, false
}

func (s *stub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	route, ok := match(s.routes, r.URL.Path, query)
	if !ok {
		s.logf("%s %s 404", r.Method, r.URL.Path)
		writeMiss(w, r.URL.Path, query)
		return
	}
	s.logf("%s %s %s", r.Method, r.URL.Path, route.Fixture)
	path, err := fixturePath(s.dir, route.Fixture)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	body, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", contentType(route.Fixture))
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func contentType(fixture string) string {
	switch filepath.Ext(fixture) {
	case ".json":
		return "application/json"
	case ".pb":
		return "application/x-protobuf"
	default:
		return "application/octet-stream"
	}
}

func writeMiss(w http.ResponseWriter, path string, query url.Values) {
	flat := make(map[string]string, len(query))
	for key := range query {
		flat[key] = query.Get(key)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusNotFound)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": "no fixture",
		"path":  path,
		"query": flat,
		"hint":  "capture one with tools/probe-tfnsw.sh and add a route to tools/fixtures/stub-routes.json",
	})
}

func writeAnchors(w io.Writer, routes []Route) error {
	for _, route := range routes {
		if _, err := fmt.Fprintf(w, "%s %s %s %s\n", route.Path, queryString(route.Query),
			route.Fixture, orDash(route.Anchor)); err != nil {
			return err
		}
	}
	return nil
}

func queryString(query map[string]string) string {
	if len(query) == 0 {
		return "-"
	}
	keys := make([]string, 0, len(query))
	for key := range query {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		parts = append(parts, key+"="+query[key])
	}
	return strings.Join(parts, "&")
}

func orDash(value string) string {
	if value == "" {
		return "-"
	}
	return value
}
