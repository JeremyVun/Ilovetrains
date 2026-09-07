package native

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"testing"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

const everyDayMask = uint8(0b1111111)

func probeFeed(t *testing.T, header time.Time, entities ...*gtfs.FeedEntity) []byte {
	t.Helper()
	full := gtfs.FeedHeader_FULL_DATASET
	body, err := proto.Marshal(&gtfs.FeedMessage{
		Header: &gtfs.FeedHeader{GtfsRealtimeVersion: proto.String("2.0"), Incrementality: &full, Timestamp: proto.Uint64(uint64(header.Unix()))},
		Entity: entities,
	})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func probeEntity(id, tripID, startDate string, stopTime *int64) *gtfs.FeedEntity {
	scheduled := gtfs.TripDescriptor_SCHEDULED
	trip := &gtfs.TripDescriptor{TripId: proto.String(tripID), ScheduleRelationship: &scheduled}
	if startDate != "" {
		trip.StartDate = proto.String(startDate)
	}
	update := &gtfs.TripUpdate{Trip: trip}
	if stopTime != nil {
		update.StopTimeUpdate = []*gtfs.TripUpdate_StopTimeUpdate{{StopId: proto.String("stop-1"), Departure: &gtfs.TripUpdate_StopTimeEvent{Time: stopTime}}}
	}
	return &gtfs.FeedEntity{Id: proto.String(id), TripUpdate: update}
}

func TestDuplicateDetectionUsesResolvedDate(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00late": {firstDepartureSecs: 90600, startDate: 20260901, endDate: 20261031, weekdays: everyDayMask},
	})
	header := sydneyTime(t, 2026, time.September, 6, 1, 33)

	body := probeFeed(t, header, probeEntity("a", "late", "", nil), probeEntity("b", "late", "20260905", nil))
	_, _, counts, err := NormalizeRealtime("sydneytrains", body, header, dates)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Duplicate != 2 || counts.Accepted != 0 {
		t.Fatalf("dateless + explicit same resolved date: %+v, want both dropped as duplicates", counts)
	}

	body = probeFeed(t, header, probeEntity("a", "late", "", nil), probeEntity("b", "late", "20260906", nil))
	snapshot, _, counts, err := NormalizeRealtime("sydneytrains", body, header, dates)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Accepted != 2 || snapshot.Updates[0].ServiceDate != "20260905" || snapshot.Updates[1].ServiceDate != "20260906" {
		t.Fatalf("dateless + explicit different date: %+v %+v", counts, snapshot.Updates)
	}
}

// GTFS defines service times from noon minus twelve hours; civil midnight plus seconds differs by an hour
// only for times inside the transition hour on the two daylight-saving days.
func TestInstanceStartOnDaylightSavingDays(t *testing.T) {
	location, _ := time.LoadLocation(sydneyZone)
	noonMinus12 := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 12, 0, 0, 0, location).Add(-12 * time.Hour)
	}
	cases := []struct {
		name string
		y    int
		m    time.Month
		d    int
		secs int
		want string
	}{
		{"DST start 2026-10-04 26:30", 2026, 10, 4, 95400, "2026-10-05 02:30 AEDT"},
		{"DST start 2026-10-04 02:30 (gap)", 2026, 10, 4, 9000, "2026-10-04 03:30 AEDT"},
		{"DST start 2026-10-04 01:30 (before transition)", 2026, 10, 4, 5400, "2026-10-04 01:30 AEST"},
		{"DST end 2027-04-04 26:30", 2027, 4, 4, 95400, "2027-04-05 02:30 AEST"},
		{"DST end 2027-04-04 02:30 (repeated hour)", 2027, 4, 4, 9000, "2027-04-04 02:30 AEST"},
		{"DST end 2027-04-04 01:30 (before transition)", 2027, 4, 4, 5400, "2027-04-04 01:30 AEDT"},
	}
	for _, c := range cases {
		code := time.Date(c.y, c.m, c.d, 0, 0, c.secs, 0, location)
		spec := noonMinus12(c.y, c.m, c.d).Add(time.Duration(c.secs) * time.Second)
		t.Logf("%-48s code=%s  gtfs(noon-12h)=%s  shift=%s", c.name, code.Format("2006-01-02 15:04 MST"), spec.Format("2006-01-02 15:04 MST"), code.Sub(spec))
		if got := code.Format("2006-01-02 15:04 MST"); got != c.want {
			t.Errorf("%s: code gives %s, pinned %s", c.name, got, c.want)
		}
	}

	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00overnight": {firstDepartureSecs: 95400, startDate: 20260901, endDate: 20270630, weekdays: everyDayMask},
	})
	header := sydneyTime(t, 2026, time.October, 5, 3, 40)
	if date, outcome := dates.resolve("sydneytrains", "overnight", header, time.Time{}); outcome != dateResolved || date != "20261004" {
		t.Errorf("26:30 trip seen 03:40 the morning after DST start resolves to %q/%d, want 20261004", date, outcome)
	}
	header = sydneyTime(t, 2027, time.April, 5, 3, 40)
	if date, outcome := dates.resolve("sydneytrains", "overnight", header, time.Time{}); outcome != dateResolved || date != "20270404" {
		t.Errorf("26:30 trip seen 03:40 the morning after DST end resolves to %q/%d, want 20270404", date, outcome)
	}
}

