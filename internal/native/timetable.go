package native

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultTimetableInterval = 24 * time.Hour
	scheduleFetchTimeout     = 2 * time.Minute
	compilerTimeout          = 10 * time.Minute
)

var shaPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

type activeTimetable struct {
	manifest       Manifest
	representation Representation
}

type timetableStore struct {
	mu           sync.RWMutex
	refreshMu    sync.Mutex
	active       *activeTimetable
	packages     map[string]string
	fetcher      FeedFetcher
	now          func() time.Time
	dataDir      string
	bootstrapDir string
	compilerPath string
	interval     time.Duration
	logf         func(string, ...any)
}

func newTimetableStore(config Config) (*timetableStore, error) {
	interval := config.TimetableInterval
	if interval <= 0 {
		interval = defaultTimetableInterval
	}
	store := &timetableStore{
		packages: make(map[string]string), fetcher: config.Fetcher, now: config.Now,
		dataDir: config.DataDir, bootstrapDir: config.BootstrapDir,
		compilerPath: config.CompilerPath, interval: interval,
		logf: config.Logf,
	}
	if store.dataDir != "" {
		if err := os.MkdirAll(filepath.Join(store.dataDir, "packages"), 0o755); err != nil {
			return nil, fmt.Errorf("native timetable: create data directory: %w", err)
		}
		store.discoverPackages(filepath.Join(store.dataDir, "packages"))
	}
	candidates := []string{}
	if store.bootstrapDir != "" {
		candidates = append(candidates, filepath.Join(store.bootstrapDir, "manifest.json"))
		store.discoverPackages(store.bootstrapDir)
	}
	if store.dataDir != "" {
		candidates = append(candidates, filepath.Join(store.dataDir, "current.json"))
	}
	for _, path := range candidates {
		active, packagePath, err := loadManifest(path, store.packageCandidates(filepath.Dir(path)))
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return nil, err
		}
		if store.active == nil || active.manifest.GeneratedAt.After(store.active.manifest.GeneratedAt) {
			store.active = active
		}
		store.packages[active.manifest.Packages[0].SHA256] = packagePath
	}
	return store, nil
}

func (s *timetableStore) packageCandidates(manifestDir string) []string {
	result := []string{manifestDir}
	if s.dataDir != "" {
		result = append(result, filepath.Join(s.dataDir, "packages"))
	}
	if s.bootstrapDir != "" {
		result = append(result, s.bootstrapDir)
	}
	return result
}

func (s *timetableStore) discoverPackages(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, entry := range entries {
		name := entry.Name()
		if entry.Type().IsRegular() && strings.HasSuffix(name, ".zip") {
			hash := strings.TrimPrefix(strings.TrimSuffix(name, ".zip"), "timetable-")
			if shaPattern.MatchString(hash) {
				s.packages[hash] = filepath.Join(dir, name)
			}
		}
	}
}

func (s *timetableStore) manifest() (Manifest, Representation, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if s.active == nil {
		return Manifest{}, Representation{}, ErrUnavailable
	}
	return s.active.manifest, s.active.representation, nil
}

func (s *timetableStore) packagePath(hash string) (string, bool) {
	if !shaPattern.MatchString(hash) {
		return "", false
	}
	s.mu.RLock()
	path, ok := s.packages[hash]
	s.mu.RUnlock()
	return path, ok
}

