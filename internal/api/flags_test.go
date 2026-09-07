package api

import (
	"encoding/json"
	"net/http/httptest"
	"testing"
)

func TestPublicFlagsBoundary(t *testing.T) {
	for _, tc := range []struct {
		name   string
		values func() map[string]any
		want   bool
	}{
		{"unconfigured", nil, false},
		{"missing", func() map[string]any { return nil }, false},
		{"invalid", func() map[string]any { return map[string]any{"tiny_train": "true"} }, false},
		{"off", func() map[string]any { return map[string]any{"tiny_train": false} }, false},
		{"on", func() map[string]any {
			return map[string]any{
				"tiny_train": true, "private.flag": "secret", "rules": []string{"never expose"},
			}
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
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
			if len(values) != 1 || values["tiny_train"] != tc.want {
				t.Fatalf("public values = %v, want tiny train %v only", values, tc.want)
			}
		})
	}
}
