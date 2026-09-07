package native

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

var probeRelationships = map[string]gtfs.TripDescriptor_ScheduleRelationship{
	"scheduled":   gtfs.TripDescriptor_SCHEDULED,
	"cancelled":   gtfs.TripDescriptor_CANCELED,
	"replacement": gtfs.TripDescriptor_REPLACEMENT,
	"added":       gtfs.TripDescriptor_ADDED,
	"unscheduled": gtfs.TripDescriptor_UNSCHEDULED,
}

func probeUpdate(id, tripID, startDate string, relationship gtfs.TripDescriptor_ScheduleRelationship, timestamp *time.Time) *gtfs.FeedEntity {
	trip := &gtfs.TripDescriptor{TripId: proto.String(tripID), ScheduleRelationship: &relationship}
	if startDate != "" {
		trip.StartDate = proto.String(startDate)
	}
	update := &gtfs.TripUpdate{Trip: trip}
	if timestamp != nil {
		update.Timestamp = proto.Uint64(uint64(timestamp.Unix()))
	}
	return &gtfs.FeedEntity{Id: proto.String(id), TripUpdate: update}
}

type probeFetcher struct {
	mu    sync.Mutex
	calls int
	fetch func(call int) (FetchResult, error)
}

func (p *probeFetcher) FetchRealtime(context.Context, string, Conditional) (FetchResult, error) {
	p.mu.Lock()
	p.calls++
	call := p.calls
	p.mu.Unlock()
	return p.fetch(call)
}

func (p *probeFetcher) FetchSchedule(context.Context, string, Conditional) (FetchResult, error) {
	return FetchResult{}, errors.New("not configured")
}

func loadSydneyTrainsCapture(t *testing.T) ([]byte, time.Time, *ServiceDates) {
	t.Helper()
	var capture struct {
		Bytes      int       `json:"bytes"`
		SHA256     string    `json:"sha256"`
		ReceivedAt time.Time `json:"receivedAt"`
	}
	metadata, err := os.ReadFile(filepath.Join("..", "..", "tools", "fixtures", "gtfs_realtime_sydneytrains_20260906.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(metadata, &capture); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join("..", "..", "tools", "fixtures", "gtfs_realtime_sydneytrains_20260906.pb"))
	if err != nil {
		t.Fatal(err)
	}
	if len(body) != capture.Bytes || hex.EncodeToString(sum256(body)) != capture.SHA256 {
		t.Fatal("capture hash mismatch")
	}
	dates, err := LoadServiceDates(filepath.Join("..", "..", "native-data", "bootstrap"))
	if err != nil {
		t.Fatal(err)
	}
	return body, capture.ReceivedAt, dates
}

func TestProbeI1FreshnessBoundaries(t *testing.T) {
	header := time.Date(2026, 9, 6, 1, 33, 0, 0, time.UTC)
	cases := []struct {
		name            string
		offset          time.Duration
		absent          bool
		keepsScheduled  bool
		keepsStructural bool
	}{
		{name: "absent", absent: true, keepsScheduled: true, keepsStructural: true},
		{name: "exactly 10m00s before", offset: -10 * time.Minute, keepsScheduled: true, keepsStructural: true},
		{name: "10m01s before", offset: -10*time.Minute - time.Second, keepsStructural: true},
		{name: "exactly 5s ahead", offset: 5 * time.Second, keepsScheduled: true, keepsStructural: true},
		{name: "6s ahead", offset: 6 * time.Second},
		{name: "three days before", offset: -72 * time.Hour, keepsStructural: true},
	}
	for status, relationship := range probeRelationships {
		for _, c := range cases {
			t.Run(status+"/"+c.name, func(t *testing.T) {
				var timestamp *time.Time
				if !c.absent {
					value := header.Add(c.offset)
					timestamp = &value
				}
				body := probeFeed(t, header, probeUpdate("a", "trip-1", "20260906", relationship, timestamp))
				snapshot, _, counts, err := NormalizeRealtime("sydneytrains", body, header, nil)
				if err != nil {
					t.Fatal(err)
				}
				want := c.keepsStructural
				if status == "scheduled" {
					want = c.keepsScheduled
				}
				if (counts.Accepted == 1) != want || (counts.Stale == 1) == want {
					t.Fatalf("counts = %+v, want accepted=%v", counts, want)
				}
				if !want {
					return
				}
				got := snapshot.Updates[0].Timestamp
				switch {
				case c.absent && got != nil:
					t.Fatalf("absent timestamp was invented: %s", got)
				case !c.absent && !got.Equal(*timestamp):
					t.Fatalf("timestamp altered: %s want %s", got, timestamp)
				}
			})
		}
	}
}

func TestProbeI2StructuralAgeNeverMovesTheServiceDay(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00dawn": {firstDepartureSecs: 16200, startDate: 20260901, endDate: 20261031, weekdays: everyDayMask},
	})
	cases := []struct {
		name   string
		header time.Time
		age    time.Duration
		want   string
	}{
		{"Tue 17:00, three days old: today's 04:30 ran, tomorrow's is 11.5h away", sydneyTime(t, 2026, time.September, 8, 17, 0), 72 * time.Hour, "20260908"},
		{"Tue 17:00, nine hours old", sydneyTime(t, 2026, time.September, 8, 17, 0), 9 * time.Hour, "20260908"},
		{"Tue 23:59, current: still today's run", sydneyTime(t, 2026, time.September, 8, 23, 59), 0, "20260908"},
		{"Tue 02:00, five hours old: today's run is 2.5h ahead and wins over yesterday's", sydneyTime(t, 2026, time.September, 8, 2, 0), 5 * time.Hour, "20260908"},
		{"Tue 01:00, current: today's run is 3.5h ahead so it lands on Monday's finished run", sydneyTime(t, 2026, time.September, 8, 1, 0), 0, "20260907"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			stamp := c.header.Add(-c.age)
			body := probeFeed(t, c.header, probeUpdate("a", "dawn", "", gtfs.TripDescriptor_CANCELED, &stamp))
			snapshot, _, counts, err := NormalizeRealtime("sydneytrains", body, c.header, dates)
			if err != nil {
				t.Fatal(err)
			}
			if counts.Accepted != 1 {
				t.Fatalf("counts = %+v", counts)
			}
			got := snapshot.Updates[0].ServiceDate
			local := c.header.In(dates.location)
			yesterday := local.AddDate(0, 0, -1).Format("20060102")
			tomorrow := local.AddDate(0, 0, 1).Format("20060102")
			if got < yesterday || got > tomorrow {
				t.Fatalf("service date %s escaped header %s ±1 day", got, local)
			}
			if got != c.want {
				t.Fatalf("service date = %s, want %s", got, c.want)
			}
		})
	}
}

