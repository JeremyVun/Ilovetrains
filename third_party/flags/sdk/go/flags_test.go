package flags

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"sync"
	"testing"
	"time"

	core "github.com/JeremyVun/flags/server/pkg/flags"
)

// --- test helpers -------------------------------------------------------------

// newTestClient builds a Client WITHOUT starting the real sync loop, suitable
// for directly seeding snapshots in unit tests (no network).
func newTestClient(t *testing.T, cfg Config) *Client {
	t.Helper()
	if cfg.ServiceURL == "" {
		cfg.ServiceURL = "http://test.invalid"
	}
	if cfg.Key == "" {
		cfg.Key = "ffk_test"
	}
	if cfg.Project == "" {
		cfg.Project = "p"
	}
	if cfg.Environment == "" {
		cfg.Environment = "production"
	}
	if cfg.User == "" {
		cfg.User = "svc:test"
	}
	if cfg.Application == "" {
		cfg.Application = "test-app"
	}
	ctx, cancel := context.WithCancel(context.Background())
	c := &Client{
		cfg:    cfg,
		logger: cfg.Logger,
		ready:  make(chan struct{}),
		ctx:    ctx,
		cancel: cancel,
	}
	if c.logger == nil {
		c.logger = newDiscardLogger()
	}
	t.Cleanup(func() { cancel() })
	return c
}

var defaultTestLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func newDiscardLogger() *slog.Logger { return defaultTestLogger }

// seed applies a snapshot synchronously (marks ready + fresh).
func (c *Client) seed(snap *core.FlagsSnapshot) { c.applySnapshot(snap) }

func rawJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func boolFlag(key string, enabled bool, fallthroughVar string) core.Flag {
	return core.Flag{
		Key:        key,
		Type:       core.TypeBoolean,
		Variations: []core.Variation{{Key: "off", Value: rawJSON(false)}, {Key: "on", Value: rawJSON(true)}},
		Enabled:    enabled, OffVariation: "off",
		Fallthrough: core.Outcome{Variation: fallthroughVar},
	}
}

func stringFlag(key, val string) core.Flag {
	return core.Flag{
		Key:  key,
		Type: core.TypeString,
		Variations: []core.Variation{
			{Key: "v", Value: rawJSON(val)},
		},
		Enabled: true, OffVariation: "v",
		Fallthrough: core.Outcome{Variation: "v"},
	}
}

func numberFlag(key string, val float64) core.Flag {
	return core.Flag{
		Key:        key,
		Type:       core.TypeNumber,
		Variations: []core.Variation{{Key: "v", Value: rawJSON(val)}},
		Enabled:    true, OffVariation: "v",
		Fallthrough: core.Outcome{Variation: "v"},
	}
}

func jsonFlag(key string, val any) core.Flag {
	return core.Flag{
		Key:        key,
		Type:       core.TypeJSON,
		Variations: []core.Variation{{Key: "v", Value: rawJSON(val)}},
		Enabled:    true, OffVariation: "v",
		Fallthrough: core.Outcome{Variation: "v"},
	}
}

func snapshot(version string, flags ...core.Flag) *core.FlagsSnapshot {
	return &core.FlagsSnapshot{
		Version: version, Project: "p", Environment: "production", Flags: flags,
	}
}

// --- config validation --------------------------------------------------------

func TestNewClientValidation(t *testing.T) {
	// A fully-valid config that individual cases blank one field at a time from.
	valid := Config{
		ServiceURL:  "http://test.invalid:1",
		Key:         "ffk_x",
		Project:     "p",
		Environment: "production",
		User:        "svc:test",
		Application: "test-app",
		Logger:      newDiscardLogger(),
	}
	cases := []struct {
		name  string
		mutex func(c *Config)
	}{
		{"missing ServiceURL", func(c *Config) { c.ServiceURL = "" }},
		{"missing Key", func(c *Config) { c.Key = "" }},
		{"missing Project", func(c *Config) { c.Project = "" }},
		{"missing Environment", func(c *Config) { c.Environment = "" }},
	}
	for _, tc := range cases {
		cfg := valid
		tc.mutex(&cfg)
		if _, err := NewClient(cfg); err == nil {
			t.Errorf("%s: expected error", tc.name)
		}
	}

	c, err := NewClient(valid)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// NewClient must NOT block on the service being up; Close cancels sync.
	_ = c.Close()
	_ = c.Close() // idempotent
}

