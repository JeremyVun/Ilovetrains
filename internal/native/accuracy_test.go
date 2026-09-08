package native

import (
	"sort"
	"strings"
	"testing"
	"time"

	"trains/internal/analytics"
)

func stopAt(id string, at time.Time) StopUpdate {
	ms := at.UnixMilli()
	return StopUpdate{StopID: id, DepartureMs: &ms, ScheduleRelationship: "scheduled"}
}

func snapshotAt(header time.Time, updates ...TripUpdate) Snapshot {
	return Snapshot{Source: "sydneytrains", HeaderTimestamp: header, Updates: updates}
}

func TestTrackerScoresEachLeadAgainstTheFinalEstimate(t *testing.T) {
	tracker := newAccuracyTracker(nil)
	base := time.Date(2026, 9, 8, 8, 0, 0, 0, time.UTC)
	trip := func(at time.Time) TripUpdate {
		return TripUpdate{TripID: "trip", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("2000332", at)}}
	}
	tracker.observe(snapshotAt(base, trip(base.Add(10*time.Minute))))
	tracker.observe(snapshotAt(base.Add(5*time.Minute), trip(base.Add(11*time.Minute))))
	tracker.observe(snapshotAt(base.Add(9*time.Minute), trip(base.Add(12*time.Minute))))
	tracker.observe(snapshotAt(base.Add(11*time.Minute), trip(base.Add(12*time.Minute))))
	if stats := tracker.stats["sydneytrains"]; stats.settled != 0 {
		t.Fatalf("settled before the grace period: %+v", stats)
	}
	tracker.observe(snapshotAt(base.Add(15 * time.Minute)))

	stats := tracker.stats["sydneytrains"]
	if stats.settled != 1 || stats.unresolved != 0 {
		t.Fatalf("settled=%d unresolved=%d, want 1/0", stats.settled, stats.unresolved)
	}
	tenMinute := stats.leads[leadBucket(10*60)]
	if tenMinute.n != 1 || tenMinute.late60 != 1 || tenMinute.within120 != 1 || tenMinute.within60 != 0 || tenMinute.sumAbs != 120 {
		t.Errorf("5-10m lead = %+v, want one late-by-120s score", tenMinute)
	}
	threeMinute := stats.leads[leadBucket(3*60)]
	if threeMinute.n != 1 || threeMinute.within60 != 1 || threeMinute.sumAbs != 0 {
		t.Errorf("2-5m lead = %+v, want one exact score", threeMinute)
	}
	if got := stats.leads[leadBucket(60)]; got.n != 1 || got.within60 != 1 {
		t.Errorf("0-2m lead = %+v, want one exact score", got)
	}
	if len(tracker.trips["sydneytrains"]) != 0 {
		t.Errorf("settled trip still tracked")
	}

	log := &recordingLog{}
	tracker.summarize(log.logf, base.Add(16*time.Minute), true)
	lines := log.matching("accuracy feed source=sydneytrains")
	if len(lines) != 4 {
		t.Fatalf("summary lines = %q", lines)
	}
	if !strings.Contains(lines[0], "settled=1 unresolved=0 cancelled=0 tracking=0") {
		t.Errorf("summary header = %q", lines[0])
	}
	if !strings.Contains(lines[3], "lead=5-10m n=1 within60=0 within120=1 early60=0 late60=1 mae=120s max=120s") {
		t.Errorf("5-10m line = %q", lines[3])
	}
	if stats := tracker.stats["sydneytrains"]; stats.settled != 0 {
		t.Errorf("summary did not reset the window: %+v", stats)
	}
}

func TestTrackerLeavesVanishedAndCancelledStopsUnscored(t *testing.T) {
	tracker := newAccuracyTracker(nil)
	base := time.Date(2026, 9, 8, 8, 0, 0, 0, time.UTC)
	vanishing := TripUpdate{TripID: "gone", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("a", base.Add(20*time.Minute))}}
	early := TripUpdate{TripID: "early", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("b", base.Add(20*time.Minute))}}
	doomed := TripUpdate{TripID: "doomed", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("c", base.Add(20*time.Minute))}}
	tracker.observe(snapshotAt(base, vanishing, early, doomed))
	doomed.Status, doomed.StopUpdates = "cancelled", nil
	tracker.observe(snapshotAt(base.Add(time.Minute), early, doomed))
	early.StopUpdates = []StopUpdate{stopAt("b", base.Add(15*time.Minute))}
	tracker.observe(snapshotAt(base.Add(14*time.Minute), early))
	tracker.observe(snapshotAt(base.Add(30 * time.Minute)))

	stats := tracker.stats["sydneytrains"]
	if stats.settled != 1 || stats.unresolved != 1 || stats.cancelled != 1 {
		t.Fatalf("settled=%d unresolved=%d cancelled=%d, want 1/1/1", stats.settled, stats.unresolved, stats.cancelled)
	}
	twenty := stats.leads[leadBucket(20*60)]
	if twenty.n != 1 || twenty.early60 != 1 || twenty.sumAbs != 300 {
		t.Errorf("early departure scored as %+v, want one early-by-300s", twenty)
	}
}