func TestProbeI3RefreshLogMirrorsCountsAndStaysSilentOtherwise(t *testing.T) {
	header := time.Date(2026, 9, 6, 1, 2, 0, 0, time.UTC)
	now := header.Add(12 * time.Second)
	body := realtimeFixture(t, header)
	empty := probeFeed(t, header)
	ahead := probeFeed(t, now.Add(3*time.Second), probeUpdate("a", "trip-1", "20260906", gtfs.TripDescriptor_SCHEDULED, nil))
	responses := []FetchResult{
		{Body: body, ETag: `"one"`},
		{NotModified: true},
		{Body: body, ETag: `"one"`},
		{Body: []byte("not a protobuf feed at all")},
		{Body: empty},
		{Body: ahead},
	}
	fetcher := &probeFetcher{fetch: func(call int) (FetchResult, error) { return responses[call-1], nil }}
	logger := &recordingLog{}
	service, err := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(), Now: func() time.Time { return now }, Logf: logger.logf})
	if err != nil {
		t.Fatal(err)
	}
	_, _, counts, err := NormalizeRealtime("metro", body, now, nil)
	if err != nil {
		t.Fatal(err)
	}
	want := fmt.Sprintf("realtime source=metro raw=%d accepted=%d unknown=%d ambiguous=%d stale=%d duplicate=%d header_age=12s",
		counts.Raw, counts.Accepted, counts.Unknown, counts.Ambiguous, counts.Stale, counts.Duplicate)

	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal(err)
	}
	if lines := logger.matching("realtime"); len(lines) != 1 || lines[0] != want {
		t.Fatalf("after first 200: %q, want %q", lines, want)
	}
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal("warm 304:", err)
	}
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal("identical 200:", err)
	}
	if lines := logger.matching("realtime"); len(lines) != 1 {
		t.Fatalf("a warm 304 or a byte-identical 200 logged: %q", lines)
	}
	err = service.refreshSource(context.Background(), "metro")
	if err == nil || !strings.Contains(err.Error(), "decode GTFS realtime") {
		t.Fatalf("normalize failure was swallowed: %v", err)
	}
	if lines := logger.matching("realtime"); len(lines) != 1 {
		t.Fatalf("a failed normalize logged counts: %q", lines)
	}
	if data, err := service.Realtime(context.Background(), "metro"); err != nil || data.Snapshot.HeaderTimestamp != header {
		t.Fatalf("previous snapshot lost after a failed normalize: %+v %v", data.Snapshot.HeaderTimestamp, err)
	}
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal("empty feed:", err)
	}
	lines := logger.matching("realtime")
	if len(lines) != 2 || !strings.HasPrefix(lines[1], "realtime source=metro raw=0 accepted=0 ") {
		t.Fatalf("empty feed: %q", lines)
	}
	if warnings := logger.matching("realtime warning"); len(warnings) != 0 {
		t.Fatalf("raw=0 must not warn: %q", warnings)
	}
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal("header ahead:", err)
	}
	lines = logger.matching("realtime source=")
	if len(lines) != 3 || !strings.HasSuffix(lines[2], "header_age=-3s") {
		t.Fatalf("header ahead of receipt: %q", lines)
	}
}