func TestDefaultsApplied(t *testing.T) {
	c, err := NewClient(Config{
		ServiceURL:  "http://test.invalid",
		Key:         "ffk_x",
		Project:     "p",
		Environment: "production",
		User:        "svc:test",
		Application: "test-app",
		Logger:      newDiscardLogger(),
	})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	if c.cfg.ConnectTimeout != defaultConnectTimeout {
		t.Errorf("ConnectTimeout default = %v", c.cfg.ConnectTimeout)
	}
	if c.cfg.ReconnectMaxBackoff != defaultReconnectMaxBackoff {
		t.Errorf("ReconnectMaxBackoff default = %v", c.cfg.ReconnectMaxBackoff)
	}
}

// --- typed accessors: happy path ----------------------------------------------

func TestBoolVariation(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1", boolFlag("f", true, "on")))
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, false); got != true {
		t.Errorf("BoolVariation = %v want true", got)
	}
	d := c.BoolVariationDetail("f", EvalContext{Key: "u"}, false)
	if d.Reason != core.ReasonFallthrough || d.Variation != "on" || d.Value != true {
		t.Errorf("detail = %+v", d)
	}
}

func TestStringVariation(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1", stringFlag("col", "green")))
	if got := c.StringVariation("col", EvalContext{Key: "u"}, "red"); got != "green" {
		t.Errorf("StringVariation = %q", got)
	}
}

func TestIntVariation(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1", numberFlag("lim", 42)))
	if got := c.IntVariation("lim", EvalContext{Key: "u"}, 0); got != 42 {
		t.Errorf("IntVariation = %d", got)
	}
	d := c.IntVariationDetail("lim", EvalContext{Key: "u"}, 0)
	if d.Value != 42 {
		t.Errorf("IntVariationDetail value = %v (%T)", d.Value, d.Value)
	}
}

func TestFloatVariation(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1", numberFlag("rate", 1.5)))
	if got := c.FloatVariation("rate", EvalContext{Key: "u"}, 0); got != 1.5 {
		t.Errorf("FloatVariation = %v", got)
	}
}

func TestJSONVariation(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1", jsonFlag("cfg", map[string]any{"a": 1.0})))
	got := c.JSONVariation("cfg", EvalContext{Key: "u"}, json.RawMessage(`{}`))
	var m map[string]any
	if err := json.Unmarshal(got, &m); err != nil {
		t.Fatal(err)
	}
	if m["a"] != 1.0 {
		t.Errorf("JSONVariation = %s", got)
	}
}

// --- defaults: unknown flag / wrong type / unready ----------------------------

func TestUnknownFlagReturnsDefault(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1"))
	if got := c.BoolVariation("nope", EvalContext{Key: "u"}, true); got != true {
		t.Errorf("unknown flag bool = %v want default true", got)
	}
	if got := c.StringVariation("nope", EvalContext{Key: "u"}, "def"); got != "def" {
		t.Errorf("unknown flag string = %q", got)
	}
}

// An unknown flag on a READY, FRESH snapshot is FLAG_NOT_FOUND (ERROR), which
// must return the caller default regardless of FailMode — FailMode is reserved
// for unready/stale only (CONTRACT §4.1/§4.3/§8).
func TestUnknownFlagReturnsDefaultUnderFailOpen(t *testing.T) {
	c := newTestClient(t, Config{FailMode: FailOpen})
	c.seed(snapshot("v1")) // ready + fresh, but empty
	if got := c.BoolVariation("nope", EvalContext{Key: "u"}, false); got != false {
		t.Errorf("FailOpen unknown-flag-while-ready bool = %v want caller default false", got)
	}
	d := c.BoolVariationDetail("nope", EvalContext{Key: "u"}, false)
	if d.Reason != core.ReasonError || d.ErrorKind != core.ErrFlagNotFound {
		t.Errorf("unknown flag detail = {%q,%q} want {ERROR,FLAG_NOT_FOUND}", d.Reason, d.ErrorKind)
	}
}

func TestUnknownFlagReturnsDefaultUnderFailClosed(t *testing.T) {
	c := newTestClient(t, Config{FailMode: FailClosed})
	c.seed(snapshot("v1"))
	if got := c.BoolVariation("nope", EvalContext{Key: "u"}, true); got != true {
		t.Errorf("FailClosed unknown-flag-while-ready bool = %v want caller default true", got)
	}
}

func TestWrongTypeReturnsDefault(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1", boolFlag("f", true, "on")))
	// Ask for a string on a boolean flag -> WRONG_TYPE -> default.
	if got := c.StringVariation("f", EvalContext{Key: "u"}, "def"); got != "def" {
		t.Errorf("wrong-type string = %q want def", got)
	}
	d := c.StringVariationDetail("f", EvalContext{Key: "u"}, "def")
	if d.Reason != core.ReasonError {
		t.Errorf("wrong-type detail reason = %q", d.Reason)
	}
}

