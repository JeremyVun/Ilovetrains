package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"testing"
	"time"

	"trains/internal/tfnsw"
)

func TestDeparturesHandlerReconcilesOnlyFreshLiveFetches(t *testing.T) {
	now := time.Date(2026, 9, 6, 8, 0, 0, 0, time.UTC)
	service, _, _ := nativeTestService(t, now)
	if err := service.RefreshRealtime(context.Background()); err != nil {
		t.Fatal(err)
	}
	departures := sampleDepartures()
	estimated := "2026-09-06T18:05:00+10:00"
	departures.Journeys[0].LegDetail = []tfnsw.Leg{{
		Line: tfnsw.Line{Mode: "train"}, TripIDs: []string{"trip"}, OriginStopID: "2000332",
		Departure: tfnsw.LegTime{Scheduled: "2026-09-06T18:00:00+10:00", Estimated: &estimated},
	}}
	upstream := &fakeUpstream{departures: departures}
	log := &reconcileLog{}
	server := New(upstream, filepath.Join(t.TempDir(), "no-web-dir"), WithNative(service), WithLogf(log.logf))
	server.now = func() time.Time { return now }
	handler := server.Handler()
	if server.reconciler == nil {
		t.Fatal("native service and logger did not create a reconciler")
	}

	get := func(path string) {
		t.Helper()
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, path, nil))
		if recorder.Code != http.StatusOK {
			t.Fatalf("%s: %d %s", path, recorder.Code, recorder.Body.String())
		}
	}
	live := "/api/v1/departures?from=200060&to=215020"
	get(live)
	get(live)
	if counts := server.reconciler.counts["train"]; counts == nil || counts.tripPlannerOnly != 1 || counts.stale != 0 {
		t.Fatalf("after two live requests inside the TTL counts = %+v, want one tripplanner-only leg", counts)
	}
	get("/api/v1/departures?from=200060&to=215020&at=" + url.QueryEscape(now.Add(-time.Hour).Format(time.RFC3339)))
	if counts := server.reconciler.counts["train"]; counts.tripPlannerOnly != 1 {
		t.Fatalf("a settled past window was reconciled: %+v", counts)
	}
}