func (s *timetableStore) run(ctx context.Context) {
	for {
		delay := time.Duration(0)
		if manifest, _, err := s.manifest(); err == nil {
			delay = manifest.GeneratedAt.Add(s.interval).Sub(s.now())
			if delay < 0 {
				delay = 0
			}
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		if err := s.refresh(ctx); err != nil && s.logf != nil {
			s.logf("native timetable refresh: %v", err)
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(s.interval):
		}
	}
}

func (s *timetableStore) refresh(ctx context.Context) error {
	s.refreshMu.Lock()
	defer s.refreshMu.Unlock()
	if s.dataDir == "" || s.compilerPath == "" {
		return errors.New("native timetable refresh is not configured")
	}
	workDir, err := os.MkdirTemp(s.dataDir, ".refresh-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(workDir)
	inputDir, outputDir := filepath.Join(workDir, "input"), filepath.Join(workDir, "output")
	if err := os.MkdirAll(inputDir, 0o755); err != nil {
		return err
	}
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return err
	}

	conditions, _ := readConditions(filepath.Join(s.dataDir, "feed-conditions.json"))
	nextConditions := make(map[string]Conditional, len(Sources))
	captures := make([]map[string]string, 0, len(Sources))
	for _, source := range Sources {
		fetchCtx, cancel := context.WithTimeout(ctx, scheduleFetchTimeout)
		result, fetchErr := s.fetcher.FetchSchedule(fetchCtx, source, conditions[source])
		cancel()
		if fetchErr != nil {
			return fmt.Errorf("download %s: %w", source, fetchErr)
		}
		target := filepath.Join(inputDir, source+".zip")
		if result.NotModified {
			if err := copyFile(filepath.Join(s.dataDir, "feeds", source+".zip"), target); err != nil {
				return fmt.Errorf("reuse %s: %w", source, err)
			}
		} else {
			if err := os.WriteFile(target, result.Body, 0o644); err != nil {
				return err
			}
			if err := validateGTFSZip(target); err != nil {
				return fmt.Errorf("validate %s: %w", source, err)
			}
		}
		nextConditions[source] = Conditional{ETag: result.ETag, LastModified: result.LastModified}
		if result.NotModified {
			nextConditions[source] = conditions[source]
		}
		captures = append(captures, map[string]string{
			"file": source + ".zip", "receivedAt": s.now().UTC().Format(time.RFC3339Nano),
		})
	}
	captureDocument, err := json.Marshal(captures)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(inputDir, "capture.json"), append(captureDocument, '\n'), 0o644); err != nil {
		return err
	}

	compileCtx, cancel := context.WithTimeout(ctx, compilerTimeout)
	defer cancel()
	command := exec.CommandContext(compileCtx, "python3", s.compilerPath,
		"--input-dir", inputDir, "--output-dir", outputDir)
	command.Env = withoutAPIKey(os.Environ())
	if output, err := command.CombinedOutput(); err != nil {
		if len(output) > 4096 {
			output = output[len(output)-4096:]
		}
		return fmt.Errorf("compile timetable: %w: %s", err, strings.TrimSpace(string(output)))
	}
	active, packagePath, err := loadManifest(filepath.Join(outputDir, "manifest.json"), []string{outputDir})
	if err != nil {
		return err
	}
	hash := active.manifest.Packages[0].SHA256
	finalPackage := filepath.Join(s.dataDir, "packages", hash+".zip")
	if _, err := os.Stat(finalPackage); errors.Is(err, os.ErrNotExist) {
		if err := os.Rename(packagePath, finalPackage); err != nil {
			return fmt.Errorf("publish timetable package: %w", err)
		}
	} else if err != nil {
		return err
	}
	if err := promoteFeeds(inputDir, filepath.Join(s.dataDir, "feeds")); err != nil {
		return err
	}
	if err := writeConditions(filepath.Join(s.dataDir, "feed-conditions.json"), nextConditions); err != nil {
		return err
	}
	if err := writeAtomic(filepath.Join(s.dataDir, "current.json"), active.representation.JSON); err != nil {
		return fmt.Errorf("publish timetable manifest: %w", err)
	}
	s.mu.Lock()
	s.active = active
	s.packages[hash] = finalPackage
	s.mu.Unlock()
	return nil
}

func loadManifest(path string, packageDirs []string) (*activeTimetable, string, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return nil, "", err
	}
	var manifest Manifest
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&manifest); err != nil {
		return nil, "", fmt.Errorf("native timetable: decode %s: %w", path, err)
	}
	if err := validateManifest(manifest); err != nil {
		return nil, "", fmt.Errorf("native timetable: %s: %w", path, err)
	}
	pkg := manifest.Packages[0]
	var packagePath string
	for _, dir := range packageDirs {
		for _, name := range []string{pkg.SHA256 + ".zip", "timetable-" + pkg.SHA256 + ".zip"} {
			candidate := filepath.Join(dir, name)
			if _, err := os.Stat(candidate); err == nil {
				packagePath = candidate
				break
			}
		}
		if packagePath != "" {
			break
		}
	}
	if packagePath == "" {
		return nil, "", fmt.Errorf("native timetable: package %s is missing", pkg.SHA256)
	}
	if err := validatePackage(packagePath, pkg); err != nil {
		return nil, "", err
	}
	canonical, err := json.Marshal(manifest)
	if err != nil {
		return nil, "", err
	}
	canonical = append(canonical, '\n')
	sum := sha256.Sum256(canonical)
	return &activeTimetable{manifest: manifest, representation: Representation{
		JSON: canonical, ETag: `"` + hex.EncodeToString(sum[:]) + `"`,
	}}, packagePath, nil
}