func TestUnreadyReturnsDefault(t *testing.T) {
	c := newTestClient(t, Config{}) // never seeded
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, true); got != true {
		t.Errorf("unready bool = %v want default true", got)
	}
	if got := c.IntVariation("f", EvalContext{Key: "u"}, 99); got != 99 {
		t.Errorf("unready int = %d", got)
	}
}

// --- FailMode for bool when unready/stale -------------------------------------

func TestFailOpenWhenUnready(t *testing.T) {
	c := newTestClient(t, Config{FailMode: FailOpen})
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, false); got != true {
		t.Errorf("FailOpen unready = %v want true", got)
	}
	// Non-bool accessors still return caller default under FailOpen.
	if got := c.StringVariation("f", EvalContext{Key: "u"}, "def"); got != "def" {
		t.Errorf("FailOpen string = %q want def", got)
	}
}

func TestFailClosedWhenUnready(t *testing.T) {
	c := newTestClient(t, Config{FailMode: FailClosed})
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, true); got != false {
		t.Errorf("FailClosed unready = %v want false", got)
	}
}

func TestStaleAppliesFailMode(t *testing.T) {
	c := newTestClient(t, Config{StaleThreshold: time.Millisecond, FailMode: FailClosed})
	c.seed(snapshot("v1", boolFlag("f", true, "on")))
	// Backdate lastSync so it's stale.
	c.lastSync.Store(time.Now().Add(-time.Hour).UnixNano())
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, true); got != false {
		t.Errorf("stale FailClosed = %v want false", got)
	}
}

func TestNotStaleWithinThreshold(t *testing.T) {
	c := newTestClient(t, Config{StaleThreshold: time.Hour, FailMode: FailClosed})
	c.seed(snapshot("v1", boolFlag("f", true, "on")))
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, false); got != true {
		t.Errorf("fresh within threshold = %v want true (normal eval)", got)
	}
}

// --- Detail reasons -----------------------------------------------------------

func TestDetailReasons(t *testing.T) {
	off := boolFlag("off", false, "on") // disabled -> OFF
	target := boolFlag("tgt", true, "off")
	target.Targets = []core.Target{{Variation: "on", Keys: []string{"vip"}}}
	rule := boolFlag("rule", true, "off")
	rule.Rules = []core.Rule{{
		Clauses: []core.Clause{{Attribute: "country", Operator: core.OpEq, Values: []json.RawMessage{rawJSON("NZ")}}},
		Outcome: core.Outcome{Variation: "on"},
	}}

	c := newTestClient(t, Config{})
	c.seed(snapshot("v1", off, target, rule))

	if d := c.BoolVariationDetail("off", EvalContext{Key: "u"}, true); d.Reason != core.ReasonOff {
		t.Errorf("off reason = %q", d.Reason)
	}
	if d := c.BoolVariationDetail("tgt", EvalContext{Key: "vip"}, false); d.Reason != core.ReasonTargetMatch || d.Value != true {
		t.Errorf("target detail = %+v", d)
	}
	d := c.BoolVariationDetail("rule", EvalContext{Key: "u", Attributes: map[string]any{"country": "NZ"}}, false)
	if d.Reason != core.ReasonRuleMatch || d.RuleIndex == nil || *d.RuleIndex != 0 {
		t.Errorf("rule detail = %+v", d)
	}
}

// --- AllFlags -----------------------------------------------------------------

func TestAllFlags(t *testing.T) {
	c := newTestClient(t, Config{})
	c.seed(snapshot("v1",
		boolFlag("b", true, "on"),
		stringFlag("s", "hi"),
		numberFlag("n", 7),
	))
	all := c.AllFlags(EvalContext{Key: "u"})
	want := map[string]any{"b": true, "s": "hi", "n": 7.0}
	if !reflect.DeepEqual(all, want) {
		t.Errorf("AllFlags = %#v want %#v", all, want)
	}
}

func TestAllFlagsUnready(t *testing.T) {
	c := newTestClient(t, Config{})
	if got := c.AllFlags(EvalContext{Key: "u"}); len(got) != 0 {
		t.Errorf("AllFlags unready = %#v want empty", got)
	}
}

// --- Version ------------------------------------------------------------------

func TestVersion(t *testing.T) {
	c := newTestClient(t, Config{})
	if got := c.Version(); got != "" {
		t.Errorf("Version before sync = %q want empty", got)
	}
	c.seed(snapshot("abc123", boolFlag("f", true, "on")))
	if got := c.Version(); got != "abc123" {
		t.Errorf("Version = %q", got)
	}
}

