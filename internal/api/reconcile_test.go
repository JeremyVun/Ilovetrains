package api

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"trains/internal/analytics"
	"trains/internal/native"
	"trains/internal/tfnsw"
)

type reconcileLog struct{ lines []string }

func (l *reconcileLog) logf(format string, args ...any) {
	l.lines = append(l.lines, fmt.Sprintf(format, args...))
}

func feedStop(id string, at time.Time, delay int32) native.StopUpdate {
	ms := at.UnixMilli()
	return native.StopUpdate{StopID: id, DepartureMs: &ms, DepartureDelaySeconds: &delay, ScheduleRelationship: "scheduled"}
}

func legAt(mode, tripID, stopID string, planned time.Time, estimated *time.Time, cancelled bool) tfnsw.Leg {
	leg := tfnsw.Leg{Line: tfnsw.Line{Mode: mode}, Departure: tfnsw.LegTime{Scheduled: planned.Format(time.RFC3339)},
		Cancelled: cancelled, TripIDs: []string{tripID}, OriginStopID: stopID}
	if estimated != nil {
		value := estimated.Format(time.RFC3339)
		leg.Departure.Estimated = &value
	}
	return leg
}

func TestReconcilerComparesTripPlannerWithTheFeed(t *testing.T) {
	sydney, _ := time.LoadLocation(tfnsw.TimeZone)
	planned := time.Date(2026, 9, 8, 8, 0, 0, 0, sydney)
	header := planned.Add(-5 * time.Minute)
	feed := map[string]native.TripMatch{
		"agree":    {Source: "sydneytrains", Header: header, Update: native.TripUpdate{TripID: "agree", Status: "scheduled", StopUpdates: []native.StopUpdate{feedStop("2000332", planned.Add(90*time.Second), 90)}}},
		"disagree": {Source: "sydneytrains", Header: header, Update: native.TripUpdate{TripID: "disagree", Status: "scheduled", StopUpdates: []native.StopUpdate{feedStop("2000332", planned.Add(4*time.Minute), 240)}}},
		"bytime":   {Source: "sydneytrains", Header: header, Update: native.TripUpdate{TripID: "bytime", Status: "scheduled", StopUpdates: []native.StopUpdate{feedStop("other", planned.Add(30*time.Second), 30)}}},
		"cancel":   {Source: "sydneytrains", Header: header, Update: native.TripUpdate{TripID: "cancel", Status: "cancelled"}},
		"stale":    {Source: "sydneytrains", Header: header, Stale: true, Update: native.TripUpdate{TripID: "stale", Status: "scheduled"}},
		"nodata":   {Source: "sydneytrains", Header: header, Update: native.TripUpdate{TripID: "nodata", Status: "scheduled", StopUpdates: []native.StopUpdate{{StopID: "2000332", ScheduleRelationship: "noData"}}}},
	}
	lookup := func(ids ...string) (native.TripMatch, bool) {
		match, ok := feed[ids[0]]
		return match, ok
	}
	now := planned.Add(-4 * time.Minute)
	log := &reconcileLog{}
	var emitted []analytics.Event
	r := newReconciler(log.logf, func(events []analytics.Event) { emitted = append(emitted, events...) }, func() time.Time { return now }, lookup)

	at := func(d time.Duration) *time.Time { value := planned.Add(d); return &value }
	r.reconcile(&tfnsw.DeparturesResponse{Journeys: []tfnsw.Journey{{LegDetail: []tfnsw.Leg{
		legAt("train", "agree", "2000332", planned, at(2*time.Minute), false),
		legAt("train", "disagree", "2000332", planned, at(time.Minute), false),
		legAt("train", "bytime", "2000332", planned, at(30*time.Second), false),
		legAt("train", "cancel", "2000332", planned, nil, false),
		legAt("train", "stale", "2000332", planned, at(0), false),
		legAt("train", "nodata", "2000332", planned, at(0), false),
		legAt("train", "nodata", "2000332", planned, nil, false),
		legAt("train", "unknown", "2000332", planned, at(0), false),
		legAt("ferry", "agree", "2000332", planned, nil, false),
	}}}})

	counts := r.counts["train"]
	if counts.compared != 3 || counts.agree != 2 || counts.disagree != 1 || counts.maxAbs != 180 {
		t.Errorf("train counts = %+v", *counts)
	}
	if counts.cancelMismatch != 1 || counts.stale != 1 || counts.tripPlannerOnly != 1 || counts.scheduledOnly != 1 || counts.unmatched != 1 {
		t.Errorf("train edge counts = %+v", *counts)
	}
	if ferry := r.counts["ferry"]; ferry.feedOnly != 1 {
		t.Errorf("ferry counts = %+v", *ferry)
	}
	if len(log.lines) != 2 {
		t.Fatalf("immediate lines = %q", log.lines)
	}
	if !strings.Contains(log.lines[0], "trip=disagree stop=2000332 planned=2026-09-08T08:00:00+10:00 tripplanner=2026-09-08T08:01:00+10:00 feed=2026-09-08T08:04:00+10:00 diff=-180s") {
		t.Errorf("disagreement line = %q", log.lines[0])
	}
	if !strings.Contains(log.lines[1], "trip=cancel stop=2000332 planned=2026-09-08T08:00:00+10:00 tripplanner_cancelled=false feed_cancelled=true") {
		t.Errorf("cancellation line = %q", log.lines[1])
	}

	now = now.Add(reconcileSummaryInterval)
	r.reconcile(&tfnsw.DeparturesResponse{})
	summary := log.lines[2:]
	if len(summary) != 2 || !strings.Contains(summary[0], "mode=train window=15m0s compared=3 agree=2 disagree=1 mae=70s max=180s tripplanner_only=1 feed_only=0 scheduled_only=1 unmatched=1 stale=1 cancel_mismatch=1") {
		t.Errorf("summary = %q", summary)
	}
	if !strings.Contains(summary[1], "mode=ferry window=15m0s compared=0 agree=0 disagree=0 mae=0s max=0s tripplanner_only=0 feed_only=1") {
		t.Errorf("ferry summary = %q", summary[1])
	}
	if r.counts["train"].compared != 0 {
		t.Errorf("summary did not reset the window")
	}
	got := map[string]int{}
	for _, event := range emitted {
		got[event.Type+" "+event.Dimensions["mode.outcome"]+event.Dimensions["mode.diff"]+event.Dimensions["mode"]] += event.Count
	}
	want := map[string]int{
		"tripplanner_leg_reconciled train.agreetrain": 2, "tripplanner_leg_reconciled train.disagreetrain": 1,
		"tripplanner_leg_reconciled train.tripplanner_onlytrain": 1, "tripplanner_leg_reconciled train.scheduled_onlytrain": 1,
		"tripplanner_leg_reconciled train.unmatchedtrain": 1, "tripplanner_leg_reconciled train.staletrain": 1,
		"tripplanner_leg_reconciled ferry.feed_onlyferry": 1,
		"tripplanner_leg_compared train.within1train":     2, "tripplanner_leg_compared train.early2-5train": 1,
		"tripplanner_cancel_mismatched train": 1,
	}
	if len(got) != len(want) {
		t.Fatalf("emitted = %v", got)
	}
	for key, count := range want {
		if got[key] != count {
			t.Errorf("%s = %d, want %d (all: %v)", key, got[key], count, got)
		}
	}
}

func TestNilReconcilerIsSilent(t *testing.T) {
	var r *reconciler
	r.reconcile(&tfnsw.DeparturesResponse{Journeys: []tfnsw.Journey{{LegDetail: []tfnsw.Leg{legAt("train", "x", "y", time.Now(), nil, false)}}}})
}
