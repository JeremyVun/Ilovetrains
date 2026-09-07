package flags

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	core "github.com/JeremyVun/flags/server/pkg/flags"
)

// transport abstracts the connection that delivers snapshots. The production
// implementation streams SSE from the raw-snapshot plane
// (/v1/projects/{project}/environments/{environment}/snapshot/stream); tests
// inject a fake.
//
// stream blocks, delivering each parsed snapshot to onSnapshot, until ctx is
// cancelled or a connection error occurs. It returns the error (or ctx.Err())
// so the sync loop can apply backoff. A retryAfter > 0 (from a 503 Retry-After
// header) instructs the loop to wait at least that long before reconnecting.
type transport interface {
	stream(ctx context.Context, lastVersion string, onSnapshot func(*core.FlagsSnapshot)) (retryAfter time.Duration, err error)
}

// httpTransport is the real SSE transport (CONTRACT §3.1, §3.3). It carries the
// opaque key plus optional static X-User / X-Application read attribution.
type httpTransport struct {
	streamURL   string
	key         string
	user        string
	application string
	httpClient  *http.Client
}

// newHTTPTransport builds the SSE transport. The HTTP client has NO overall
// timeout (SSE is long-lived); ConnectTimeout bounds only connection
// establishment (time to first snapshot) per attempt, enforced at the sync-loop
// level. The snapshot-stream URL is built once from the configured
// Project/Environment.
func newHTTPTransport(cfg Config) *httpTransport {
	base := strings.TrimRight(cfg.ServiceURL, "/")
	return &httpTransport{
		streamURL: base + "/v1/projects/" + url.PathEscape(cfg.Project) +
			"/environments/" + url.PathEscape(cfg.Environment) + "/snapshot/stream",
		key:         cfg.Key,
		user:        cfg.User,
		application: cfg.Application,
		httpClient:  &http.Client{},
	}
}

// setHeaders applies the credential and optional static service-identity
// attribution. X-User/X-Application, when set, are the machine SDK consumer's
// STATIC service identity, not the per-evaluation end user.
func (t *httpTransport) setHeaders(req *http.Request) {
	req.Header.Set("Authorization", "Bearer "+t.key)
	if t.user != "" {
		req.Header.Set("X-User", t.user)
	}
	if t.application != "" {
		req.Header.Set("X-Application", t.application)
	}
}

// stream connects to the raw-snapshot SSE endpoint
// (GET /v1/projects/{project}/environments/{environment}/snapshot/stream) with a
// Bearer key plus optional X-User/X-Application attribution, parses the SSE frame stream
// incrementally, and applies each `event: put` snapshot (CONTRACT §3.1, §3.3).
// It honours Retry-After on 503.
func (t *httpTransport) stream(ctx context.Context, lastVersion string, onSnapshot func(*core.FlagsSnapshot)) (time.Duration, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, t.streamURL, nil)
	if err != nil {
		return 0, err
	}
	t.setHeaders(req)
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cache-Control", "no-cache")
	if lastVersion != "" {
		// Snapshots are idempotent; the server MAY ignore this (CONTRACT §3.3).
		req.Header.Set("Last-Event-ID", lastVersion)
	}

	resp, err := t.httpClient.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusServiceUnavailable {
		return parseRetryAfter(resp.Header.Get("Retry-After")), fmt.Errorf("flags: service unavailable (503)")
	}
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("flags: stream connect failed: status %d", resp.StatusCode)
	}

	return 0, parseSSE(ctx, resp.Body, onSnapshot)
}

// parseRetryAfter parses a Retry-After header value (delta-seconds form). HTTP
// dates are not honoured (rare for 503 here); returns 0 if unparseable.
func parseRetryAfter(v string) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil && secs >= 0 {
		return time.Duration(secs) * time.Second
	}
	if ts, err := http.ParseTime(v); err == nil {
		if d := time.Until(ts); d > 0 {
			return d
		}
	}
	return 0
}

// parseSSE reads an SSE byte stream incrementally and invokes onSnapshot for
// each complete `event: put` frame (CONTRACT §3.3). It handles:
//   - "retry: <ms>"     (ignored — backoff is SDK-controlled)
//   - "event: <name>"   (only "put" is acted on in v1)
//   - "id: <version>"   (carried but the snapshot already holds the version)
//   - "data: <json>"    (single-line compact JSON FlagsSnapshot)
//   - ": <comment>"     (heartbeats / comments — ignored)
//
// A blank line terminates an event. It respects ctx cancellation via the body
// being closed by the caller; it returns io.EOF or the read error on exit.
func parseSSE(ctx context.Context, body io.Reader, onSnapshot func(*core.FlagsSnapshot)) error {
	reader := bufio.NewReader(body)
	var event string
	var data strings.Builder
	haveData := false

	flush := func() {
		// Dispatch the accumulated event at a frame boundary (blank line), then
		// ALWAYS reset frame state (so a malformed frame can't leak into the
		// next one).
		if haveData && (event == "" || event == "put") {
			// Default event type is "message"/"put" semantics here; the SDK
			// stream only emits put, so treat empty event with data as put too.
			var snap core.FlagsSnapshot
			if err := json.Unmarshal([]byte(data.String()), &snap); err == nil {
				onSnapshot(&snap)
			}
			// Malformed data is silently dropped; the stream continues and the
			// next full put converges the cache (CONTRACT §3.3).
		}
		event = ""
		data.Reset()
		haveData = false
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		line, err := reader.ReadString('\n')
		if len(line) > 0 {
			// Strip the trailing newline (and optional CR).
			trimmed := strings.TrimRight(line, "\n")
			trimmed = strings.TrimRight(trimmed, "\r")

			switch {
			case trimmed == "":
				// End of an event.
				flush()
			case strings.HasPrefix(trimmed, ":"):
				// Comment / heartbeat (CONTRACT §3.3) — ignore.
			default:
				field, value := splitSSEField(trimmed)
				switch field {
				case "event":
					event = value
				case "data":
					if haveData {
						data.WriteByte('\n')
					}
					data.WriteString(value)
					haveData = true
				case "id", "retry":
					// id is the version (already in the snapshot); retry is
					// SDK-controlled. Both ignored for control flow.
				}
			}
		}

		if err != nil {
			if err == io.EOF {
				// Flush any trailing event with no final blank line.
				flush()
			}
			return err
		}
	}
}

