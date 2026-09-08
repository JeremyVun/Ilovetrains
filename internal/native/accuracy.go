package native

import (
	"fmt"
	"sync"
	"time"

	"trains/internal/analytics"
)

// leadBounds are the upper edges, in minutes, of the countdown ranges a rider
// might be looking at when a prediction is scored.
var leadBounds = [...]int64{2, 5, 10, 20, 40, 90}

const (
	settleGrace             = 3 * time.Minute
	observedNear            = 3 * time.Minute
	trackingLimit           = 4 * time.Hour
	accuracySummaryInterval = 15 * time.Minute
)

type trackedStop struct {
	slots     [len(leadBounds)]int64
	final     int64
	firstSeen int64
	lastSeen  int64
}

type trackedTrip struct {
	stops map[string]*trackedStop
}

type leadStats struct {
	n, within60, within120, early60, late60 int
	sumAbs, maxAbs                          int64
	buckets                                 map[string]int
}

type sourceStats struct {
	settled, unresolved, cancelled int
	leads                          [len(leadBounds)]leadStats
}

// accuracyTracker scores each realtime prediction against the last estimate
// the same feed gave before the stop passed, which is the closest thing to an
// observed departure the open data offers.
type accuracyTracker struct {
	mu          sync.Mutex
	trips       map[string]map[string]*trackedTrip
	stats       map[string]*sourceStats
	lastSummary time.Time
	emit        func([]analytics.Event)
}

func newAccuracyTracker(emit func([]analytics.Event)) *accuracyTracker {
	return &accuracyTracker{trips: map[string]map[string]*trackedTrip{}, stats: map[string]*sourceStats{}, emit: emit}
}

func (t *accuracyTracker) observe(snapshot Snapshot) {
	t.mu.Lock()
	defer t.mu.Unlock()
	header := snapshot.HeaderTimestamp.Unix()
	trips := t.sourceTrips(snapshot.Source)
	stats := t.sourceStats(snapshot.Source)
	for _, update := range snapshot.Updates {
		key := update.TripID + "\x00" + update.ServiceDate
		if update.Status == "cancelled" {
			if _, tracked := trips[key]; tracked {
				delete(trips, key)
				stats.cancelled++
			}
			continue
		}
		for _, stop := range update.StopUpdates {
			predicted, ok := stopEventSeconds(stop)
			if !ok || stop.ScheduleRelationship == "skipped" || stop.ScheduleRelationship == "noData" {
				continue
			}
			lead := predicted - header
			if lead > leadBounds[len(leadBounds)-1]*60 {
				continue
			}
			trip := trips[key]
			if trip == nil {
				if lead < 0 {
					continue
				}
				trip = &trackedTrip{stops: map[string]*trackedStop{}}
				trips[key] = trip
			}
			name := stopName(stop)
			tracked := trip.stops[name]
			if tracked == nil {
				if lead < 0 {
					continue
				}
				tracked = &trackedStop{firstSeen: header}
				trip.stops[name] = tracked
			}
			tracked.final, tracked.lastSeen = predicted, header
			if slot := leadBucket(lead); slot >= 0 && tracked.slots[slot] == 0 {
				tracked.slots[slot] = predicted
			}
		}
	}
	t.settleLocked(snapshot.Source, header)
}

func (t *accuracyTracker) settleLocked(source string, header int64) {
	trips := t.sourceTrips(source)
	stats := t.sourceStats(source)
	for key, trip := range trips {
		for name, tracked := range trip.stops {
			expired := header-tracked.firstSeen > int64(trackingLimit/time.Second)
			if !expired && header < tracked.final+int64(settleGrace/time.Second) {
				continue
			}
			delete(trip.stops, name)
			if expired || tracked.final-tracked.lastSeen > int64(observedNear/time.Second) {
				stats.unresolved++
				continue
			}
			stats.settled++
			for slot, predicted := range tracked.slots {
				if predicted == 0 {
					continue
				}
				stats.leads[slot].add(tracked.final - predicted)
			}
		}
		if len(trip.stops) == 0 {
			delete(trips, key)
		}
	}
}