// --- OnChange diff ------------------------------------------------------------

func TestOnChangeFiresWithChangedKeys(t *testing.T) {
	c := newTestClient(t, Config{})

	var mu sync.Mutex
	var got []string
	done := make(chan struct{}, 1)
	c.OnChange(func(changed []string) {
		mu.Lock()
		got = changed
		mu.Unlock()
		select {
		case done <- struct{}{}:
		default:
		}
	})

	// First snapshot: all keys are "changed" (old was nil).
	c.seed(snapshot("v1", boolFlag("a", true, "on"), boolFlag("b", true, "on")))
	waitFor(t, done)
	mu.Lock()
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"a", "b"}) {
		mu.Unlock()
		t.Fatalf("first OnChange keys = %v", got)
	}
	mu.Unlock()

	// Change only flag "b" (enabled flips), add "c", keep "a" identical.
	c.seed(snapshot("v2", boolFlag("a", true, "on"), boolFlag("b", false, "on"), boolFlag("c", true, "on")))
	waitFor(t, done)
	mu.Lock()
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"b", "c"}) {
		mu.Unlock()
		t.Fatalf("second OnChange keys = %v want [b c]", got)
	}
	mu.Unlock()
}

func TestOnChangeSkippedWhenVersionUnchanged(t *testing.T) {
	c := newTestClient(t, Config{})
	fired := make(chan struct{}, 4)
	c.OnChange(func([]string) { fired <- struct{}{} })

	c.seed(snapshot("v1", boolFlag("a", true, "on")))
	waitFor(t, fired)
	// Same version -> no callback.
	c.seed(snapshot("v1", boolFlag("a", false, "on")))
	select {
	case <-fired:
		t.Fatal("OnChange fired for identical version")
	case <-time.After(100 * time.Millisecond):
	}
}

func TestDiffKeysRemoval(t *testing.T) {
	old := snapshot("v1", boolFlag("a", true, "on"), boolFlag("b", true, "on"))
	neu := snapshot("v2", boolFlag("a", true, "on"))
	got := diffKeys(old, neu)
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"b"}) {
		t.Errorf("diffKeys removal = %v want [b]", got)
	}
}

// --- WaitReady ----------------------------------------------------------------

func TestWaitReady(t *testing.T) {
	c := newTestClient(t, Config{})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if err := c.WaitReady(ctx); err == nil {
		t.Error("WaitReady should time out before sync")
	}

	go func() {
		time.Sleep(10 * time.Millisecond)
		c.seed(snapshot("v1", boolFlag("f", true, "on")))
	}()
	ctx2, cancel2 := context.WithTimeout(context.Background(), time.Second)
	defer cancel2()
	if err := c.WaitReady(ctx2); err != nil {
		t.Errorf("WaitReady after seed = %v", err)
	}
}

// --- LocalCachePath -----------------------------------------------------------

func TestLocalCacheWarmStart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "cache.json")

	// Persist a snapshot.
	snap := snapshot("warm1", boolFlag("f", true, "on"))
	if err := saveSnapshot(path, snap); err != nil {
		t.Fatal(err)
	}

	// Loading it should reproduce content.
	loaded, err := loadSnapshot(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded == nil || loaded.Version != "warm1" || len(loaded.Flags) != 1 {
		t.Fatalf("loaded = %+v", loaded)
	}

	// A Client created with this path loads the warm cache before any sync, so
	// it can serve immediately (but is not "ready" until a network sync).
	c := newTestClient(t, Config{LocalCachePath: path})
	if s, _ := loadSnapshot(path); s != nil {
		c.snap.Store(s)
	}
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, false); got != true {
		t.Errorf("warm-cache bool = %v want true", got)
	}
}

func TestLoadSnapshotMissingFile(t *testing.T) {
	snap, err := loadSnapshot(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Errorf("missing file err = %v want nil", err)
	}
	if snap != nil {
		t.Errorf("missing file snap = %+v want nil", snap)
	}
}

func TestSaveSnapshotAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "c.json")
	if err := saveSnapshot(path, snapshot("v1")); err != nil {
		t.Fatal(err)
	}
	// No leftover temp files.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() != "c.json" {
			t.Errorf("leftover file: %s", e.Name())
		}
	}
}

// --- helpers ------------------------------------------------------------------

func waitFor(t *testing.T, ch <-chan struct{}) {
	t.Helper()
	select {
	case <-ch:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for callback")
	}
}
