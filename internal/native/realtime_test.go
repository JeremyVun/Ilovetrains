package native

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

func realtimeFixture(t *testing.T, timestamp time.Time) []byte {
	t.Helper()
	full := gtfs.FeedHeader_FULL_DATASET
	scheduled := gtfs.TripDescriptor_SCHEDULED
	added := gtfs.TripDescriptor_ADDED
	cancelled := gtfs.TripDescriptor_CANCELED
	skipped := gtfs.TripUpdate_StopTimeUpdate_SKIPPED
	sequence := uint32(2)
	arrival := timestamp.Add(3 * time.Minute).Unix()
	oldTimestamp := uint64(timestamp.Add(-2 * time.Minute).Unix())
	delay := int32(45)
	feed := &gtfs.FeedMessage{
		Header: &gtfs.FeedHeader{GtfsRealtimeVersion: proto.String("2.0"), Incrementality: &full, Timestamp: proto.Uint64(uint64(timestamp.Unix()))},
		Entity: []*gtfs.FeedEntity{
			{Id: proto.String("scheduled"), TripUpdate: &gtfs.TripUpdate{
				Trip:      &gtfs.TripDescriptor{TripId: proto.String("trip-1"), StartDate: proto.String("20260906"), RouteId: proto.String("T1"), ScheduleRelationship: &scheduled},
				Timestamp: proto.Uint64(uint64(timestamp.Add(-time.Second).Unix())),
				StopTimeUpdate: []*gtfs.TripUpdate_StopTimeUpdate{{StopId: proto.String("stop-1"), StopSequence: &sequence,
					Arrival: &gtfs.TripUpdate_StopTimeEvent{Time: &arrival, Delay: &delay}, ScheduleRelationship: &skipped,
					StopTimeProperties: &gtfs.TripUpdate_StopTimeUpdate_StopTimeProperties{AssignedStopId: proto.String("platform-2")}}},
			}},
			{Id: proto.String("added"), TripUpdate: &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{
				TripId: proto.String("extra-1"), StartDate: proto.String("20260906"), RouteId: proto.String("T1"), ScheduleRelationship: &added,
			}}},
			{Id: proto.String("cancelled"), TripUpdate: &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{
				TripId: proto.String("trip-2"), StartDate: proto.String("20260906"), ScheduleRelationship: &cancelled,
			}}},
			{Id: proto.String("missing-date"), TripUpdate: &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{TripId: proto.String("unsafe")}}},
			{Id: proto.String("old-observation"), TripUpdate: &gtfs.TripUpdate{
				Trip: &gtfs.TripDescriptor{TripId: proto.String("old-trip"), StartDate: proto.String("20260906")}, Timestamp: &oldTimestamp,
			}},
			{Id: proto.String("duplicate-a"), TripUpdate: &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{TripId: proto.String("duplicate"), StartDate: proto.String("20260906")}}},
			{Id: proto.String("duplicate-b"), TripUpdate: &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{TripId: proto.String("duplicate"), StartDate: proto.String("20260906")}}},
		},
	}
	body, err := proto.Marshal(feed)
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestNormalizeRealtimePreservesExactSemantics(t *testing.T) {
	headerTime := time.Date(2026, 9, 6, 1, 2, 3, 0, time.UTC)
	snapshot, representation, counts, err := NormalizeRealtime("sydneytrains", realtimeFixture(t, headerTime), headerTime.Add(10*time.Second), nil)
	if err != nil {
		t.Fatal(err)
	}
	if (counts != RealtimeCounts{Raw: 7, Accepted: 3, Unknown: 1, Stale: 1, Duplicate: 2}) {
		t.Fatalf("counts = %+v", counts)
	}
	if snapshot.ExpiresAt != headerTime.Add(90*time.Second) || snapshot.GeneratedAt != headerTime.Add(10*time.Second) {
		t.Fatalf("timestamps = %s/%s", snapshot.GeneratedAt, snapshot.ExpiresAt)
	}
	if len(snapshot.Updates) != 3 {
		t.Fatalf("updates = %+v, want 3 safe unique identities", snapshot.Updates)
	}
	if snapshot.Updates[0].TripID != "extra-1" || snapshot.Updates[0].Status != "added" {
		t.Errorf("added update = %+v", snapshot.Updates[0])
	}
	if snapshot.Updates[1].TripID != "trip-1" || snapshot.Updates[1].Status != "scheduled" {
		t.Errorf("scheduled update = %+v", snapshot.Updates[1])
	}
	stop := snapshot.Updates[1].StopUpdates[0]
	if stop.ScheduleRelationship != "skipped" || stop.AssignedStopID != "platform-2" || stop.ArrivalMs == nil || *stop.ArrivalMs != headerTime.Add(3*time.Minute).UnixMilli() {
		t.Errorf("stop update = %+v", stop)
	}
	if snapshot.Updates[2].Status != "cancelled" {
		t.Errorf("cancelled update = %+v", snapshot.Updates[2])
	}
	if len(representation.JSON) == 0 || len(representation.GZIP) == 0 || representation.ETag == "" {
		t.Fatal("missing cached representations")
	}
}

