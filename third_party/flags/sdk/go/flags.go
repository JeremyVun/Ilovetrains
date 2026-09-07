// Package flags is the REFERENCE Go SDK for the flagsd service
// (CONTRACT.md §8). It builds directly on the shared evaluation core
// (github.com/JeremyVun/flags/server/pkg/flags): it does NOT reimplement evaluation or
// bucketing — it imports the core and calls core.Evaluate. The same EvalContext
// and EvaluationDetail types flow straight into the core via type aliases.
//
// A Client manages an SSE connection to the service's raw-snapshot plane
// (GET /v1/projects/{project}/environments/{environment}/snapshot/stream), keeps
// an atomically-swapped snapshot of the merged ruleset, evaluates flags locally,
// and serves last-known-good through outages with configurable fail policy.
//
// CONTRACT.md is normative; every exported symbol here mirrors §8.
package flags

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	core "github.com/JeremyVun/flags/server/pkg/flags"
)

// EvalContext is the single evaluation context (CONTRACT §2.7 / §8). It is a
// type alias for the shared core type so the SAME value flows into the
// evaluator with no conversion. Key is the stable unit of rollout (also
// addressable as attribute "key"); Attributes is a flat map.
type EvalContext = core.EvalContext

// Detail is the result of a *VariationDetail call (CONTRACT §2.10 / §8). It is a
// type alias for core.EvaluationDetail: {Value, Variation, Reason, RuleIndex,
// ErrorKind}.
type Detail = core.EvaluationDetail

// FailMode controls accessor behaviour when no fresh snapshot is available —
// i.e. the SDK is not yet ready, or the cache has gone stale past
// StaleThreshold (CONTRACT §8). When a fresh snapshot exists FailMode is
// irrelevant: normal evaluation runs and an ERROR reason still yields the
// caller's default.
type FailMode int

// Fail policies (CONTRACT §8). FailDefault is the zero value.
const (
	// FailDefault returns the caller's supplied default for every accessor.
	FailDefault FailMode = iota
	// FailOpen returns true for BoolVariation; other typed accessors still
	// return the caller's default (there is no meaningful "open" string/number).
	FailOpen
	// FailClosed returns false for BoolVariation; other typed accessors still
	// return the caller's default.
	FailClosed
)

// Default configuration values (CONTRACT §8).
const (
	defaultConnectTimeout      = 10 * time.Second
	defaultReconnectMaxBackoff = 30 * time.Second
	initialBackoff             = 1 * time.Second
	// minStableConnection is how long a stream must stay connected (having
	// delivered at least one snapshot) to count as "stable" and reset the
	// reconnect backoff. Shorter-lived connections are treated as flaps so
	// backoff keeps growing per §8, preventing a reconnect storm against a
	// flapping endpoint (e.g. one that returns 200 then drops immediately).
	minStableConnection = 5 * time.Second
)