func TestOldCancellationLandsOnTheDayTheServiceRan(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00weekday": {firstDepartureSecs: 64800, startDate: 20260901, endDate: 20261031, weekdays: 0b0011111},
	})
	header := sydneyTime(t, 2026, time.September, 8, 1, 33)
	cancelled := gtfs.TripDescriptor_CANCELED
	entity := &gtfs.FeedEntity{Id: proto.String("c"), TripUpdate: &gtfs.TripUpdate{
		Trip:      &gtfs.TripDescriptor{TripId: proto.String("weekday"), ScheduleRelationship: &cancelled},
		Timestamp: proto.Uint64(uint64(header.Unix())),
	}}
	snapshot, _, counts, err := NormalizeRealtime("sydneytrains", probeFeed(t, header, entity), header, dates)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("Mon-Fri 18:00 trip, cancellation with a current timestamp at Tuesday 01:33: %+v -> %+v", counts, snapshot.Updates)
	if counts.Accepted != 1 || snapshot.Updates[0].ServiceDate != "20260907" {
		t.Fatalf("a republished cancellation must land on Monday's instance, not Tuesday's: %+v", snapshot.Updates)
	}
}

func TestResolveWindowsAndPrecedence(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00noon":  {firstDepartureSecs: 43200, startDate: 20260901, endDate: 20261031, weekdays: everyDayMask},
		"sydneytrains\x00dawn":  {firstDepartureSecs: 21600, startDate: 20260901, endDate: 20261031, weekdays: everyDayMask},
		"sydneytrains\x00mon":   {firstDepartureSecs: 43200, startDate: 20260901, endDate: 20261031, weekdays: 1 << 0},
		"sydneytrains\x00never": {firstDepartureSecs: 43200, startDate: 20260101, endDate: 20260131, weekdays: everyDayMask},
	})
	sep := func(day, hour, minute int) time.Time { return sydneyTime(t, 2026, time.September, day, hour, minute) }
	cases := []struct {
		name     string
		trip     string
		header   time.Time
		stopTime time.Time
		want     string
		outcome  dateOutcome
	}{
		{"a noon trip seen at 23:30 is still today's", "noon", sep(6, 23, 30), time.Time{}, "20260906", dateResolved},
		{"stop rule overrides: stop at 13:00 today", "noon", sep(6, 23, 30), sep(6, 13, 0), "20260906", dateResolved},
		{"Monday-only: start exactly 24h before header is inside", "mon", sep(8, 12, 0), time.Time{}, "20260907", dateResolved},
		{"Monday-only: start 24h+1min before header is outside", "mon", sep(8, 12, 1), time.Time{}, "", dateAmbiguous},
		{"Monday-only: start exactly 3h after header is inside", "mon", sep(7, 9, 0), time.Time{}, "20260907", dateResolved},
		{"Monday-only: start 3h+1min after header is outside", "mon", sep(7, 8, 59), time.Time{}, "", dateAmbiguous},
		{"stop exactly 3h after start", "dawn", sep(6, 9, 0), sep(6, 9, 0), "20260906", dateResolved},
		{"stop 3h+1s after start falls back to the header rule", "dawn", sep(6, 9, 0), sep(6, 9, 0).Add(time.Second), "20260906", dateResolved},
		{"stop 3h before start (early?) is inside", "dawn", sep(6, 3, 0), sep(6, 3, 0), "20260906", dateResolved},
		{"calendar with no running candidate", "never", sep(6, 12, 0), time.Time{}, "", dateAmbiguous},
		{"a far-future stop time falls back to the header rule", "dawn", sep(6, 6, 0), sydneyTime(t, 2050, time.January, 1, 0, 0), "20260906", dateResolved},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			date, outcome := dates.resolve("sydneytrains", c.trip, c.header, c.stopTime)
			if date != c.want || outcome != c.outcome {
				t.Fatalf("resolve = %q/%d, want %q/%d", date, outcome, c.want, c.outcome)
			}
		})
	}
}