func TestTrackerIgnoresFarFutureAndPassedPredictions(t *testing.T) {
	tracker := newAccuracyTracker(nil)
	base := time.Date(2026, 9, 8, 8, 0, 0, 0, time.UTC)
	tracker.observe(snapshotAt(base,
		TripUpdate{TripID: "far", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("a", base.Add(3*time.Hour))}},
		TripUpdate{TripID: "past", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("b", base.Add(-time.Minute))}},
	))
	if got := len(tracker.trips["sydneytrains"]); got != 0 {
		t.Fatalf("tracked trips = %d, want none: a far-future or already-passed first sighting is not a countdown", got)
	}
	// A stop the feed keeps reporting after it passed must not be re-tracked and re-settled every poll.
	tracker.observe(snapshotAt(base, TripUpdate{TripID: "kept", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("c", base.Add(time.Minute))}}))
	for i := 5; i <= 30; i += 5 {
		tracker.observe(snapshotAt(base.Add(time.Duration(i)*time.Minute), TripUpdate{TripID: "kept", ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("c", base.Add(time.Minute))}}))
	}
	if stats := tracker.stats["sydneytrains"]; stats.settled != 1 || len(tracker.trips["sydneytrains"]) != 0 {
		t.Errorf("settled=%d tracked=%d, want one settlement and nothing tracked", stats.settled, len(tracker.trips["sydneytrains"]))
	}
}

func TestTrackerObservesTheSydneyTrainsCapture(t *testing.T) {
	body, header, dates := loadSydneyTrainsCapture(t)
	snapshot, _, _, err := NormalizeRealtime("sydneytrains", body, header, dates)
	if err != nil {
		t.Fatal(err)
	}
	tracker := newAccuracyTracker(nil)
	tracker.observe(snapshot)
	tracked := 0
	for _, trip := range tracker.trips["sydneytrains"] {
		tracked += len(trip.stops)
	}
	if tracked == 0 {
		t.Fatal("capture produced no tracked stops")
	}
	log := &recordingLog{}
	tracker.summarize(log.logf, header.Add(time.Minute), true)
	if lines := log.matching("accuracy feed source=sydneytrains window="); len(lines) != 1 || !strings.Contains(lines[0], "tracking=") {
		t.Errorf("summary = %q", log.lines)
	}
}

func TestTrackerSummaryEmitsBucketedCounters(t *testing.T) {
	var emitted []analytics.Event
	tracker := newAccuracyTracker(func(events []analytics.Event) { emitted = append(emitted, events...) })
	base := time.Date(2026, 9, 8, 8, 0, 0, 0, time.UTC)
	trip := func(id string, at time.Time) TripUpdate {
		return TripUpdate{TripID: id, ServiceDate: "20260908", Status: "scheduled", StopUpdates: []StopUpdate{stopAt("s", at)}}
	}
	tracker.observe(snapshotAt(base, trip("a", base.Add(8*time.Minute)), trip("b", base.Add(8*time.Minute)), trip("c", base.Add(8*time.Minute))))
	tracker.observe(snapshotAt(base.Add(7*time.Minute), trip("a", base.Add(8*time.Minute)), trip("b", base.Add(11*time.Minute))))
	tracker.observe(snapshotAt(base.Add(10*time.Minute), trip("b", base.Add(11*time.Minute))))
	tracker.observe(snapshotAt(base.Add(20 * time.Minute)))
	tracker.summarize(nil, base.Add(21*time.Minute), true)

	sort.Slice(emitted, func(i, j int) bool {
		return emitted[i].Type+emitted[i].Dimensions["lead.error"] < emitted[j].Type+emitted[j].Dimensions["lead.error"]
	})
	want := []analytics.Event{
		{Type: "feed_prediction_scored", Count: 2, Dimensions: map[string]string{"source": "sydneytrains", "lead": "0-2m", "error": "within1", "lead.error": "0-2m.within1", "source.error": "sydneytrains.within1"}},
		{Type: "feed_prediction_scored", Count: 1, Dimensions: map[string]string{"source": "sydneytrains", "lead": "2-5m", "error": "within1", "lead.error": "2-5m.within1", "source.error": "sydneytrains.within1"}},
		{Type: "feed_prediction_scored", Count: 1, Dimensions: map[string]string{"source": "sydneytrains", "lead": "5-10m", "error": "late2-5", "lead.error": "5-10m.late2-5", "source.error": "sydneytrains.late2-5"}},
		{Type: "feed_prediction_scored", Count: 1, Dimensions: map[string]string{"source": "sydneytrains", "lead": "5-10m", "error": "within1", "lead.error": "5-10m.within1", "source.error": "sydneytrains.within1"}},
		{Type: "feed_stop_unresolved", Count: 1, Dimensions: map[string]string{"source": "sydneytrains"}},
	}
	if len(emitted) != len(want) {
		t.Fatalf("emitted %d events: %+v", len(emitted), emitted)
	}
	for i := range want {
		if emitted[i].Type != want[i].Type || emitted[i].Count != want[i].Count || !sameDims(emitted[i].Dimensions, want[i].Dimensions) {
			t.Errorf("event %d = %+v, want %+v", i, emitted[i], want[i])
		}
	}
}

func sameDims(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for key, value := range a {
		if b[key] != value {
			return false
		}
	}
	return true
}