// Config configures a Client (CONTRACT §8). ServiceURL, Key, Project and
// Environment are required; User and Application are optional read attribution.
type Config struct {
	// ServiceURL is the base URL of the flag service, e.g.
	// "https://flags.internal". Required. The SDK appends the raw-snapshot
	// paths for the configured Project/Environment, i.e.
	// "/v1/projects/{Project}/environments/{Environment}/snapshot/stream" and
	// "/v1/projects/{Project}/environments/{Environment}/snapshot".
	ServiceURL string
	// Key is the opaque, "ffk_"-prefixed API key used as a Bearer token on
	// every request. Required. It is NEVER logged (DESIGN §15). The key MUST
	// carry ONLY the "read" capability — the SDK only reads raw snapshots and
	// evaluates locally; it never mutates server state.
	Key string
	// Project is the project key whose snapshots this client reads. Required;
	// it is a URL path segment, not encoded in Key (CONTRACT §3, §7).
	Project string
	// Environment is the environment key (e.g. "production") within Project
	// whose snapshots this client reads. Required; a URL path segment.
	Environment string
	// User is the optional X-User attribution sent on snapshot reads. For a
	// machine/service SDK consumer this is a STATIC service identity chosen at
	// construction (e.g. "svc:checkout") — it is NOT the per-evaluation end
	// user, which stays local in the EvalContext and is never transmitted.
	User string
	// Application is the optional X-Application attribution sent on snapshot
	// reads. Like User, this is the STATIC calling application (e.g.
	// "checkout-api"), set once at construction, not a per-evaluation value.
	Application string
	// Logger is the structured logger; defaults to slog.Default().
	Logger *slog.Logger
	// ConnectTimeout bounds connection establishment / time-to-first-snapshot per
	// attempt (default 10s): a connect that delivers no snapshot within this
	// window is torn down and retried, but a healthy long-lived stream is NEVER
	// timed out by it. It does NOT block app boot — NewClient returns immediately.
	ConnectTimeout time.Duration
	// ReconnectMaxBackoff caps the exponential reconnect backoff (default 30s).
	ReconnectMaxBackoff time.Duration
	// StaleThreshold, when > 0, marks the cache stale if now-lastSync exceeds
	// it; stale accessors apply FailMode. 0 = never mark stale. NOTE: the timer
	// starts at the first NETWORK sync — a LocalCachePath warm cache that has never
	// network-synced is served as last-known-good and is exempt from StaleThreshold
	// until that first sync, so a server that is unreachable from boot keeps serving
	// the persisted snapshot rather than applying FailMode.
	StaleThreshold time.Duration
	// FailMode is applied when unready or stale (CONTRACT §8).
	FailMode FailMode
	// LocalCachePath, when set, persists the last snapshot (atomic write) for a
	// warm cold-start and loads it as the initial cache before first sync. The
	// persisted snapshot carries no apply-time, so it is exempt from StaleThreshold
	// until the first network sync (see StaleThreshold).
	LocalCachePath string
}

// Client is a flags SDK client (CONTRACT §8). It is safe for concurrent
// use. Create one with NewClient and release it with Close.
type Client struct {
	cfg    Config
	logger *slog.Logger

	// snap holds the current merged snapshot; swapped atomically so readers
	// never see torn state (CONTRACT §8).
	snap atomic.Pointer[core.FlagsSnapshot]

	// lastSync is the UnixNano of the last successful snapshot apply (atomic),
	// 0 if never synced. Used for the stale check (CONTRACT §8).
	lastSync atomic.Int64

	// ready is closed once the first snapshot has been applied. readyOnce
	// guards the close so it happens exactly once.
	ready     chan struct{}
	readyOnce sync.Once

	// ctx/cancel drive the background sync goroutine; cancel on Close.
	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// transport is the HTTP/SSE transport; swappable in tests.
	transport transport

	mu        sync.Mutex // guards callbacks
	callbacks []func([]string)
}

// NewClient validates cfg, loads any warm local cache, starts the background
// sync goroutine, and returns immediately — it NEVER blocks app boot on the
// service being reachable (CONTRACT §8). Until the first successful sync,
// accessors return caller defaults (or FailMode).
func NewClient(cfg Config) (*Client, error) {
	if strings.TrimSpace(cfg.ServiceURL) == "" {
		return nil, errors.New("flags: Config.ServiceURL is required")
	}
	if strings.TrimSpace(cfg.Key) == "" {
		return nil, errors.New("flags: Config.Key is required")
	}
	if strings.TrimSpace(cfg.Project) == "" {
		return nil, errors.New("flags: Config.Project is required")
	}
	if strings.TrimSpace(cfg.Environment) == "" {
		return nil, errors.New("flags: Config.Environment is required")
	}
	// Apply defaults (CONTRACT §8).
	if cfg.ConnectTimeout <= 0 {
		cfg.ConnectTimeout = defaultConnectTimeout
	}
	if cfg.ReconnectMaxBackoff <= 0 {
		cfg.ReconnectMaxBackoff = defaultReconnectMaxBackoff
	}
	cfg.ServiceURL = strings.TrimRight(cfg.ServiceURL, "/")

	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}

	ctx, cancel := context.WithCancel(context.Background())
	c := &Client{
		cfg:       cfg,
		logger:    logger,
		ready:     make(chan struct{}),
		ctx:       ctx,
		cancel:    cancel,
		transport: newHTTPTransport(cfg),
	}

	// Warm cold-start: load the persisted snapshot as the initial cache before
	// the first network sync (CONTRACT §8). This does NOT signal ready — only a
	// successful network sync closes the ready channel.
	if cfg.LocalCachePath != "" {
		if snap, err := loadSnapshot(cfg.LocalCachePath); err != nil {
			logger.Debug("flags: no warm local cache loaded", "err", err)
		} else if snap != nil {
			c.snap.Store(snap)
			logger.Debug("flags: loaded warm local cache", "version", snap.Version)
		}
	}

	c.wg.Add(1)
	go c.syncLoop()

	return c, nil
}