// splitSSEField splits an SSE line "field: value" / "field:value" into its
// field name and value, stripping ONE optional leading space from the value
// (per the SSE spec). A line with no colon is a field with an empty value.
func splitSSEField(line string) (field, value string) {
	idx := strings.IndexByte(line, ':')
	if idx < 0 {
		return line, ""
	}
	field = line[:idx]
	value = line[idx+1:]
	value = strings.TrimPrefix(value, " ")
	return field, value
}

// --- sync loop / backoff ------------------------------------------------------

// syncLoop runs the background sync: connect, stream snapshots, and reconnect
// with capped, jittered exponential backoff, never busy-looping (CONTRACT §8).
// Each attempt's CONNECT phase (time to first snapshot) is bounded by
// ConnectTimeout via a watchdog that the first snapshot disarms — so a hung
// connect cannot stall sync, yet a healthy long-lived stream is never timed
// out. A failure does NOT block boot; the loop simply keeps retrying.
func (c *Client) syncLoop() {
	defer c.wg.Done()

	attempt := 0
	for {
		if c.ctx.Err() != nil {
			return
		}

		// Bound only connection establishment / time-to-first-snapshot, NOT the
		// whole stream. A watchdog cancels the stream if no snapshot arrives
		// within ConnectTimeout; the FIRST snapshot disarms it so a healthy,
		// long-lived stream is never torn down. (Previously ConnectTimeout
		// wrapped the entire first stream, recycling a healthy connection every
		// ~ConnectTimeout and producing perpetual reconnect churn.)
		streamCtx, cancel := context.WithCancel(c.ctx)
		connectWatchdog := time.AfterFunc(c.cfg.ConnectTimeout, cancel)

		// Track whether THIS connection delivered a snapshot, and how long it
		// stayed up, so backoff resets only for a genuinely healthy connection.
		delivered := false
		onSnapshot := func(s *core.FlagsSnapshot) {
			if !delivered {
				delivered = true
				// First snapshot proves the connection is healthy: stop the
				// connect watchdog so it cannot tear down the live stream.
				connectWatchdog.Stop()
			}
			c.applySnapshot(s)
		}
		connectedAt := time.Now()
		retryAfter, err := c.transport.stream(streamCtx, c.Version(), onSnapshot)
		connectWatchdog.Stop()
		cancel()

		if c.ctx.Err() != nil {
			return
		}

		if err != nil {
			c.logger.Debug("flags: stream ended, will reconnect", "err", err, "attempt", attempt)
		}

		// Honour Retry-After on 503; otherwise use the exponential schedule.
		wait := backoffDuration(attempt, initialBackoff, c.cfg.ReconnectMaxBackoff)
		if retryAfter > 0 {
			if retryAfter > wait {
				wait = retryAfter
			}
		}

		attempt++

		// Reset backoff only for a STABLE connection (delivered a snapshot AND
		// stayed up past minStableConnection). Previously this reset whenever
		// c.lastSync != 0 — permanently true after the first-ever sync — so
		// backoff never grew and a flapping endpoint produced a reconnect storm
		// (CONTRACT §8). A flap now keeps growing backoff toward the cap.
		if shouldResetBackoff(delivered, retryAfter, time.Since(connectedAt)) {
			attempt = 0
			wait = backoffDuration(0, initialBackoff, c.cfg.ReconnectMaxBackoff)
		}

		select {
		case <-c.ctx.Done():
			return
		case <-time.After(wait):
		}
	}
}

// shouldResetBackoff reports whether a just-ended stream connection was healthy
// enough to reset the reconnect backoff: it delivered at least one snapshot AND
// stayed connected past minStableConnection, and did not end with a 503
// Retry-After (which dictates its own wait). A flap — no snapshot, or a
// sub-threshold connection lifetime — returns false so backoff keeps growing
// toward the cap (CONTRACT §8). This replaces the old `lastSync != 0` test,
// which was permanently true after the first-ever sync and so never let backoff
// grow.
func shouldResetBackoff(delivered bool, retryAfter, connDuration time.Duration) bool {
	return delivered && retryAfter == 0 && connDuration >= minStableConnection
}

// backoffDuration computes the reconnect wait for a given attempt: exponential
// (base * 2^attempt) capped at max, with up to ±20% jitter so reconnecting
// fleets don't thunder (CONTRACT §8). attempt 0 yields ~base.
func backoffDuration(attempt int, base, max time.Duration) time.Duration {
	if base <= 0 {
		base = initialBackoff
	}
	if max <= 0 {
		max = defaultReconnectMaxBackoff
	}
	// Cap the shift to avoid overflow.
	d := base
	for i := 0; i < attempt && d < max; i++ {
		d *= 2
	}
	if d > max {
		d = max
	}
	// Jitter ±20%.
	jitter := 1.0 + (rand.Float64()*0.4 - 0.2)
	jittered := time.Duration(float64(d) * jitter)
	if jittered > max {
		jittered = max
	}
	if jittered <= 0 {
		jittered = base
	}
	return jittered
}
