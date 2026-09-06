package api

import (
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
	"trains/internal/native"
)

type nativeFetcher struct{ body []byte }

func (f nativeFetcher) FetchRealtime(context.Context, string, native.Conditional) (native.FetchResult, error) {
	return native.FetchResult{Body: f.body}, nil
}

func (nativeFetcher) FetchSchedule(context.Context, string, native.Conditional) (native.FetchResult, error) {
	panic("unexpected schedule fetch")
}

func nativeTestService(t *testing.T, now time.Time) (*native.Service, native.Manifest, []byte) {
	t.Helper()
	bootstrap := t.TempDir()
	var packageBuffer bytes.Buffer
	archive := zip.NewWriter(&packageBuffer)
	member, _ := archive.Create("timetable.sqlite3")
	_, _ = member.Write([]byte("database"))
	_ = archive.Close()
	sum := sha256.Sum256(packageBuffer.Bytes())
	hash := hex.EncodeToString(sum[:])
	manifest := native.Manifest{
		SchemaVersion: 1, GeneratedAt: now.Add(-time.Hour), ExpiresAt: now.Add(29 * 24 * time.Hour),
		ServiceDateFrom: "20260901", ServiceDateTo: "20260930",
		Packages: []native.TimetablePackage{{Source: "network", SchemaVersion: 1, SHA256: hash,
			URL: "/api/v1/timetable/packages/" + hash + ".zip", Bytes: int64(packageBuffer.Len()),
			ServiceDateFrom: "20260901", ServiceDateTo: "20260930"}},
	}
	document, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(bootstrap, "manifest.json"), document, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(bootstrap, hash+".zip"), packageBuffer.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	full := gtfs.FeedHeader_FULL_DATASET
	scheduled := gtfs.TripDescriptor_SCHEDULED
	feed, _ := proto.Marshal(&gtfs.FeedMessage{
		Header: &gtfs.FeedHeader{GtfsRealtimeVersion: proto.String("2.0"), Incrementality: &full, Timestamp: proto.Uint64(uint64(now.Add(-10 * time.Second).Unix()))},
		Entity: []*gtfs.FeedEntity{{Id: proto.String("one"), TripUpdate: &gtfs.TripUpdate{Trip: &gtfs.TripDescriptor{
			TripId: proto.String("trip"), StartDate: proto.String("20260906"), ScheduleRelationship: &scheduled,
		}}}},
	})
	service, err := native.NewService(native.Config{Fetcher: nativeFetcher{body: feed}, DataDir: t.TempDir(), BootstrapDir: bootstrap, Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	return service, manifest, packageBuffer.Bytes()
}

func TestNativeManifestAndPackageHTTPContracts(t *testing.T) {
	now := time.Date(2026, 9, 6, 1, 0, 0, 0, time.UTC)
	service, manifest, packageBytes := nativeTestService(t, now)
	handler := New(&fakeUpstream{departures: sampleDepartures()}, t.TempDir(), WithNative(service)).Handler()

	got := get(t, handler, "/api/v1/timetable/manifest")
	if got.Code != http.StatusOK || got.Header().Get("Cache-Control") != timetableManifestCacheControl || got.Header().Get("ETag") == "" {
		t.Fatalf("manifest response = %d %+v", got.Code, got.Header())
	}
	conditional := httptest.NewRequest(http.MethodGet, "/api/v1/timetable/manifest", nil)
	conditional.Header.Set("If-None-Match", got.Header().Get("ETag"))
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, conditional)
	if recorder.Code != http.StatusNotModified || recorder.Body.Len() != 0 {
		t.Fatalf("conditional manifest = %d %q", recorder.Code, recorder.Body.String())
	}

	packageResponse := get(t, handler, manifest.Packages[0].URL)
	if packageResponse.Code != http.StatusOK || packageResponse.Header().Get("Cache-Control") != timetablePackageCacheControl || !bytes.Equal(packageResponse.Body.Bytes(), packageBytes) {
		t.Fatalf("package response = %d %+v", packageResponse.Code, packageResponse.Header())
	}
	if got := get(t, handler, "/api/v1/timetable/packages/../../secret.zip"); got.Code != http.StatusBadRequest && got.Code != http.StatusNotFound && got.Code != http.StatusTemporaryRedirect {
		t.Fatalf("unsafe package status = %d", got.Code)
	}
}

func TestRealtimeHTTPContractUsesGzipETagAndHonestStaleness(t *testing.T) {
	now := time.Date(2026, 9, 6, 1, 0, 0, 0, time.UTC)
	service, _, _ := nativeTestService(t, now)
	handler := New(&fakeUpstream{departures: sampleDepartures()}, t.TempDir(), WithNative(service)).Handler()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/realtime/metro", nil)
	request.Header.Set("Accept-Encoding", "gzip")
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || recorder.Header().Get("Content-Encoding") != "gzip" || recorder.Header().Get("ETag") == "" {
		t.Fatalf("realtime response = %d %+v", recorder.Code, recorder.Header())
	}
	reader, err := gzip.NewReader(recorder.Body)
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := io.ReadAll(reader)
	var snapshot native.Snapshot
	if err := json.Unmarshal(payload, &snapshot); err != nil {
		t.Fatal(err)
	}
	if snapshot.Source != "metro" || len(snapshot.Updates) != 1 || snapshot.ExpiresAt != snapshot.HeaderTimestamp.Add(90*time.Second) {
		t.Fatalf("snapshot = %+v", snapshot)
	}
	if recorder.Header().Get("X-Data-Stale") != "" {
		t.Fatal("fresh snapshot marked stale")
	}
	if got := get(t, handler, "/api/v1/realtime/not-a-feed"); got.Code != http.StatusNotFound {
		t.Fatalf("unknown source = %d", got.Code)
	}
}