func TestProbeI4PollCadenceAgainstSnapshotLifetime(t *testing.T) {
	for _, lag := range []time.Duration{6 * time.Second, 29 * time.Second, 31 * time.Second} {
		t.Run("header_age="+lag.String(), func(t *testing.T) {
			start := time.Date(2026, 9, 6, 1, 0, 0, 0, time.UTC)
			var mu sync.Mutex
			now := start
			clock := func() time.Time { mu.Lock(); defer mu.Unlock(); return now }
			advance := func(d time.Duration) { mu.Lock(); now = now.Add(d); mu.Unlock() }
			var failing atomic.Bool
			fetcher := &probeFetcher{fetch: func(int) (FetchResult, error) {
				if failing.Load() {
					return FetchResult{}, errors.New("upstream down")
				}
				return FetchResult{Body: probeFeed(t, clock().Add(-lag), probeUpdate("a", "trip-1", "20260906", gtfs.TripDescriptor_SCHEDULED, nil))}, nil
			}}
			service, err := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(), Now: clock})
			if err != nil {
				t.Fatal(err)
			}
			stale := func() bool {
				data, err := service.Realtime(context.Background(), "sydneytrains")
				if err != nil {
					t.Fatal(err)
				}
				return data.Stale
			}
			if err := service.refreshSource(context.Background(), "sydneytrains"); err != nil {
				t.Fatal(err)
			}
			var readers sync.WaitGroup
			stop := make(chan struct{})
			for range 4 {
				readers.Add(1)
				go func() {
					defer readers.Done()
					for {
						select {
						case <-stop:
							return
						default:
							service.Realtime(context.Background(), "sydneytrains")
						}
					}
				}()
			}
			for tick := 1; tick <= 3; tick++ {
				advance(defaultRealtimeInterval)
				expiredBeforePoll := stale()
				if expiredBeforePoll != (lag+defaultRealtimeInterval > realtimeLifetime) {
					t.Fatalf("tick %d: stale before the poll landed = %v with header_age %s", tick, expiredBeforePoll, lag)
				}
				if err := service.refreshSource(context.Background(), "sydneytrains"); err != nil {
					t.Fatal(err)
				}
				if stale() {
					t.Fatalf("tick %d: stale right after a successful poll", tick)
				}
			}
			failing.Store(true)
			lastHeader := clock().Add(-lag)
			advance(defaultRealtimeInterval)
			if err := service.refreshSource(context.Background(), "sydneytrains"); err == nil {
				t.Fatal("failed poll reported success")
			}
			data, err := service.Realtime(context.Background(), "sydneytrains")
			if err != nil || data.Snapshot.HeaderTimestamp != lastHeader {
				t.Fatalf("failed poll replaced the snapshot: %+v %v", data.Snapshot.HeaderTimestamp, err)
			}
			mu.Lock()
			now = lastHeader.Add(realtimeLifetime)
			mu.Unlock()
			if stale() {
				t.Fatal("stale at exactly header+90s")
			}
			advance(time.Second)
			if !stale() {
				t.Fatal("not stale at header+91s after a failed poll")
			}
			failing.Store(false)
			if err := service.refreshSource(context.Background(), "sydneytrains"); err != nil {
				t.Fatal(err)
			}
			if stale() {
				t.Fatal("recovery poll left the snapshot stale")
			}
			close(stop)
			readers.Wait()
		})
	}
}

