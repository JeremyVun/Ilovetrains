package native

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

type scheduleFetcher struct{ body []byte }

func (scheduleFetcher) FetchRealtime(context.Context, string, Conditional) (FetchResult, error) {
	return FetchResult{}, errors.New("not configured")
}

func (f scheduleFetcher) FetchSchedule(context.Context, string, Conditional) (FetchResult, error) {
	return FetchResult{Body: f.body, ETag: `"schedule"`}, nil
}

func gtfsZipFixture(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	archive := zip.NewWriter(&buffer)
	for _, name := range []string{"stops.txt", "routes.txt", "trips.txt", "stop_times.txt"} {
		member, _ := archive.Create(name)
		_, _ = member.Write([]byte("header\n"))
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func writeTestTimetable(t *testing.T, dir string, generatedAt time.Time, database []byte) Manifest {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	temporary := filepath.Join(dir, "temporary.zip")
	file, err := os.Create(temporary)
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(file)
	member, err := archive.CreateHeader(&zip.FileHeader{Name: "timetable.sqlite3", Method: zip.Deflate})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := member.Write(database); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	payload, _ := os.ReadFile(temporary)
	sum := sha256.Sum256(payload)
	hash := hex.EncodeToString(sum[:])
	name := hash + ".zip"
	if err := os.Rename(temporary, filepath.Join(dir, name)); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{
		SchemaVersion: SchemaVersion, GeneratedAt: generatedAt, ExpiresAt: generatedAt.Add(30 * 24 * time.Hour),
		ServiceDateFrom: "20260901", ServiceDateTo: "20260930",
		Packages: []TimetablePackage{{
			Source: "network", SchemaVersion: SchemaVersion, SHA256: hash,
			URL: "/api/v1/timetable/packages/" + name, Bytes: int64(len(payload)),
			ServiceDateFrom: "20260901", ServiceDateTo: "20260930",
		}},
	}
	document, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), document, 0o644); err != nil {
		t.Fatal(err)
	}
	return manifest
}

func TestTimetableLoadsVerifiedBootstrapAndRejectsUnknownPackage(t *testing.T) {
	bootstrap := t.TempDir()
	want := writeTestTimetable(t, bootstrap, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), []byte("sqlite fixture"))
	service, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: t.TempDir(), BootstrapDir: bootstrap})
	if err != nil {
		t.Fatal(err)
	}
	got, representation, err := service.Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if got.Packages[0].SHA256 != want.Packages[0].SHA256 || representation.ETag == "" {
		t.Fatalf("manifest = %+v", got)
	}
	if _, ok := service.PackagePath(want.Packages[0].SHA256); !ok {
		t.Fatal("current immutable package is not served")
	}
	for _, invalid := range []string{"../manifest", want.Packages[0].SHA256 + ".zip", "ABC"} {
		if _, ok := service.PackagePath(invalid); ok {
			t.Fatalf("accepted package lookup %q", invalid)
		}
	}
}

func TestTimetableRejectsCorruptBootstrapWithoutReplacingIt(t *testing.T) {
	bootstrap := t.TempDir()
	manifest := writeTestTimetable(t, bootstrap, time.Now(), []byte("sqlite fixture"))
	path := filepath.Join(bootstrap, manifest.Packages[0].SHA256+".zip")
	if err := os.WriteFile(path, []byte("corrupt"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: t.TempDir(), BootstrapDir: bootstrap}); err == nil {
		t.Fatal("accepted corrupt package")
	}
}