func TestLongTripWithLateStopTimesFallsBackToTheHeader(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00ccn": {firstDepartureSecs: 21600, startDate: 20260901, endDate: 20261031, weekdays: everyDayMask},
	})
	header := sydneyTime(t, 2026, time.September, 6, 9, 25)
	stop := sydneyTime(t, 2026, time.September, 6, 9, 31).Unix()
	body := probeFeed(t, header, probeEntity("a", "ccn", "", &stop))
	_, _, counts, err := NormalizeRealtime("sydneytrains", body, header, dates)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("06:00 daily trip, header 09:25, only stop time 09:31 (3h31 after start): %+v", counts)
	if counts.Accepted != 1 {
		t.Errorf("a running trip whose only stop time is past the three-hour window must fall back to the header rule")
	}
}

func TestAbsentTimestampWithResolvedDateIsAccepted(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00late": {firstDepartureSecs: 90600, startDate: 20260901, endDate: 20261031, weekdays: everyDayMask},
	})
	header := sydneyTime(t, 2026, time.September, 6, 1, 33)
	snapshot, _, counts, err := NormalizeRealtime("sydneytrains", probeFeed(t, header, probeEntity("a", "late", "", nil)), header, dates)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Accepted != 1 || snapshot.Updates[0].Timestamp != nil {
		t.Fatalf("counts=%+v updates=%+v", counts, snapshot.Updates)
	}
}

func TestServedManifestIsByteIdenticalWithoutTripIndex(t *testing.T) {
	bootstrap := filepath.Join("..", "..", "native-data", "bootstrap")
	payload, err := os.ReadFile(filepath.Join(bootstrap, "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var loose map[string]json.RawMessage
	if err := json.Unmarshal(payload, &loose); err != nil {
		t.Fatal(err)
	}
	if _, ok := loose["tripIndex"]; !ok {
		t.Fatal("bootstrap manifest has no tripIndex")
	}
	delete(loose, "tripIndex")
	stripped, _ := json.Marshal(loose)
	var old Manifest
	if err := json.Unmarshal(stripped, &old); err != nil {
		t.Fatal(err)
	}
	oldCanonical, _ := json.Marshal(old)
	oldCanonical = append(oldCanonical, '\n')

	service, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: t.TempDir(), BootstrapDir: bootstrap})
	if err != nil {
		t.Fatal(err)
	}
	_, representation, err := service.Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if string(representation.JSON) != string(oldCanonical) {
		t.Fatalf("served manifest differs from the pre-sidecar form:\n%s\n%s", representation.JSON, oldCanonical)
	}
	t.Logf("served ETag %s", representation.ETag)
}

func TestOldCurrentJSONWithoutTripIndexLoads(t *testing.T) {
	dataDir := t.TempDir()
	writeTestTimetable(t, dataDir, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), []byte("sqlite fixture"))
	if err := os.Rename(filepath.Join(dataDir, "manifest.json"), filepath.Join(dataDir, "current.json")); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: dataDir})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Manifest(); err != nil {
		t.Fatal(err)
	}
	if service.timetable.serviceDates().Len() != 0 {
		t.Fatal("phantom entries")
	}
}

func TestCorruptSidecarDegradesWithWarning(t *testing.T) {
	bootstrap := t.TempDir()
	writeTestTimetable(t, bootstrap, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), []byte("sqlite fixture"))
	index := writeTestTripIndex(t, bootstrap, []string{"sydneytrains\tlate\t90600\t20260901\t20261031\t127\t\t"})
	declareTripIndex(t, filepath.Join(bootstrap, "manifest.json"), &index)
	altered := writeTestTripIndex(t, bootstrap, []string{"sydneytrains\tlate\t90600\t20260901\t20261031\t1\t\t"})
	if err := os.Rename(filepath.Join(bootstrap, altered.Name), filepath.Join(bootstrap, index.Name)); err != nil {
		t.Fatal(err)
	}
	var logged []string
	service, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: t.TempDir(), BootstrapDir: bootstrap,
		Logf: func(format string, args ...any) { logged = append(logged, fmt.Sprintf(format, args...)) }})
	if err != nil {
		t.Fatal(err)
	}
	if service.timetable.serviceDates().Len() != 0 || len(logged) != 1 || !strings.Contains(logged[0], "hash mismatch") {
		t.Fatalf("len=%d log=%v", service.timetable.serviceDates().Len(), logged)
	}
}

