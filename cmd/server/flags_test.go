package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"trains/internal/api"
)

func TestPublicFlagsConfiguration(t *testing.T) {
	values, closeClient, err := publicFlagsFromEnv(func(string) string { return "" })
	if err != nil || len(values()) != 0 {
		t.Fatalf("unconfigured provider: %v", err)
	}
	closeClient()
	for _, base := range []string{"http://flags.internal", "file:///tmp/flags", "https://secret@flags.internal"} {
		_, _, err := publicFlagsFromEnv(func(key string) string {
			if key == "FLAGS_URL" {
				return base
			}
			return ""
		})
		if err == nil || strings.Contains(err.Error(), "secret") {
			t.Fatalf("expected safe configuration error, got %v", err)
		}
	}
}

func TestPublicFlagsStreamToBrowser(t *testing.T) {
	updates := make(chan string)
	requests := make(chan *http.Request, 1)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case requests <- r.Clone(r.Context()):
		default:
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		for {
			select {
			case snapshot := <-updates:
				fmt.Fprintf(w, "event: put\ndata: %s\n\n", snapshot)
				w.(http.Flusher).Flush()
			case <-r.Context().Done():
				return
			}
		}
	}))
	defer upstream.Close()
	values, closeClient, err := publicFlagsFromEnv(func(key string) string {
		switch key {
		case "FLAGS_URL":
			return upstream.URL
		case "FLAGS_KEY":
			return "ffk_test_internal_only"
		default:
			return ""
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	defer closeClient()
	handler := api.New(nil, "", api.WithPublicFlags(values)).Handler()
	check := func(want bool) bool {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/v1/flags", nil))
		var got map[string]bool
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &got) != nil || len(got) != 1 || !strings.Contains(w.Header().Get("Cache-Control"), "no-store") {
			t.Fatalf("unexpected public response: %d %s", w.Code, w.Body.String())
		}
		return got["tiny_train"] == want
	}
	// A connected stream withholding its first snapshot cannot delay boot.
	if !check(false) {
		t.Fatal("enabled before first sync")
	}
	select {
	case request := <-requests:
		if request.URL.Path != "/v1/projects/ilovetrains/environments/production/snapshot/stream" || request.Header.Get("Authorization") != "Bearer ffk_test_internal_only" || request.Header.Get("X-User") != "svc:ilovetrains" || request.Header.Get("X-Application") != "ilovetrains-api" {
			t.Fatal("incorrect internal SDK request")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("SDK did not connect")
	}
	for i, state := range []struct{ public, enabled bool }{{true, true}, {true, false}, {true, true}, {false, true}, {true, true}} {
		snapshot := fmt.Sprintf(`{"version":"%d","project":"ilovetrains","environment":"production","flags":[{"key":"tiny_train","type":"boolean","public":%t,"enabled":%t,"variations":[{"key":"off","value":false},{"key":"on","value":true}],"off_variation":"off","fallthrough":{"variation":"on"}},{"key":"private.secret","type":"string","public":false,"enabled":true,"variations":[{"key":"x","value":"never expose"}],"off_variation":"x","fallthrough":{"variation":"x"}}]}`, i, state.public, state.enabled)
		select {
		case updates <- snapshot:
		case <-time.After(3 * time.Second):
			t.Fatal("stream blocked")
		}
		deadline := time.Now().Add(3 * time.Second)
		for !check(state.public && state.enabled) {
			if time.Now().After(deadline) {
				t.Fatalf("update %d did not reach browser", i)
			}
			time.Sleep(time.Millisecond)
		}
	}
	select {
	case updates <- `{"version":"deleted","project":"ilovetrains","environment":"production","flags":[]}`:
	case <-time.After(3 * time.Second):
		t.Fatal("stream blocked")
	}
	deadline := time.Now().Add(3 * time.Second)
	for !check(false) {
		if time.Now().After(deadline) {
			t.Fatal("deleted flag remained enabled")
		}
		time.Sleep(time.Millisecond)
	}
}
