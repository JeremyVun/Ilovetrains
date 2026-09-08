package api

import (
	"sync"
	"time"

	"trains/internal/analytics"
	"trains/internal/native"
	"trains/internal/tfnsw"
)

const (
	reconcileAgree           = 60 * time.Second
	reconcileReport          = 120 * time.Second
	reconcileSummaryInterval = 15 * time.Minute
	reconcileStopMatch       = 60 * time.Second
)

type reconcileCounts struct {
	compared, agree, disagree, tripPlannerOnly, feedOnly, scheduledOnly int
	unmatched, stale, cancelMismatch                                    int
	sumAbs, maxAbs                                                      int64
	diffs                                                               map[string]int
}

// reconciler compares each served Trip Planner estimate with the realtime
// feed's estimate for the same trip and stop, so a disagreement between the
// two upstreams is visible in the server log before a rider reports it.
type reconciler struct {
	mu          sync.Mutex
	logf        func(string, ...any)
	emit        func([]analytics.Event)
	now         func() time.Time
	lookup      func(ids ...string) (native.TripMatch, bool)
	counts      map[string]*reconcileCounts
	lastSummary time.Time
}

func newReconciler(logf func(string, ...any), emit func([]analytics.Event), now func() time.Time,
	lookup func(ids ...string) (native.TripMatch, bool)) *reconciler {
	if logf == nil {
		logf = func(string, ...any) {}
	}
	return &reconciler{logf: logf, emit: emit, now: now, lookup: lookup, counts: map[string]*reconcileCounts{}}
}

func (r *reconciler) reconcile(response *tfnsw.DeparturesResponse) {
	if r == nil || response == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, journey := range response.Journeys {
		for _, leg := range journey.LegDetail {
			r.reconcileLeg(leg)
		}
	}
	r.summarizeLocked(false)
}

func (r *reconciler) reconcileLeg(leg tfnsw.Leg) {
	counts := r.counts[leg.Line.Mode]
	if counts == nil {
		counts = &reconcileCounts{}
		r.counts[leg.Line.Mode] = counts
	}
	if len(leg.TripIDs) == 0 {
		counts.unmatched++
		return
	}
	match, ok := r.lookup(leg.TripIDs...)
	if !ok {
		counts.unmatched++
		return
	}
	if match.Stale {
		counts.stale++
		return
	}
	feedCancelled := match.Update.Status == "cancelled"
	if feedCancelled != leg.Cancelled {
		counts.cancelMismatch++
		r.logf("accuracy tripplanner mode=%s trip=%s stop=%s planned=%s tripplanner_cancelled=%t feed_cancelled=%t",
			leg.Line.Mode, match.Update.TripID, leg.OriginStopID, leg.Departure.Scheduled, leg.Cancelled, feedCancelled)
	}
	if feedCancelled || leg.Cancelled {
		return
	}
	planned, err := time.Parse(time.RFC3339, leg.Departure.Scheduled)
	if err != nil {
		counts.unmatched++
		return
	}
	feed, feedOK := feedEstimate(match.Update, leg.OriginStopID, planned)
	var tripPlanner time.Time
	if leg.Departure.Estimated != nil {
		tripPlanner, _ = time.Parse(time.RFC3339, *leg.Departure.Estimated)
	}
	switch {
	case !tripPlanner.IsZero() && feedOK:
		diff := tripPlanner.Sub(feed)
		abs := diff.Abs()
		counts.compared++
		counts.sumAbs += int64(abs / time.Second)
		if int64(abs/time.Second) > counts.maxAbs {
			counts.maxAbs = int64(abs / time.Second)
		}
		if abs <= reconcileAgree {
			counts.agree++
		} else {
			counts.disagree++
		}
		if counts.diffs == nil {
			counts.diffs = map[string]int{}
		}
		counts.diffs[analytics.DeltaBucket(int64(diff/time.Second))]++
		if abs > reconcileReport {
			r.logf("accuracy tripplanner mode=%s trip=%s stop=%s planned=%s tripplanner=%s feed=%s diff=%+ds",
				leg.Line.Mode, match.Update.TripID, leg.OriginStopID, leg.Departure.Scheduled,
				tripPlanner.Format(time.RFC3339), feed.In(planned.Location()).Format(time.RFC3339), int64(diff/time.Second))
		}
	case !tripPlanner.IsZero():
		counts.tripPlannerOnly++
	case feedOK:
		counts.feedOnly++
	default:
		counts.scheduledOnly++
	}
}