func TestNormalizeRealtimeRejectsDifferentialAndMissingTimestamp(t *testing.T) {
	differential := gtfs.FeedHeader_DIFFERENTIAL
	for name, header := range map[string]*gtfs.FeedHeader{
		"differential": {GtfsRealtimeVersion: proto.String("2.0"), Incrementality: &differential, Timestamp: proto.Uint64(1)},
		"no timestamp": {GtfsRealtimeVersion: proto.String("2.0")},
	} {
		t.Run(name, func(t *testing.T) {
			body, _ := proto.Marshal(&gtfs.FeedMessage{Header: header})
			if _, _, _, err := NormalizeRealtime("metro", body, time.Now(), nil); err == nil {
				t.Fatal("accepted unsafe replacement feed")
			}
		})
	}
}

type fakeFetcher struct {
	mu         sync.Mutex
	body       []byte
	err        error
	result     FetchResult
	calls      int
	conditions []Conditional
	started    chan struct{}
	release    chan struct{}
}

func (f *fakeFetcher) FetchRealtime(ctx context.Context, _ string, condition Conditional) (FetchResult, error) {
	f.mu.Lock()
	f.calls++
	f.conditions = append(f.conditions, condition)
	started, release, result, body, err := f.started, f.release, f.result, f.body, f.err
	if started != nil && f.calls == 1 {
		close(started)
	}
	f.mu.Unlock()
	if release != nil {
		select {
		case <-release:
		case <-ctx.Done():
			return FetchResult{}, ctx.Err()
		}
	}
	if err != nil {
		return FetchResult{}, err
	}
	if len(result.Body) == 0 {
		result.Body = body
	}
	return result, nil
}

func (f *fakeFetcher) FetchSchedule(context.Context, string, Conditional) (FetchResult, error) {
	return FetchResult{}, errors.New("not configured")
}

func TestRealtimeConcurrentColdRequestsShareOneFetch(t *testing.T) {
	now := time.Date(2026, 9, 6, 1, 2, 20, 0, time.UTC)
	fetcher := &fakeFetcher{body: realtimeFixture(t, now.Add(-20*time.Second)), started: make(chan struct{}), release: make(chan struct{})}
	service, err := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(), Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	const clients = 30
	errs := make(chan error, clients)
	var wg sync.WaitGroup
	for range clients {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := service.Realtime(context.Background(), "metro")
			errs <- err
		}()
	}
	<-fetcher.started
	close(fetcher.release)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	fetcher.mu.Lock()
	defer fetcher.mu.Unlock()
	if fetcher.calls != 1 {
		t.Fatalf("fetches = %d, want 1", fetcher.calls)
	}
}

func TestRealtimeConditionalNotModifiedKeepsSourceFreshness(t *testing.T) {
	now := time.Date(2026, 9, 6, 1, 2, 20, 0, time.UTC)
	fetcher := &fakeFetcher{body: realtimeFixture(t, now.Add(-20*time.Second)), result: FetchResult{ETag: `"upstream"`}}
	service, _ := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(), Now: func() time.Time { return now }})
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal(err)
	}
	fetcher.mu.Lock()
	fetcher.result = FetchResult{NotModified: true, ETag: `"upstream"`}
	fetcher.body = nil
	fetcher.mu.Unlock()
	now = now.Add(time.Minute)
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal(err)
	}
	data, err := service.Realtime(context.Background(), "metro")
	if err != nil {
		t.Fatal(err)
	}
	if data.Snapshot.GeneratedAt != time.Date(2026, 9, 6, 1, 2, 20, 0, time.UTC) {
		t.Fatalf("304 changed generatedAt to %s", data.Snapshot.GeneratedAt)
	}
	fetcher.mu.Lock()
	defer fetcher.mu.Unlock()
	if len(fetcher.conditions) != 2 || fetcher.conditions[1].ETag != `"upstream"` {
		t.Fatalf("conditions = %+v", fetcher.conditions)
	}
}

func TestRealtimeRepeatedBodyKeepsRepresentationStable(t *testing.T) {
	now := time.Date(2026, 9, 6, 1, 2, 20, 0, time.UTC)
	fetcher := &fakeFetcher{body: realtimeFixture(t, now.Add(-20*time.Second))}
	service, _ := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(), Now: func() time.Time { return now }})
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal(err)
	}
	first, _ := service.Realtime(context.Background(), "metro")
	now = now.Add(20 * time.Second)
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal(err)
	}
	second, _ := service.Realtime(context.Background(), "metro")
	if second.Representation.ETag != first.Representation.ETag || second.Snapshot.GeneratedAt != first.Snapshot.GeneratedAt {
		t.Fatalf("identical source changed representation: first=%s/%s second=%s/%s",
			first.Representation.ETag, first.Snapshot.GeneratedAt, second.Representation.ETag, second.Snapshot.GeneratedAt)
	}
}

