package tfnsw

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync/atomic"
	"testing"
	"time"
)

// These tests exercise the client against local httptest servers only; nothing
// here reaches Transport for NSW.

func testClient(t *testing.T, handler http.Handler) (*Client, *httptest.Server) {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	client, err := NewClient("test-key")
	if err != nil {
		t.Fatalf("NewClient: %v", err)
	}
	client.BaseURL = server.URL
	client.AttemptTimeout = 200 * time.Millisecond
	return client, server
}

func TestClientSendsAuthAndRequiredTripParams(t *testing.T) {
	var got url.Values
	var auth string
	client, _ := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Query()
		auth = r.Header.Get("Authorization")
		if r.URL.Path != "/trip" {
			t.Errorf("path = %q, want /trip", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"journeys":[]}`))
	}))

	if _, err := client.Departures(context.Background(), "200060", "215020", 4); err != nil {
		t.Fatalf("Departures: %v", err)
	}

	if auth != "apikey test-key" {
		t.Errorf("Authorization = %q, want %q", auth, "apikey test-key")
	}
	want := map[string]string{
		"outputFormat":      "rapidJSON",
		"depArrMacro":       "dep",
		"type_origin":       "any",
		"name_origin":       "200060",
		"type_destination":  "any",
		"name_destination":  "215020",
		"calcNumberOfTrips": "4",
		"TfNSWTR":           "true",
		// Exclusions that leave train (1) and metro (2) only.
		"excludedMeans": "checkbox",
		"exclMOT_4":     "1",
		"exclMOT_5":     "1",
		"exclMOT_7":     "1",
		"exclMOT_9":     "1",
		"exclMOT_11":    "1",
	}
	for key, value := range want {
		if got.Get(key) != value {
			t.Errorf("param %s = %q, want %q", key, got.Get(key), value)
		}
	}
	if len(got.Get("itdDate")) != 8 || len(got.Get("itdTime")) != 4 {
		t.Errorf("itdDate/itdTime = %q/%q, want YYYYMMDD/HHMM", got.Get("itdDate"), got.Get("itdTime"))
	}
}

func TestClientStopFinderUsesTypeAny(t *testing.T) {
	// type_sf=stop is broken upstream ("stop invalid", code -2000).
	var got url.Values
	client, _ := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got = r.URL.Query()
		if r.URL.Path != "/stop_finder" {
			t.Errorf("path = %q, want /stop_finder", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"locations":[]}`))
	}))

	if _, err := client.Stops(context.Background(), "parramatta"); err != nil {
		t.Fatalf("Stops: %v", err)
	}
	if got.Get("type_sf") != "any" {
		t.Errorf("type_sf = %q, want any", got.Get("type_sf"))
	}
	if got.Get("name_sf") != "parramatta" {
		t.Errorf("name_sf = %q, want parramatta", got.Get("name_sf"))
	}
	if got.Get("TfNSWSF") != "true" {
		t.Errorf("TfNSWSF = %q, want true", got.Get("TfNSWSF"))
	}
}

func TestClientRetriesOnceOnServerError(t *testing.T) {
	var calls atomic.Int32
	client, _ := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		if calls.Add(1) == 1 {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		_, _ = w.Write([]byte(`{"locations":[]}`))
	}))

	if _, err := client.Stops(context.Background(), "central"); err != nil {
		t.Fatalf("Stops: %v", err)
	}
	if calls.Load() != 2 {
		t.Errorf("upstream calls = %d, want 2", calls.Load())
	}
}

func TestClientGivesUpAfterRetry(t *testing.T) {
	var calls atomic.Int32
	client, _ := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadGateway)
	}))

	_, err := client.Stops(context.Background(), "central")
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("err = %v, want ErrUpstream", err)
	}
	if calls.Load() != 2 {
		t.Errorf("upstream calls = %d, want 2", calls.Load())
	}
}

func TestClientDoesNotRetryClientErrors(t *testing.T) {
	// A 403 means our key or request is wrong; a retry only burns quota.
	var calls atomic.Int32
	client, _ := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusForbidden)
	}))

	_, err := client.Stops(context.Background(), "central")
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("err = %v, want ErrUpstream", err)
	}
	if calls.Load() != 1 {
		t.Errorf("upstream calls = %d, want 1", calls.Load())
	}
}

func TestClientTimeoutIsDistinguishable(t *testing.T) {
	// 504 vs 502 in our API depends on this classification.
	client, _ := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(2 * time.Second):
		}
	}))
	client.MaxAttempts = 1

	_, err := client.Stops(context.Background(), "central")
	if !errors.Is(err, ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
}

func TestClientRejectsGarbageBody(t *testing.T) {
	client, _ := testClient(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`<html>gateway error</html>`))
	}))

	_, err := client.Stops(context.Background(), "central")
	if !errors.Is(err, ErrUpstream) {
		t.Fatalf("err = %v, want ErrUpstream", err)
	}
}

func TestNewClientRequiresKey(t *testing.T) {
	if _, err := NewClient(""); err == nil {
		t.Error("NewClient(\"\") succeeded, want an error")
	}
}
