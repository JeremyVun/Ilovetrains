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

type stubFlags struct {
	values  map[string]bool
	version string
}

func (s stubFlags) Bool(key string, def bool) bool {
	if value, ok := s.values[key]; ok {
		return value
	}
	return def
}

func (s stubFlags) Version() string { return s.version }

func flagOn(key string) Option {
	return WithFlags(stubFlags{values: map[string]bool{key: true}})
}

func decodeFlags(t *testing.T, recorder *httptest.ResponseRecorder) FlagsResponse {
	t.Helper()
	var body FlagsResponse
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("decoding flags body %q: %v", recorder.Body.String(), err)
	}
	return body
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
		{"no source", nil, 1, tfnsw.NoTransferLimit},
		{"flag off", []Option{WithFlags(stubFlags{})}, 1, tfnsw.NoTransferLimit},
		{"flag on", []Option{flagOn(transferLimitFlag)}, 2, 2},
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
	for _, options := range [][]Option{nil, {flagOn(transferLimitFlag)}} {
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

func TestFlagsEndpointNamesEveryPublicFlagWithoutASource(t *testing.T) {
	got := get(t, newTestServer(t, &fakeUpstream{departures: sampleDepartures()}), "/api/v1/flags")
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
	}
	if cc := got.Header().Get("Cache-Control"); cc != flagsCacheControl {
		t.Errorf("Cache-Control = %q, want %q", cc, flagsCacheControl)
	}
	body := decodeFlags(t, got)
	if body.Version != "" {
		t.Errorf("version = %q, want empty with no source configured", body.Version)
	}
	if len(body.Flags) != len(publicFlags) {
		t.Fatalf("flags = %v, want the %d public flags named", body.Flags, len(publicFlags))
	}
	for _, key := range publicFlags {
		if body.Flags[key] {
			t.Errorf("flag %q is on with no source configured", key)
		}
	}
}

func TestFlagsEndpointPublishesTheEvaluatedValueAndVersion(t *testing.T) {
	source := stubFlags{values: map[string]bool{transferLimitFlag: true}, version: "snapshot-42"}
	handler := newTestServer(t, &fakeUpstream{departures: sampleDepartures()}, WithFlags(source))

	got := get(t, handler, "/api/v1/flags")
	if got.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", got.Code, got.Body)
	}
	if cc := got.Header().Get("Cache-Control"); cc != flagsCacheControl {
		t.Errorf("Cache-Control = %q, want %q", cc, flagsCacheControl)
	}
	body := decodeFlags(t, got)
	if body.Version != "snapshot-42" {
		t.Errorf("version = %q, want snapshot-42", body.Version)
	}
	if !body.Flags[transferLimitFlag] {
		t.Errorf("flags = %v, want %s on", body.Flags, transferLimitFlag)
	}

	off := get(t, newTestServer(t, &fakeUpstream{departures: sampleDepartures()},
		WithFlags(stubFlags{version: "snapshot-43"})), "/api/v1/flags")
	body = decodeFlags(t, off)
	if body.Version != "snapshot-43" || body.Flags[transferLimitFlag] {
		t.Errorf("unset flag = %+v, want the version with every flag off", body)
	}
}

// togglingFlags stands in for the phase 2 SDK adapter, whose snapshot changes
// under readers.
type togglingFlags struct{ on atomic.Bool }

func (f *togglingFlags) Bool(_ string, _ bool) bool { return f.on.Load() }

func (f *togglingFlags) Version() string {
	if f.on.Load() {
		return "on"
	}
	return "off"
}

func TestFlagsEndpointServesReadsWhileTheSourceChanges(t *testing.T) {
	source := &togglingFlags{}
	handler := newTestServer(t, &fakeUpstream{departures: sampleDepartures()}, WithFlags(source))
	var wait sync.WaitGroup
	for i := range 8 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			source.on.Store(i%2 == 0)
			if got := get(t, handler, "/api/v1/flags"); got.Code != http.StatusOK {
				t.Errorf("status = %d, want 200: %s", got.Code, got.Body)
			}
		}()
	}
	wait.Wait()
}