func TestFailedTimetableRefreshKeepsActiveGeneration(t *testing.T) {
	bootstrap := t.TempDir()
	want := writeTestTimetable(t, bootstrap, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), []byte("sqlite fixture"))
	fetcher := &fakeFetcher{err: errors.New("upstream down")}
	service, err := NewService(Config{
		Fetcher: fetcher, DataDir: t.TempDir(), BootstrapDir: bootstrap,
		CompilerPath: filepath.Join(t.TempDir(), "compiler.py"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RefreshTimetable(context.Background()); err == nil {
		t.Fatal("refresh unexpectedly succeeded")
	}
	got, _, err := service.Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if got.Packages[0].SHA256 != want.Packages[0].SHA256 {
		t.Fatalf("active package changed after failure: %+v", got.Packages[0])
	}
}

func TestTimetableRefreshPublishesOnlyCompleteCompilerOutput(t *testing.T) {
	bootstrap := t.TempDir()
	old := writeTestTimetable(t, bootstrap, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), []byte("old database"))
	dataDir := t.TempDir()
	compiler := filepath.Join(t.TempDir(), "compiler.py")
	script := `
import gzip, hashlib, json, pathlib, sys, zipfile
args = dict(zip(sys.argv[1::2], sys.argv[2::2]))
out = pathlib.Path(args['--output-dir'])
out.mkdir(parents=True, exist_ok=True)
draft = out / 'draft.zip'
with zipfile.ZipFile(draft, 'w') as archive:
    archive.writestr('timetable.sqlite3', b'new database')
body = draft.read_bytes()
digest = hashlib.sha256(body).hexdigest()
package = out / ('timetable-' + digest + '.zip')
draft.replace(package)
index = gzip.compress(b'sydneytrains\tlate\t90600\t20260901\t20261031\t127\t\t\n', mtime=0)
index_digest = hashlib.sha256(index).hexdigest()
index_name = 'trip-index-' + index_digest + '.tsv.gz'
(out / index_name).write_bytes(index)
manifest = {'schemaVersion': 1, 'generatedAt': '2026-09-06T02:00:00Z',
 'expiresAt': '2026-10-06T23:59:59+11:00', 'serviceDateFrom': '20260906',
 'serviceDateTo': '20261006', 'packages': [{'source': 'network', 'schemaVersion': 1,
 'sha256': digest, 'url': '/api/v1/timetable/packages/' + digest + '.zip',
 'bytes': len(body), 'serviceDateFrom': '20260906', 'serviceDateTo': '20261006'}],
 'tripIndex': {'name': index_name, 'sha256': index_digest}}
(out / 'manifest.json').write_text(json.dumps(manifest))
`
	if err := os.WriteFile(compiler, []byte(script), 0o644); err != nil {
		t.Fatal(err)
	}
	service, err := NewService(Config{
		Fetcher: scheduleFetcher{body: gtfsZipFixture(t)}, DataDir: dataDir,
		BootstrapDir: bootstrap, CompilerPath: compiler,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := service.RefreshTimetable(context.Background()); err != nil {
		t.Fatal(err)
	}
	current, _, err := service.Manifest()
	if err != nil {
		t.Fatal(err)
	}
	if current.Packages[0].SHA256 == old.Packages[0].SHA256 {
		t.Fatal("active generation did not switch")
	}
	if _, ok := service.PackagePath(old.Packages[0].SHA256); !ok {
		t.Fatal("old immutable generation was discarded")
	}
	if _, ok := service.PackagePath(current.Packages[0].SHA256); !ok {
		t.Fatal("new immutable generation is unavailable")
	}
	for _, source := range Sources {
		if _, err := os.Stat(filepath.Join(dataDir, "feeds", source+".zip")); err != nil {
			t.Fatalf("cached %s: %v", source, err)
		}
	}
	if _, err := os.Stat(filepath.Join(dataDir, "packages", current.TripIndex.Name)); err != nil {
		t.Fatalf("published trip index: %v", err)
	}
	if service.timetable.serviceDates().Len() != 1 {
		t.Fatal("the compiled trip index was not activated with its manifest")
	}
}

func TestBootstrapTripIndexResolvesDatelessUpdates(t *testing.T) {
	bootstrap := t.TempDir()
	writeTestTimetable(t, bootstrap, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), []byte("sqlite fixture"))
	index := writeTestTripIndex(t, bootstrap, []string{"sydneytrains\tlate\t90600\t20260901\t20261031\t127\t\t"})
	declareTripIndex(t, filepath.Join(bootstrap, "manifest.json"), &index)
	service, err := NewService(Config{Fetcher: &fakeFetcher{}, DataDir: t.TempDir(), BootstrapDir: bootstrap})
	if err != nil {
		t.Fatal(err)
	}
	date, outcome := service.timetable.serviceDates().resolve("sydneytrains", "late", sydneyTime(t, 2026, time.September, 6, 1, 33), time.Time{})
	if outcome != dateResolved || date != "20260905" {
		t.Fatalf("resolve = %q/%d", date, outcome)
	}
}

func TestMissingTripIndexLeavesTheTimetableUsable(t *testing.T) {
	bootstrap := t.TempDir()
	writeTestTimetable(t, bootstrap, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC), []byte("sqlite fixture"))
	index := writeTestTripIndex(t, bootstrap, []string{"sydneytrains\tlate\t90600\t20260901\t20261031\t127\t\t"})
	declareTripIndex(t, filepath.Join(bootstrap, "manifest.json"), &index)
	if err := os.Remove(filepath.Join(bootstrap, index.Name)); err != nil {
		t.Fatal(err)
	}
	var logged []string
	service, err := NewService(Config{
		Fetcher: &fakeFetcher{}, DataDir: t.TempDir(), BootstrapDir: bootstrap,
		Logf: func(format string, args ...any) { logged = append(logged, fmt.Sprintf(format, args...)) },
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.Manifest(); err != nil {
		t.Fatal(err)
	}
	if service.timetable.serviceDates().Len() != 0 {
		t.Fatal("a missing trip index produced entries")
	}
	if len(logged) != 1 || !strings.Contains(logged[0], index.Name) {
		t.Fatalf("log = %v", logged)
	}
}

func declareTripIndex(t *testing.T, path string, index *TripIndex) {
	t.Helper()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var manifest Manifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		t.Fatal(err)
	}
	manifest.TripIndex = index
	document, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, document, 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestWithoutAPIKeyRemovesOnlyCredential(t *testing.T) {
	got := withoutAPIKey([]string{"PATH=/bin", "TFNSW_API_KEY=secret", "TFNSW_API_KEY_BACKUP=keep"})
	if len(got) != 2 || got[0] != "PATH=/bin" || got[1] != "TFNSW_API_KEY_BACKUP=keep" {
		t.Fatalf("environment = %v", got)
	}
}