func datelessFixture(t *testing.T, header time.Time, tripID string, stopTime *int64) []byte {
	t.Helper()
	full := gtfs.FeedHeader_FULL_DATASET
	scheduled := gtfs.TripDescriptor_SCHEDULED
	trip := &gtfs.TripDescriptor{TripId: proto.String(tripID), ScheduleRelationship: &scheduled}
	update := &gtfs.TripUpdate{Trip: trip}
	if stopTime != nil {
		update.StopTimeUpdate = []*gtfs.TripUpdate_StopTimeUpdate{{
			StopId: proto.String("stop-1"), Departure: &gtfs.TripUpdate_StopTimeEvent{Time: stopTime},
		}}
	}
	body, err := proto.Marshal(&gtfs.FeedMessage{
		Header: &gtfs.FeedHeader{GtfsRealtimeVersion: proto.String("2.0"), Incrementality: &full, Timestamp: proto.Uint64(uint64(header.Unix()))},
		Entity: []*gtfs.FeedEntity{{Id: proto.String("dateless"), TripUpdate: update}},
	})
	if err != nil {
		t.Fatal(err)
	}
	return body
}

func TestNormalizeRealtimeResolvesUpdatesWithoutAStartDate(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00late": {firstDepartureSecs: 90600, startDate: 20260901, endDate: 20261031, weekdays: 0b1111111},
	})
	header := sydneyTime(t, 2026, time.September, 6, 1, 33)
	snapshot, _, counts, err := NormalizeRealtime("sydneytrains", datelessFixture(t, header, "late", nil), header, dates)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Accepted != 1 || snapshot.Updates[0].ServiceDate != "20260905" {
		t.Fatalf("counts = %+v, updates = %+v", counts, snapshot.Updates)
	}

	_, _, missing, err := NormalizeRealtime("sydneytrains", datelessFixture(t, header, "ghost", nil), header, dates)
	if err != nil {
		t.Fatal(err)
	}
	if missing.Unknown != 1 || missing.Accepted != 0 {
		t.Fatalf("counts for an unindexed trip = %+v", missing)
	}
}

func TestNormalizeRealtimeKeepsAnExplicitStartDate(t *testing.T) {
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00late": {firstDepartureSecs: 90600, startDate: 20260901, endDate: 20261031, weekdays: 0b1111111},
	})
	header := sydneyTime(t, 2026, time.September, 6, 1, 33)
	body := datelessFixture(t, header, "late", nil)
	var feed gtfs.FeedMessage
	if err := proto.Unmarshal(body, &feed); err != nil {
		t.Fatal(err)
	}
	feed.Entity[0].TripUpdate.Trip.StartDate = proto.String("20260906")
	explicit, err := proto.Marshal(&feed)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, _, counts, err := NormalizeRealtime("sydneytrains", explicit, header, dates)
	if err != nil {
		t.Fatal(err)
	}
	if counts.Accepted != 1 || snapshot.Updates[0].ServiceDate != "20260906" {
		t.Fatalf("resolution overrode the published start date: %+v", snapshot.Updates)
	}
}

func TestNormalizeRealtimeReplaysTheCapturedSydneyTrainsFeed(t *testing.T) {
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
		t.Fatal("the captured Sydney Trains feed does not match its recorded hash")
	}
	dates, err := LoadServiceDates(filepath.Join("..", "..", "native-data", "bootstrap"))
	if err != nil {
		t.Fatal(err)
	}
	snapshot, _, counts, err := NormalizeRealtime("sydneytrains", body, capture.ReceivedAt, dates)
	if err != nil {
		t.Fatal(err)
	}
	want := RealtimeCounts{Raw: 308, Accepted: 69, Unknown: 159, Ambiguous: 40, Stale: 40, Duplicate: 0}
	if counts != want {
		t.Fatalf("counts = %+v, want %+v", counts, want)
	}
	if capture.ReceivedAt.After(snapshot.ExpiresAt) {
		t.Fatal("the captured feed was already expired when it was received")
	}
	for _, update := range snapshot.Updates {
		if update.ServiceDate < "20260905" || update.ServiceDate > "20260907" {
			t.Fatalf("update %s resolved to %q", update.TripID, update.ServiceDate)
		}
	}
}

func sum256(body []byte) []byte {
	sum := sha256.Sum256(body)
	return sum[:]
}
