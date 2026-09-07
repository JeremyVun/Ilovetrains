package native

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

type recordingLog struct {
	lines []string
}

func (r *recordingLog) logf(format string, args ...any) {
	r.lines = append(r.lines, fmt.Sprintf(format, args...))
}

func (r *recordingLog) matching(prefix string) []string {
	var found []string
	for _, line := range r.lines {
		if strings.HasPrefix(line, prefix) {
			found = append(found, line)
		}
	}
	return found
}

func TestRefreshLogsWhatItAccepted(t *testing.T) {
	header := time.Date(2026, 9, 6, 1, 2, 0, 0, time.UTC)
	now := header.Add(12 * time.Second)
	logger := &recordingLog{}
	fetcher := &fakeFetcher{body: realtimeFixture(t, header)}
	service, err := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(), Now: func() time.Time { return now }, Logf: logger.logf})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.refreshSource(context.Background(), "metro"); err != nil {
		t.Fatal(err)
	}
	want := "realtime source=metro raw=8 accepted=4 unknown=1 ambiguous=0 stale=1 duplicate=2 header_age=12s"
	if lines := logger.matching("realtime source="); len(lines) != 1 || lines[0] != want {
		t.Fatalf("count lines = %v, want %q", lines, want)
	}
	if lines := logger.matching("realtime warning"); len(lines) != 0 {
		t.Fatalf("warned about a healthy refresh: %v", lines)
	}
}

func TestRefreshWarnsWhenNothingSurvives(t *testing.T) {
	header := time.Date(2026, 9, 6, 1, 2, 0, 0, time.UTC)
	logger := &recordingLog{}
	scheduled := gtfs.TripDescriptor_SCHEDULED
	entities := make([]*gtfs.FeedEntity, 0, 3)
	for _, id := range []string{"a", "b", "c"} {
		entities = append(entities, &gtfs.FeedEntity{Id: proto.String(id), TripUpdate: &gtfs.TripUpdate{
			Trip: &gtfs.TripDescriptor{TripId: proto.String("trip-" + id), ScheduleRelationship: &scheduled},
		}})
	}
	fetcher := &fakeFetcher{body: probeFeed(t, header, entities...)}
	service, err := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(),
		Now: func() time.Time { return header.Add(time.Second) }, Logf: logger.logf})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.refreshSource(context.Background(), "sydneytrains"); err != nil {
		t.Fatal(err)
	}
	want := "realtime warning source=sydneytrains published nothing from 3 updates"
	if lines := logger.matching("realtime warning"); len(lines) != 1 || lines[0] != want {
		t.Fatalf("warning lines = %v, want %q", lines, want)
	}
	if lines := logger.matching("realtime source="); len(lines) != 1 {
		t.Fatalf("a warned refresh must still report its counts: %v", lines)
	}
}

func TestNotModifiedRefreshLogsNothing(t *testing.T) {
	header := time.Date(2026, 9, 6, 1, 2, 0, 0, time.UTC)
	now := header.Add(10 * time.Second)
	logger := &recordingLog{}
	fetcher := &fakeFetcher{result: FetchResult{NotModified: true}}
	service, err := NewService(Config{Fetcher: fetcher, DataDir: t.TempDir(), Now: func() time.Time { return now }, Logf: logger.logf})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.refreshSource(context.Background(), "metro"); err == nil {
		t.Fatal("a cold 304 without a snapshot must fail")
	}
	if lines := logger.matching("realtime "); len(lines) != 0 {
		t.Fatalf("logged for a refresh that normalized nothing: %v", lines)
	}
}

func TestFeedPollIntervalIsInsideSnapshotLifetime(t *testing.T) {
	service, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if service.realtimeInterval != 60*time.Second {
		t.Fatalf("feed poll interval = %s, want 60s", service.realtimeInterval)
	}
	if realtimeLifetime <= defaultRealtimeInterval {
		t.Fatalf("a snapshot expires after %s but the next feed poll is %s away", realtimeLifetime, defaultRealtimeInterval)
	}
}