// WaitReady blocks until the first successful sync, ctx is done, or the client
// is closed (CONTRACT §8). It returns ctx.Err() on cancellation/timeout and a
// sentinel error if the client was closed before becoming ready.
func (c *Client) WaitReady(ctx context.Context) error {
	select {
	case <-c.ready:
		return nil
	case <-c.ctx.Done():
		return errors.New("flags: client closed before ready")
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Version returns the current snapshot version, or "" if none. The version is
// OPAQUE (CONTRACT §4.4): it is stored and echoed, never recomputed.
func (c *Client) Version() string {
	if s := c.snap.Load(); s != nil {
		return s.Version
	}
	return ""
}

// Close cancels the sync context and waits for the background sync loop to exit;
// it is idempotent (CONTRACT §8). It does NOT wait for in-flight OnChange
// callbacks: those run in their own goroutines (so a slow callback cannot block
// the sync loop) and may briefly outlive Close.
func (c *Client) Close() error {
	c.cancel()
	c.wg.Wait()
	return nil
}

// OnChange registers a callback invoked with the changed flag keys whenever a
// new snapshot with a different version is applied (CONTRACT §8). Multiple
// callbacks are allowed. Callbacks run in their own goroutine after the swap, so
// they never block the sync loop.
func (c *Client) OnChange(fn func(changedKeys []string)) {
	if fn == nil {
		return
	}
	c.mu.Lock()
	c.callbacks = append(c.callbacks, fn)
	c.mu.Unlock()
}

// --- ready / cache state ------------------------------------------------------

// usable reports whether the current snapshot may be served: a snapshot exists
// AND it is not stale (CONTRACT §8). When false, accessors apply FailMode.
func (c *Client) usable() (*core.FlagsSnapshot, bool) {
	s := c.snap.Load()
	if s == nil {
		return nil, false
	}
	// Only a network sync sets lastSync; a warm-cache-only snapshot (lastSync==0)
	// is served but treated as not-fresh for staleness only if a threshold is set.
	if c.cfg.StaleThreshold > 0 {
		last := c.lastSync.Load()
		if last == 0 {
			// Warm cache loaded but never network-synced: serve it (it IS the
			// last-known-good) but it is not subject to the timer until first
			// sync. Treat as usable so cold-start serving works.
			return s, true
		}
		if time.Since(time.Unix(0, last)) > c.cfg.StaleThreshold {
			return s, false // stale -> FailMode
		}
	}
	return s, true
}

// applySnapshot atomically swaps in a new snapshot, records the sync time,
// persists it (if configured), signals ready, and fires OnChange callbacks if
// the version changed (CONTRACT §8).
func (c *Client) applySnapshot(snap *core.FlagsSnapshot) {
	old := c.snap.Load()
	c.snap.Store(snap)
	c.lastSync.Store(time.Now().UnixNano())

	// Persist last-known-good for warm cold-start (CONTRACT §8). Best-effort.
	if c.cfg.LocalCachePath != "" {
		if err := saveSnapshot(c.cfg.LocalCachePath, snap); err != nil {
			c.logger.Warn("flags: failed to persist local cache", "err", err)
		}
	}

	// Signal ready exactly once on first successful sync.
	c.readyOnce.Do(func() { close(c.ready) })

	// Fire callbacks only when the OPAQUE version differs (CONTRACT §8).
	if old == nil || old.Version != snap.Version {
		changed := diffKeys(old, snap)
		c.fireCallbacks(changed)
	}
}

// fireCallbacks invokes every registered callback in a goroutine so a slow
// callback never blocks the sync loop (CONTRACT §8).
func (c *Client) fireCallbacks(changed []string) {
	c.mu.Lock()
	cbs := make([]func([]string), len(c.callbacks))
	copy(cbs, c.callbacks)
	c.mu.Unlock()
	if len(cbs) == 0 || len(changed) == 0 {
		return
	}
	for _, fn := range cbs {
		fn := fn
		go fn(append([]string(nil), changed...))
	}
}

// diffKeys returns the set of flag keys whose presence or per-flag content
// changed between old and new snapshots (CONTRACT §8). A flag's identity is
// compared by its merged JSON content so config changes count as changes.
func diffKeys(old, neu *core.FlagsSnapshot) []string {
	oldByKey := map[string]string{}
	if old != nil {
		for i := range old.Flags {
			oldByKey[old.Flags[i].Key] = flagFingerprint(&old.Flags[i])
		}
	}
	newByKey := map[string]string{}
	for i := range neu.Flags {
		newByKey[neu.Flags[i].Key] = flagFingerprint(&neu.Flags[i])
	}

	changedSet := map[string]struct{}{}
	for k, fp := range newByKey {
		if old, ok := oldByKey[k]; !ok || old != fp {
			changedSet[k] = struct{}{}
		}
	}
	for k := range oldByKey {
		if _, ok := newByKey[k]; !ok {
			changedSet[k] = struct{}{} // removed flag
		}
	}

	out := make([]string, 0, len(changedSet))
	for k := range changedSet {
		out = append(out, k)
	}
	return out
}

// flagFingerprint is a stable per-flag content fingerprint used only for OnChange
// diffing. It is NOT the contract version hash (which is opaque, server-only) —
// it just detects "did this flag's merged content change".
func flagFingerprint(f *core.Flag) string {
	b, err := json.Marshal(f)
	if err != nil {
		return ""
	}
	return string(b)
}

// findFlag returns a pointer to the merged flag with the given key in snap, or
// nil if absent. The returned pointer is into the immutable snapshot slice.
func findFlag(snap *core.FlagsSnapshot, key string) *core.Flag {
	for i := range snap.Flags {
		if snap.Flags[i].Key == key {
			return &snap.Flags[i]
		}
	}
	return nil
}

// --- typed accessors ----------------------------------------------------------

// evalOrFail resolves key for the given requested type. It returns the
// EvaluationDetail and ok=true whenever a fresh snapshot exists (even if the
// flag is absent — that yields ERROR/FLAG_NOT_FOUND, handled as caller default).
// ok=false means unready/stale, the only states that apply FailMode (CONTRACT §8).
func (c *Client) evalOrFail(key string, ec EvalContext, requested core.FlagType) (Detail, bool) {
	snap, usable := c.usable()
	if !usable {
		return Detail{}, false
	}
	flag := findFlag(snap, key)
	// An unknown flag on a fresh snapshot is an ERROR/FLAG_NOT_FOUND, NOT the
	// unready/stale path: core.Evaluate(nil, ...) returns {default, "", ERROR,
	// FLAG_NOT_FOUND} and the *VariationDetail ERROR branch returns the caller
	// default. FailMode is reserved for unready/stale only (CONTRACT §4.1, §4.3,
	// §8); a missing flag must not flip to FailOpen/FailClosed.
	return core.Evaluate(flag, ec, requested), true
}

// boolFailValue returns the FailMode value for a bool accessor (CONTRACT §8):
// FailOpen -> true, FailClosed -> false, FailDefault -> caller default.
func (c *Client) boolFailValue(def bool) bool {
	switch c.cfg.FailMode {
	case FailOpen:
		return true
	case FailClosed:
		return false
	default:
		return def
	}
}

// BoolVariation evaluates key as a boolean, returning def on
// ERROR/coercion-failure and on an unknown flag (CONTRACT §4.1/§4.3). FailMode
// applies only on the unready/stale path (CONTRACT §8).
func (c *Client) BoolVariation(key string, ec EvalContext, def bool) bool {
	d := c.BoolVariationDetail(key, ec, def)
	v, _ := d.Value.(bool)
	return v
}

// BoolVariationDetail is BoolVariation returning the full Detail (CONTRACT §8).
// On the fail path it returns a synthetic ERROR detail whose Value is the
// FailMode-adjusted default.
func (c *Client) BoolVariationDetail(key string, ec EvalContext, def bool) Detail {
	d, ok := c.evalOrFail(key, ec, core.TypeBoolean)
	if !ok {
		return failDetail(c.boolFailValue(def))
	}
	if d.Reason == core.ReasonError {
		return failDetail(def)
	}
	b, ok := d.Value.(bool)
	if !ok {
		return failDetail(def) // coercion failure
	}
	d.Value = b
	return d
}

// StringVariation evaluates key as a string (CONTRACT §8).
func (c *Client) StringVariation(key string, ec EvalContext, def string) string {
	d := c.StringVariationDetail(key, ec, def)
	v, _ := d.Value.(string)
	return v
}

// StringVariationDetail is StringVariation returning the full Detail.
func (c *Client) StringVariationDetail(key string, ec EvalContext, def string) Detail {
	d, ok := c.evalOrFail(key, ec, core.TypeString)
	if !ok || d.Reason == core.ReasonError {
		return failDetail(def)
	}
	s, ok := d.Value.(string)
	if !ok {
		return failDetail(def)
	}
	d.Value = s
	return d
}

// IntVariation evaluates key as an int. Numbers arrive as float64 from the core
// and are truncated to int; non-numeric values yield def (CONTRACT §8).
func (c *Client) IntVariation(key string, ec EvalContext, def int) int {
	d := c.IntVariationDetail(key, ec, def)
	v, _ := d.Value.(int)
	return v
}

// IntVariationDetail is IntVariation returning the full Detail.
func (c *Client) IntVariationDetail(key string, ec EvalContext, def int) Detail {
	d, ok := c.evalOrFail(key, ec, core.TypeNumber)
	if !ok || d.Reason == core.ReasonError {
		return failDetail(def)
	}
	f, ok := d.Value.(float64)
	if !ok {
		return failDetail(def)
	}
	d.Value = int(f)
	return d
}

// FloatVariation evaluates key as a float64 (CONTRACT §8).
func (c *Client) FloatVariation(key string, ec EvalContext, def float64) float64 {
	d := c.FloatVariationDetail(key, ec, def)
	v, _ := d.Value.(float64)
	return v
}

// FloatVariationDetail is FloatVariation returning the full Detail.
func (c *Client) FloatVariationDetail(key string, ec EvalContext, def float64) Detail {
	d, ok := c.evalOrFail(key, ec, core.TypeNumber)
	if !ok || d.Reason == core.ReasonError {
		return failDetail(def)
	}
	f, ok := d.Value.(float64)
	if !ok {
		return failDetail(def)
	}
	d.Value = f
	return d
}

// JSONVariation evaluates key as a JSON value, marshalling the resolved value
// back to json.RawMessage (CONTRACT §8). Returns def on any failure.
func (c *Client) JSONVariation(key string, ec EvalContext, def json.RawMessage) json.RawMessage {
	d := c.JSONVariationDetail(key, ec, def)
	v, ok := d.Value.(json.RawMessage)
	if !ok {
		return def
	}
	return v
}

// JSONVariationDetail is JSONVariation returning the full Detail. On success the
// Detail.Value holds the json.RawMessage; on failure it holds def.
func (c *Client) JSONVariationDetail(key string, ec EvalContext, def json.RawMessage) Detail {
	d, ok := c.evalOrFail(key, ec, core.TypeJSON)
	if !ok || d.Reason == core.ReasonError {
		return failDetail(def)
	}
	raw, err := json.Marshal(d.Value)
	if err != nil {
		return failDetail(def)
	}
	d.Value = json.RawMessage(raw)
	return d
}

// failDetail builds an ERROR detail carrying the supplied (fail-path) value so
// *VariationDetail always returns a usable Value.
func failDetail(value any) Detail {
	return Detail{
		Value:     value,
		Reason:    core.ReasonError,
		ErrorKind: core.ErrFlagNotFound,
	}
}

// AllFlags evaluates every flag in the current snapshot for ec and returns a
// map of key -> resolved value (CONTRACT §8). Each flag is evaluated against its
// own declared type. Returns an empty map when no snapshot is available. ERROR
// results are omitted.
func (c *Client) AllFlags(ec EvalContext) map[string]any {
	out := map[string]any{}
	snap, usable := c.usable()
	if !usable {
		return out
	}
	for i := range snap.Flags {
		f := &snap.Flags[i]
		d := core.Evaluate(f, ec, f.Type)
		if d.Reason == core.ReasonError {
			continue
		}
		out[f.Key] = d.Value
	}
	return out
}