func TestIndexLoadedOnce(t *testing.T) {
	bootstrap := filepath.Join("..", "..", "native-data", "bootstrap")
	started := time.Now()
	service, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: t.TempDir(), BootstrapDir: bootstrap})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("NewService with bootstrap index: %s", time.Since(started))
	if service.timetable.serviceDates() != service.timetable.serviceDates() {
		t.Fatal("index pointer changes between calls")
	}
}

func TestMemoryOfTripIndex(t *testing.T) {
	bootstrap := filepath.Join("..", "..", "native-data", "bootstrap")
	heap := func() uint64 {
		runtime.GC()
		var stats runtime.MemStats
		runtime.ReadMemStats(&stats)
		return stats.HeapAlloc
	}
	before := heap()
	started := time.Now()
	dates, err := LoadServiceDates(bootstrap)
	if err != nil {
		t.Fatal(err)
	}
	loadTime := time.Since(started)
	after := heap()
	t.Logf("rows=%d heap=%.1f MiB load=%s", dates.Len(), float64(after-before)/(1<<20), loadTime)

	type compact struct {
		first    int32
		calendar uint16
	}
	calendars := make(map[string]uint16)
	table := make([]tripCalendar, 0, 1024)
	interned := make(map[string]compact, dates.Len())
	for key, calendar := range dates.trips {
		signature := fmt.Sprint(calendar.startDate, calendar.endDate, calendar.weekdays, calendar.added, calendar.removed)
		index, ok := calendars[signature]
		if !ok {
			index = uint16(len(table))
			table = append(table, calendar)
			calendars[signature] = index
		}
		interned[key] = compact{first: calendar.firstDepartureSecs, calendar: index}
	}
	dates.trips = nil
	dates = nil
	calendars = nil
	internedHeap := heap()
	t.Logf("interned: %d distinct calendars, heap=%.1f MiB", len(table), float64(internedHeap-before)/(1<<20))
	runtime.KeepAlive(interned)
	runtime.KeepAlive(table)
}