// Ferries board at a wharf the feed may key differently, so the scheduled time
// the delay implies is the fallback join.
func feedEstimate(update native.TripUpdate, stopID string, planned time.Time) (time.Time, bool) {
	for _, stop := range update.StopUpdates {
		if stop.StopID == stopID || (stop.AssignedStopID != "" && stop.AssignedStopID == stopID) {
			return stopEstimate(stop, planned)
		}
	}
	for _, stop := range update.StopUpdates {
		estimate, ok := stopEstimate(stop, planned)
		if !ok || stop.DepartureDelaySeconds == nil {
			continue
		}
		scheduled := estimate.Add(-time.Duration(*stop.DepartureDelaySeconds) * time.Second)
		if scheduled.Sub(planned).Abs() <= reconcileStopMatch {
			return estimate, true
		}
	}
	return time.Time{}, false
}

func stopEstimate(stop native.StopUpdate, planned time.Time) (time.Time, bool) {
	if stop.ScheduleRelationship == "skipped" || stop.ScheduleRelationship == "noData" {
		return time.Time{}, false
	}
	switch {
	case stop.DepartureMs != nil:
		return time.UnixMilli(*stop.DepartureMs), true
	case stop.DepartureDelaySeconds != nil:
		return planned.Add(time.Duration(*stop.DepartureDelaySeconds) * time.Second), true
	case stop.ArrivalMs != nil:
		return time.UnixMilli(*stop.ArrivalMs), true
	}
	return time.Time{}, false
}

func (r *reconciler) summarizeLocked(force bool) {
	now := r.now()
	if r.lastSummary.IsZero() {
		r.lastSummary = now
	}
	if !force && now.Sub(r.lastSummary) < reconcileSummaryInterval {
		return
	}
	window := now.Sub(r.lastSummary).Round(time.Minute)
	r.lastSummary = now
	var events []analytics.Event
	for _, mode := range tfnsw.AllModes() {
		counts := r.counts[string(mode)]
		if counts == nil {
			continue
		}
		mae := int64(0)
		if counts.compared > 0 {
			mae = counts.sumAbs / int64(counts.compared)
		}
		r.logf("accuracy tripplanner mode=%s window=%s compared=%d agree=%d disagree=%d mae=%ds max=%ds tripplanner_only=%d feed_only=%d scheduled_only=%d unmatched=%d stale=%d cancel_mismatch=%d",
			mode, window, counts.compared, counts.agree, counts.disagree, mae, counts.maxAbs, counts.tripPlannerOnly,
			counts.feedOnly, counts.scheduledOnly, counts.unmatched, counts.stale, counts.cancelMismatch)
		events = append(events, counts.events(string(mode))...)
		r.counts[string(mode)] = &reconcileCounts{}
	}
	if r.emit != nil {
		r.emit(events)
	}
}

func (c *reconcileCounts) events(mode string) []analytics.Event {
	var events []analytics.Event
	outcomes := []struct {
		name  string
		count int
	}{
		{"agree", c.agree}, {"disagree", c.disagree}, {"tripplanner_only", c.tripPlannerOnly}, {"feed_only", c.feedOnly},
		{"scheduled_only", c.scheduledOnly}, {"unmatched", c.unmatched}, {"stale", c.stale},
	}
	for _, outcome := range outcomes {
		if outcome.count == 0 {
			continue
		}
		events = append(events, analytics.Event{Type: "tripplanner_leg_reconciled", Count: outcome.count, Dimensions: map[string]string{
			"mode": mode, "outcome": outcome.name, "mode.outcome": mode + "." + outcome.name,
		}})
	}
	for bucket, count := range c.diffs {
		events = append(events, analytics.Event{Type: "tripplanner_leg_compared", Count: count, Dimensions: map[string]string{
			"mode": mode, "diff": bucket, "mode.diff": mode + "." + bucket,
		}})
	}
	if c.cancelMismatch > 0 {
		events = append(events, analytics.Event{Type: "tripplanner_cancel_mismatched", Count: c.cancelMismatch, Dimensions: map[string]string{"mode": mode}})
	}
	return events
}