func TestProbeI5NormalizeIsByteStable(t *testing.T) {
	body, receivedAt, dates := loadSydneyTrainsCapture(t)
	fixtureHeader := time.Date(2026, 9, 6, 1, 2, 0, 0, time.UTC)
	inputs := []struct {
		name       string
		source     string
		body       []byte
		receivedAt time.Time
		dates      *ServiceDates
	}{
		{"capture", "sydneytrains", body, receivedAt, dates},
		{"fixture", "metro", realtimeFixture(t, fixtureHeader), fixtureHeader.Add(10 * time.Second), nil},
	}
	for _, in := range inputs {
		t.Run(in.name, func(t *testing.T) {
			first, firstRep, _, err := NormalizeRealtime(in.source, in.body, in.receivedAt, in.dates)
			if err != nil {
				t.Fatal(err)
			}
			_, secondRep, _, err := NormalizeRealtime(in.source, in.body, in.receivedAt, in.dates)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(firstRep.JSON, secondRep.JSON) || firstRep.ETag != secondRep.ETag || !bytes.Equal(firstRep.GZIP, secondRep.GZIP) {
				t.Fatal("two runs over the same bytes differ")
			}
			for i := 1; i < len(first.Updates); i++ {
				a, b := first.Updates[i-1], first.Updates[i]
				if a.ServiceDate > b.ServiceDate || (a.ServiceDate == b.ServiceDate && a.TripID >= b.TripID) {
					t.Fatalf("order broken at %d: %s/%s then %s/%s", i, a.ServiceDate, a.TripID, b.ServiceDate, b.TripID)
				}
			}
		})
	}
}

func TestProbeI6LookAheadEdge(t *testing.T) {
	tuesday := uint8(1 << 1)
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00exact": {firstDepartureSecs: 12 * 3600, startDate: 20260901, endDate: 20261031, weekdays: tuesday},
		"sydneytrains\x00over":  {firstDepartureSecs: 12*3600 + 60, startDate: 20260901, endDate: 20261031, weekdays: tuesday},
	})
	header := sydneyTime(t, 2026, time.September, 8, 9, 0)
	body := probeFeed(t, header,
		probeUpdate("a", "exact", "", gtfs.TripDescriptor_SCHEDULED, nil),
		probeUpdate("b", "over", "", gtfs.TripDescriptor_CANCELED, nil))
	snapshot, _, counts, err := NormalizeRealtime("sydneytrains", body, header, dates)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Accepted != 1 || counts.Ambiguous != 1 || counts.Unknown != 0 {
		t.Fatalf("counts = %+v, want accepted 1 ambiguous 1", counts)
	}
	if snapshot.Updates[0].TripID != "exact" || snapshot.Updates[0].ServiceDate != "20260908" {
		t.Fatalf("resolved = %+v", snapshot.Updates[0])
	}
}

func TestProbeCaptureStructuralDatesAgainstTheirOwnTimestamps(t *testing.T) {
	body, receivedAt, dates := loadSydneyTrainsCapture(t)
	snapshot, _, _, err := NormalizeRealtime("sydneytrains", body, receivedAt, dates)
	if err != nil {
		t.Fatal(err)
	}
	local := snapshot.HeaderTimestamp.In(dates.location)
	disagreements, checked := 0, 0
	for _, update := range snapshot.Updates {
		if update.Status == "scheduled" || update.Timestamp == nil {
			continue
		}
		calendar := dates.trips["sydneytrains\x00"+update.TripID]
		nearest, nearestDistance := "", time.Duration(0)
		for offset := -1; offset <= 1; offset++ {
			day := time.Date(local.Year(), local.Month(), local.Day()+offset, 12, 0, 0, 0, dates.location)
			compact := int32(day.Year()*10000 + int(day.Month())*100 + day.Day())
			if !calendar.runsOn(compact, mondayIndex(day.Weekday())) {
				continue
			}
			start := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, int(calendar.firstDepartureSecs), 0, dates.location)
			distance := start.Sub(*update.Timestamp)
			if distance < 0 {
				distance = -distance
			}
			if nearest == "" || distance < nearestDistance {
				nearest, nearestDistance = fmt.Sprint(compact), distance
			}
		}
		checked++
		if nearest != update.ServiceDate {
			disagreements++
			t.Logf("%s %s resolved %s by header, but its own timestamp %s is nearest instance %s", update.Status, update.TripID, update.ServiceDate, update.Timestamp.In(dates.location).Format("Mon 15:04"), nearest)
		}
	}
	t.Logf("structural updates with a timestamp: %d, header-resolved date disagrees with timestamp-nearest instance: %d", checked, disagreements)
}
