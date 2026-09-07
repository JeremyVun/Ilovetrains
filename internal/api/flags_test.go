package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"

	"trains/internal/tfnsw"
)

func flagsProvider(values map[string]any) Option {
	return WithPublicFlags(func() map[string]any { return values })
}

func TestPublicFlagsBoundary(t *testing.T) {
	published := map[string]string{"tiny_train": "tiny_train", "transferLimit": "transfer_limit"}
	for name, key := range published {
		for _, tc := range []struct {
			name   string
			values func() map[string]any
			want   bool
		}{
			{"unconfigured", nil, false},
			{"missing", func() map[string]any { return nil }, false},
			{"invalid", func() map[string]any { return map[string]any{key: "true"} }, false},
			{"off", func() map[string]any { return map[string]any{key: false} }, false},
			{"on", func() map[string]any {
				return map[string]any{
					key: true, "private.flag": "secret", "rules": []string{"never expose"},
				}
			}, true},
		} {
			t.Run(name+"/"+tc.name, func(t *testing.T) {
				s := New(nil, "", WithPublicFlags(tc.values))
				r := httptest.NewRequest("GET", "/api/v1/flags", nil)
				w := httptest.NewRecorder()
				s.Handler().ServeHTTP(w, r)
				if w.Code != 200 || w.Header().Get("Cache-Control") != "no-store" {
					t.Fatalf("status/cache = %d / %q", w.Code, w.Header().Get("Cache-Control"))
				}
				var values map[string]bool
				if err := json.Unmarshal(w.Body.Bytes(), &values); err != nil {
					t.Fatal(err)
				}
				if len(values) != len(published) || values[name] != tc.want {
					t.Fatalf("public values = %v, want %s %v and the other published names only",
						values, name, tc.want)
				}
				for other := range published {
					if other != name && values[other] {
						t.Fatalf("public values = %v, want %s off", values, other)
					}
				}
			})
		}
	}
}

func TestJourneyTransferLimit(t *testing.T) {
	cases := []struct {
		name, value string
		want        int
		wantErr     bool
	}{
		{"omitted", "", tfnsw.NoTransferLimit, false},
		{"blank", "   ", tfnsw.NoTransferLimit, false},
		{"two changes", "2", 2, false},
		{"direct only", "0", 0, false},
		{"upper bound", "9", 9, false},
		{"above the upper bound", "10", 0, true},
		{"not a number", "x", 0, true},
		{"negative", "-1", 0, true},
		{"fractional", "2.5", 0, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := journeyTransferLimit(tc.value)
			if !tc.wantErr {
				if err != nil {
					t.Fatalf("journeyTransferLimit(%q): %v", tc.value, err)
				}
				if got != tc.want {
					t.Errorf("journeyTransferLimit(%q) = %d, want %d", tc.value, got, tc.want)
				}
				return
			}
			var clientErr clientError
			if !errors.As(err, &clientErr) {
				t.Fatalf("journeyTransferLimit(%q) = %d, %v, want a bad request", tc.value, got, err)
			}
			if want := "transferLimit must be a whole number between 0 and 9"; clientErr.message != want {
				t.Errorf("message = %q, want %q", clientErr.message, want)
			}
		})
	}
}

func TestDeparturesTransferLimitKeysTheCacheOnlyWhenFlagged(t *testing.T) {
	const uncapped = "/api/v1/departures?from=200060&to=215020"
	const capped = "/api/v1/departures?from=200060&to=215020&transferLimit=2"

	cases := []struct {
		name              string
		options           []Option
		wantCalls         int32
		wantTransferLimit int32
	}{
		{"no provider", nil, 1, tfnsw.NoTransferLimit},
		{"provider with no snapshot", []Option{flagsProvider(nil)}, 1, tfnsw.NoTransferLimit},
		{"flag off", []Option{flagsProvider(map[string]any{"transfer_limit": false})}, 1, tfnsw.NoTransferLimit},
		{"flag not a boolean", []Option{flagsProvider(map[string]any{"transfer_limit": "true"})}, 1, tfnsw.NoTransferLimit},
		{"flag on", []Option{flagsProvider(map[string]any{"transfer_limit": true})}, 2, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			upstream := &fakeUpstream{departures: sampleDepartures()}
			handler := newTestServer(t, upstream, tc.options...)
			for _, target := range []string{uncapped, capped} {
				if got := get(t, handler, target); got.Code != http.StatusOK {
					t.Fatalf("%s: status = %d, want 200: %s", target, got.Code, got.Body)
				}
			}
			if calls := upstream.departureCalls.Load(); calls != tc.wantCalls {
				t.Errorf("upstream calls = %d, want %d", calls, tc.wantCalls)
			}
			if got := upstream.lastTransferLimit.Load(); got != tc.wantTransferLimit {
				t.Errorf("TransferLimit reaching upstream = %d, want %d", got, tc.wantTransferLimit)
			}
		})
	}
}

func TestDeparturesRejectsABadTransferLimitWhicheverWayTheFlagIsSet(t *testing.T) {
	// Validation never varies with a switch the caller cannot see.
	for _, options := range [][]Option{nil, {flagsProvider(map[string]any{"transfer_limit": true})}} {
		handler := newTestServer(t, &fakeUpstream{departures: sampleDepartures()}, options...)
		for _, value := range []string{"10", "-1", "x", "2.5"} {
			target := fmt.Sprintf("/api/v1/departures?from=200060&to=215020&transferLimit=%s", value)
			got := get(t, handler, target)
			if got.Code != http.StatusBadRequest {
				t.Fatalf("%s: status = %d, want 400: %s", target, got.Code, got.Body)
			}
			if code := decodeError(t, got).Error.Code; code != "bad_request" {
				t.Errorf("%s: code = %q, want bad_request", target, code)
			}
		}
	}
}

func TestFlagsEndpointServesReadsWhileTheSnapshotChanges(t *testing.T) {
	var on atomic.Bool
	handler := newTestServer(t, &fakeUpstream{departures: sampleDepartures()},
		WithPublicFlags(func() map[string]any {
			return map[string]any{"transfer_limit": on.Load(), "tiny_train": !on.Load()}
		}))
	var wait sync.WaitGroup
	for i := range 8 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			on.Store(i%2 == 0)
			if got := get(t, handler, "/api/v1/flags"); got.Code != http.StatusOK {
				t.Errorf("status = %d, want 200: %s", got.Code, got.Body)
			}
		}()
	}
	wait.Wait()
}