func validateManifest(manifest Manifest) error {
	if manifest.SchemaVersion != SchemaVersion || len(manifest.Packages) != 1 {
		return errors.New("unsupported timetable manifest")
	}
	if manifest.GeneratedAt.IsZero() || manifest.ExpiresAt.IsZero() || !manifest.GeneratedAt.Before(manifest.ExpiresAt) {
		return errors.New("invalid timetable timestamps")
	}
	if !validDateRange(manifest.ServiceDateFrom, manifest.ServiceDateTo) {
		return errors.New("invalid timetable coverage")
	}
	pkg := manifest.Packages[0]
	if pkg.Source != "network" || pkg.SchemaVersion != SchemaVersion || !shaPattern.MatchString(pkg.SHA256) || pkg.Bytes <= 0 {
		return errors.New("invalid timetable package")
	}
	if pkg.URL != "/api/v1/timetable/packages/"+pkg.SHA256+".zip" {
		return errors.New("timetable package URL does not match its hash")
	}
	if pkg.ServiceDateFrom != manifest.ServiceDateFrom || pkg.ServiceDateTo != manifest.ServiceDateTo {
		return errors.New("timetable package coverage does not match manifest")
	}
	return nil
}

func validatePackage(path string, pkg TimetablePackage) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.Size() != pkg.Bytes {
		return errors.New("native timetable: package byte count mismatch")
	}
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != pkg.SHA256 {
		return errors.New("native timetable: package hash mismatch")
	}
	reader, err := zip.OpenReader(path)
	if err != nil {
		return errors.New("native timetable: package is not a ZIP")
	}
	defer reader.Close()
	if len(reader.File) != 1 || reader.File[0].Name != "timetable.sqlite3" || reader.File[0].FileInfo().IsDir() {
		return errors.New("native timetable: package must contain only timetable.sqlite3")
	}
	return nil
}

func validateGTFSZip(path string) error {
	reader, err := zip.OpenReader(path)
	if err != nil {
		return errors.New("not a ZIP file")
	}
	defer reader.Close()
	required := map[string]bool{"stops.txt": false, "routes.txt": false, "trips.txt": false, "stop_times.txt": false}
	for _, file := range reader.File {
		if _, ok := required[file.Name]; ok {
			required[file.Name] = true
		}
	}
	for name, found := range required {
		if !found {
			return fmt.Errorf("missing %s", name)
		}
	}
	return nil
}

func validDateRange(from, to string) bool {
	start, err := time.Parse("20060102", from)
	if err != nil {
		return false
	}
	end, err := time.Parse("20060102", to)
	return err == nil && !end.Before(start)
}

func copyFile(source, target string) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

func promoteFeeds(inputDir, targetDir string) error {
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		return err
	}
	for _, source := range Sources {
		input := filepath.Join(inputDir, source+".zip")
		payload, err := os.ReadFile(input)
		if err != nil {
			return err
		}
		if err := writeAtomic(filepath.Join(targetDir, source+".zip"), payload); err != nil {
			return err
		}
	}
	return nil
}

func readConditions(path string) (map[string]Conditional, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return map[string]Conditional{}, err
	}
	result := map[string]Conditional{}
	err = json.Unmarshal(payload, &result)
	return result, err
}

func writeConditions(path string, conditions map[string]Conditional) error {
	payload, err := json.Marshal(conditions)
	if err != nil {
		return err
	}
	return writeAtomic(path, append(payload, '\n'))
}

func writeAtomic(path string, payload []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".publish-")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)
	if err := temp.Chmod(0o644); err != nil {
		temp.Close()
		return err
	}
	if _, err := temp.Write(payload); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

func withoutAPIKey(environment []string) []string {
	result := make([]string, 0, len(environment))
	for _, item := range environment {
		if !strings.HasPrefix(item, "TFNSW_API_KEY=") {
			result = append(result, item)
		}
	}
	sort.Strings(result)
	return result
}

func (s *Service) Manifest() (Manifest, Representation, error) {
	return s.timetable.manifest()
}

func (s *Service) PackagePath(hash string) (string, bool) {
	return s.timetable.packagePath(hash)
}

func (s *Service) RefreshTimetable(ctx context.Context) error {
	return s.timetable.refresh(ctx)
}