func TestCaptureClassification(t *testing.T) {
	body, err := os.ReadFile(filepath.Join("..", "..", "tools", "fixtures", "gtfs_realtime_sydneytrains_20260906.pb"))
	if err != nil {
		t.Fatal(err)
	}
	dates, err := LoadServiceDates(filepath.Join("..", "..", "native-data", "bootstrap"))
	if err != nil {
		t.Fatal(err)
	}
	var feed gtfs.FeedMessage
	if err := proto.Unmarshal(body, &feed); err != nil {
		t.Fatal(err)
	}
	header := time.Unix(int64(feed.Header.GetTimestamp()), 0).UTC()
	local := header.In(dates.location)
	t.Logf("header %s", local.Format("2006-01-02 15:04:05 MST"))

	type row struct {
		rule, outcome, status, date, tripID string
		offsetHours                         float64
		runningCandidates                   int
		earliestStop                        time.Time
		timestampAge                        time.Duration
	}
	var rows []row
	for _, entity := range feed.Entity {
		raw := entity.GetTripUpdate()
		if raw == nil || raw.Trip == nil {
			continue
		}
		tripID := raw.Trip.GetTripId()
		calendar, ok := dates.trips["sydneytrains\x00"+tripID]
		status := raw.Trip.GetScheduleRelationship().String()
		if !ok {
			rows = append(rows, row{rule: "-", outcome: "unknown", status: status, tripID: tripID})
			continue
		}
		stop := earliestStopTime(raw)
		date, outcome := dates.resolve("sydneytrains", tripID, header, stop)
		rule, target := "header", header
		if !stop.IsZero() {
			rule, target = "stop", stop
		}
		r := row{rule: rule, status: status, date: date, earliestStop: stop, tripID: tripID}
		switch outcome {
		case dateResolved:
			r.outcome = "resolved"
		case dateAmbiguous:
			r.outcome = "ambiguous"
		}
		var nearest time.Duration
		for offset := -1; offset <= 1; offset++ {
			day := time.Date(local.Year(), local.Month(), local.Day()+offset, 12, 0, 0, 0, dates.location)
			compactDate := int32(day.Year()*10000 + int(day.Month())*100 + day.Day())
			if !calendar.runsOn(compactDate, mondayIndex(day.Weekday())) {
				continue
			}
			r.runningCandidates++
			start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, int(calendar.firstDepartureSecs), 0, dates.location)
			distance := start.Sub(target)
			if r.runningCandidates == 1 || abs(distance) < abs(nearest) {
				nearest = distance
			}
		}
		r.offsetHours = nearest.Hours()
		if raw.Timestamp != nil {
			r.timestampAge = header.Sub(time.Unix(int64(raw.GetTimestamp()), 0))
		}
		rows = append(rows, r)
	}

	summary := map[string]int{}
	for _, r := range rows {
		summary[r.rule+"/"+r.outcome+"/"+r.status] = summary[r.rule+"/"+r.outcome+"/"+r.status] + 1
	}
	keys := make([]string, 0, len(summary))
	for k := range summary {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		t.Logf("%-40s %d", k, summary[k])
	}

	t.Log("ambiguous rows (rule, status, running candidates, nearest start offset from target in hours, timestamp age):")
	ambiguousWithStop, ambiguousStopRuleButHeaderWouldResolve := 0, 0
	minOffset, maxOffset := 0.0, 0.0
	for _, r := range rows {
		if r.outcome != "ambiguous" {
			continue
		}
		if minOffset == 0 || r.offsetHours < minOffset {
			minOffset = r.offsetHours
		}
		if r.offsetHours > maxOffset {
			maxOffset = r.offsetHours
		}
		if r.rule == "stop" {
			ambiguousWithStop++
			if _, o := dates.resolve("sydneytrains", r.tripID, header, time.Time{}); o == dateResolved {
				ambiguousStopRuleButHeaderWouldResolve++
			}
		}
		t.Logf("  %-6s %-11s cands=%d offset=%+.2fh tsAge=%s", r.rule, r.status, r.runningCandidates, r.offsetHours, r.timestampAge.Round(time.Second))
	}
	t.Logf("ambiguous decided by stop rule: %d (header rule alone would resolve %d); nearest-start offset range %.2fh..%.2fh", ambiguousWithStop, ambiguousStopRuleButHeaderWouldResolve, minOffset, maxOffset)

	t.Log("resolved rows: rule, offset distribution")
	buckets := map[string]int{}
	for _, r := range rows {
		if r.outcome != "resolved" {
			continue
		}
		bucket := fmt.Sprintf("%s date=%s offset=%+dh", r.rule, r.date, int(r.offsetHours))
		buckets[bucket]++
	}
	keys = keys[:0]
	for k := range buckets {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		t.Logf("  %-40s %d", k, buckets[k])
	}
}

func abs(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

func TestCaptureStopShapes(t *testing.T) {
	body, _ := os.ReadFile(filepath.Join("..", "..", "tools", "fixtures", "gtfs_realtime_sydneytrains_20260906.pb"))
	var feed gtfs.FeedMessage
	if err := proto.Unmarshal(body, &feed); err != nil {
		t.Fatal(err)
	}
	withTimes, minSeqOne, minSeqOther, stopsPerUpdate := 0, 0, 0, map[int]int{}
	var minSeqs []int
	for _, e := range feed.Entity {
		u := e.GetTripUpdate()
		if u == nil || earliestStopTime(u).IsZero() {
			continue
		}
		withTimes++
		stopsPerUpdate[len(u.StopTimeUpdate)]++
		min := -1
		for _, s := range u.StopTimeUpdate {
			if s.StopSequence != nil && (min < 0 || int(s.GetStopSequence()) < min) {
				min = int(s.GetStopSequence())
			}
		}
		minSeqs = append(minSeqs, min)
		if min == 1 {
			minSeqOne++
		} else {
			minSeqOther++
		}
	}
	sort.Ints(minSeqs)
	t.Logf("updates with absolute times=%d minStopSequence==1: %d other: %d (min seqs %v)", withTimes, minSeqOne, minSeqOther, minSeqs)
	t.Logf("stop updates per update: %v", stopsPerUpdate)
}