func (l *leadStats) add(err int64) {
	abs := err
	if abs < 0 {
		abs = -abs
	}
	l.n++
	l.sumAbs += abs
	if abs > l.maxAbs {
		l.maxAbs = abs
	}
	if abs <= 60 {
		l.within60++
	}
	if abs <= 120 {
		l.within120++
	}
	if err < -60 {
		l.early60++
	}
	if err > 60 {
		l.late60++
	}
	if l.buckets == nil {
		l.buckets = map[string]int{}
	}
	l.buckets[analytics.DeltaBucket(err)]++
}

func (t *accuracyTracker) summarize(logf func(string, ...any), now time.Time, force bool) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.lastSummary.IsZero() {
		t.lastSummary = now
	}
	if !force && now.Sub(t.lastSummary) < accuracySummaryInterval {
		return
	}
	window := now.Sub(t.lastSummary).Round(time.Minute)
	t.lastSummary = now
	var events []analytics.Event
	for _, source := range Sources {
		stats := t.stats[source]
		if stats == nil {
			continue
		}
		tracking := 0
		for _, trip := range t.trips[source] {
			tracking += len(trip.stops)
		}
		if logf != nil {
			logf("accuracy feed source=%s window=%s settled=%d unresolved=%d cancelled=%d tracking=%d",
				source, window, stats.settled, stats.unresolved, stats.cancelled, tracking)
		}
		for slot, lead := range stats.leads {
			if lead.n == 0 {
				continue
			}
			if logf != nil {
				logf("accuracy feed source=%s lead=%s n=%d within60=%d within120=%d early60=%d late60=%d mae=%ds max=%ds",
					source, leadLabel(slot), lead.n, lead.within60, lead.within120, lead.early60, lead.late60,
					lead.sumAbs/int64(lead.n), lead.maxAbs)
			}
		}
		events = append(events, stats.events(source)...)
		t.stats[source] = &sourceStats{}
	}
	if t.emit != nil {
		t.emit(events)
	}
}

func (s *sourceStats) events(source string) []analytics.Event {
	var events []analytics.Event
	for slot, lead := range s.leads {
		for bucket, count := range lead.buckets {
			events = append(events, analytics.Event{Type: "feed_prediction_scored", Count: count, Dimensions: map[string]string{
				"source": source, "lead": leadLabel(slot), "error": bucket,
				"lead.error": leadLabel(slot) + "." + bucket, "source.error": source + "." + bucket,
			}})
		}
	}
	if s.unresolved > 0 {
		events = append(events, analytics.Event{Type: "feed_stop_unresolved", Count: s.unresolved, Dimensions: map[string]string{"source": source}})
	}
	if s.cancelled > 0 {
		events = append(events, analytics.Event{Type: "feed_trip_cancelled", Count: s.cancelled, Dimensions: map[string]string{"source": source}})
	}
	return events
}

func (t *accuracyTracker) sourceTrips(source string) map[string]*trackedTrip {
	trips := t.trips[source]
	if trips == nil {
		trips = map[string]*trackedTrip{}
		t.trips[source] = trips
	}
	return trips
}

func (t *accuracyTracker) sourceStats(source string) *sourceStats {
	stats := t.stats[source]
	if stats == nil {
		stats = &sourceStats{}
		t.stats[source] = stats
	}
	return stats
}

func stopEventSeconds(stop StopUpdate) (int64, bool) {
	switch {
	case stop.DepartureMs != nil:
		return *stop.DepartureMs / 1000, true
	case stop.ArrivalMs != nil:
		return *stop.ArrivalMs / 1000, true
	}
	return 0, false
}

func stopName(stop StopUpdate) string {
	if stop.StopID != "" {
		return stop.StopID
	}
	return fmt.Sprintf("#%d", *stop.StopSequence)
}

func leadBucket(lead int64) int {
	if lead < 0 {
		return -1
	}
	for slot, bound := range leadBounds {
		if lead <= bound*60 {
			return slot
		}
	}
	return -1
}

func leadLabel(slot int) string {
	lower := int64(0)
	if slot > 0 {
		lower = leadBounds[slot-1]
	}
	return fmt.Sprintf("%d-%dm", lower, leadBounds[slot])
}
