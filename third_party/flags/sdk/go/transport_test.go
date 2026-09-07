package flags

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	core "github.com/JeremyVun/flags/server/pkg/flags"
)

// --- SSE frame parser ---------------------------------------------------------

func TestParseSSESingleFrame(t *testing.T) {
	raw := "retry: 5000\n" +
		"\n" +
		"event: put\n" +
		"id: v1\n" +
		`data: {"version":"v1","project":"p","environment":"production","flags":[{"key":"f","type":"boolean","variations":[{"key":"off","value":false},{"key":"on","value":true}],"enabled":true,"off_variation":"off","fallthrough":{"variation":"on"}}]}` + "\n" +
		"\n"

	var got []*core.FlagsSnapshot
	err := parseSSE(context.Background(), strings.NewReader(raw), func(s *core.FlagsSnapshot) {
		got = append(got, s)
	})
	if err == nil {
		t.Logf("parseSSE returned nil err (EOF expected)")
	}
	if len(got) != 1 {
		t.Fatalf("got %d snapshots want 1", len(got))
	}
	if got[0].Version != "v1" || len(got[0].Flags) != 1 || got[0].Flags[0].Key != "f" {
		t.Errorf("snapshot = %+v", got[0])
	}
}

func TestParseSSEMultiFrameWithHeartbeats(t *testing.T) {
	frame := func(v string) string {
		return "event: put\n" +
			"id: " + v + "\n" +
			`data: {"version":"` + v + `","project":"p","environment":"e","flags":[]}` + "\n\n"
	}
	raw := "retry: 5000\n\n" +
		frame("a") +
		": heartbeat\n\n" + // comment between frames
		frame("b") +
		": heartbeat\n\n" +
		frame("c")

	var versions []string
	_ = parseSSE(context.Background(), strings.NewReader(raw), func(s *core.FlagsSnapshot) {
		versions = append(versions, s.Version)
	})
	if strings.Join(versions, ",") != "a,b,c" {
		t.Errorf("versions = %v want [a b c]", versions)
	}
}

func TestParseSSEIgnoresMalformedData(t *testing.T) {
	raw := "event: put\ndata: {not json}\n\n" +
		`event: put` + "\n" + `data: {"version":"ok","project":"p","environment":"e","flags":[]}` + "\n\n"
	var versions []string
	_ = parseSSE(context.Background(), strings.NewReader(raw), func(s *core.FlagsSnapshot) {
		versions = append(versions, s.Version)
	})
	if len(versions) != 1 || versions[0] != "ok" {
		t.Errorf("versions = %v want [ok] (malformed skipped)", versions)
	}
}

func TestParseSSEHandlesCRLF(t *testing.T) {
	raw := "event: put\r\n" +
		`data: {"version":"crlf","project":"p","environment":"e","flags":[]}` + "\r\n\r\n"
	var got *core.FlagsSnapshot
	_ = parseSSE(context.Background(), strings.NewReader(raw), func(s *core.FlagsSnapshot) { got = s })
	if got == nil || got.Version != "crlf" {
		t.Errorf("CRLF frame not parsed: %+v", got)
	}
}

func TestParseSSEContextCancel(t *testing.T) {
	// A reader that blocks would hang; instead verify a cancelled ctx returns.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	pr, pw := newBlockingPipe()
	defer pw.close()
	err := parseSSE(ctx, pr, func(*core.FlagsSnapshot) {})
	if err == nil {
		t.Error("expected ctx error from cancelled parseSSE")
	}
}

func TestSplitSSEField(t *testing.T) {
	cases := []struct{ in, wf, wv string }{
		{"event: put", "event", "put"},
		{"data:{\"x\":1}", "data", `{"x":1}`}, // no space after colon
		{"id: v1", "id", "v1"},
		{": comment", "", "comment"},
		{"noColon", "noColon", ""},
	}
	for _, c := range cases {
		f, v := splitSSEField(c.in)
		if f != c.wf || v != c.wv {
			t.Errorf("splitSSEField(%q) = (%q,%q) want (%q,%q)", c.in, f, v, c.wf, c.wv)
		}
	}
}

// --- backoff ------------------------------------------------------------------

func TestBackoffSchedule(t *testing.T) {
	base := time.Second
	max := 30 * time.Second
	// With ±20% jitter, attempt n nominal = min(base*2^n, max). Verify bounds.
	for attempt, nominal := range []time.Duration{
		1 * time.Second, 2 * time.Second, 4 * time.Second, 8 * time.Second,
		16 * time.Second, 30 * time.Second, 30 * time.Second, 30 * time.Second,
	} {
		lo := time.Duration(float64(nominal) * 0.8)
		hi := time.Duration(float64(nominal) * 1.2)
		if hi > max {
			hi = max
		}
		for i := 0; i < 50; i++ {
			d := backoffDuration(attempt, base, max)
			if d < lo || d > hi {
				t.Errorf("attempt %d: backoff %v outside [%v,%v]", attempt, d, lo, hi)
				break
			}
		}
	}
}

func TestShouldResetBackoff(t *testing.T) {
	stable := minStableConnection + time.Second
	cases := []struct {
		name       string
		delivered  bool
		retryAfter time.Duration
		connDur    time.Duration
		wantReset  bool
	}{
		{"stable connection that delivered resets", true, 0, stable, true},
		{"flap: delivered but sub-threshold duration does NOT reset", true, 0, time.Millisecond, false},
		{"connected long but never delivered does NOT reset", false, 0, stable, false},
		{"503 retry-after never resets (it dictates its own wait)", true, 5 * time.Second, stable, false},
		{"exactly at threshold resets", true, 0, minStableConnection, true},
	}
	for _, c := range cases {
		if got := shouldResetBackoff(c.delivered, c.retryAfter, c.connDur); got != c.wantReset {
			t.Errorf("%s: shouldResetBackoff(%v,%v,%v) = %v want %v",
				c.name, c.delivered, c.retryAfter, c.connDur, got, c.wantReset)
		}
	}
}

func TestBackoffCappedAtMax(t *testing.T) {
	max := 5 * time.Second
	for attempt := 0; attempt < 40; attempt++ {
		if d := backoffDuration(attempt, time.Second, max); d > max {
			t.Fatalf("attempt %d backoff %v exceeds max %v", attempt, d, max)
		}
	}
}

func TestBackoffNoOverflow(t *testing.T) {
	// Large attempt must not overflow / go negative.
	d := backoffDuration(1000, time.Second, 30*time.Second)
	if d <= 0 || d > 30*time.Second {
		t.Errorf("huge attempt backoff = %v", d)
	}
}

// --- sync loop integration (fake transport, no network) -----------------------

// fakeTransport feeds queued snapshots then signals errors to drive reconnect.
type fakeTransport struct {
	mu      sync.Mutex
	calls   int
	snaps   []*core.FlagsSnapshot
	onEvery func(call int) (retry time.Duration, err error)
}

func (f *fakeTransport) stream(ctx context.Context, lastVersion string, onSnapshot func(*core.FlagsSnapshot)) (time.Duration, error) {
	f.mu.Lock()
	call := f.calls
	f.calls++
	snaps := f.snaps
	f.mu.Unlock()

	if call == 0 {
		for _, s := range snaps {
			onSnapshot(s)
		}
	}
	if f.onEvery != nil {
		return f.onEvery(call)
	}
	// Block until cancelled to emulate a live stream.
	<-ctx.Done()
	return 0, ctx.Err()
}

func TestSyncLoopAppliesSnapshotAndReady(t *testing.T) {
	ft := &fakeTransport{snaps: []*core.FlagsSnapshot{snapshot("v1", boolFlag("f", true, "on"))}}
	ctx, cancel := context.WithCancel(context.Background())
	c := &Client{
		cfg:       Config{ConnectTimeout: time.Second, ReconnectMaxBackoff: time.Second},
		logger:    newDiscardLogger(),
		ready:     make(chan struct{}),
		ctx:       ctx,
		cancel:    cancel,
		transport: ft,
	}
	c.wg.Add(1)
	go c.syncLoop()
	defer c.Close()

	wctx, wcancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer wcancel()
	if err := c.WaitReady(wctx); err != nil {
		t.Fatalf("WaitReady = %v", err)
	}
	if got := c.BoolVariation("f", EvalContext{Key: "u"}, false); got != true {
		t.Errorf("after sync loop bool = %v want true", got)
	}
	if c.Version() != "v1" {
		t.Errorf("version = %q", c.Version())
	}
}

func TestSyncLoopReconnects(t *testing.T) {
	var reconnects int
	var mu sync.Mutex
	ft := &fakeTransport{
		snaps: []*core.FlagsSnapshot{snapshot("v1", boolFlag("f", true, "on"))},
		onEvery: func(call int) (time.Duration, error) {
			mu.Lock()
			reconnects = call
			mu.Unlock()
			if call < 3 {
				return 0, context.DeadlineExceeded // force quick reconnect
			}
			return 0, nil
		},
	}
	ctx, cancel := context.WithCancel(context.Background())
	c := &Client{
		cfg:       Config{ConnectTimeout: 50 * time.Millisecond, ReconnectMaxBackoff: 10 * time.Millisecond},
		logger:    newDiscardLogger(),
		ready:     make(chan struct{}),
		ctx:       ctx,
		cancel:    cancel,
		transport: ft,
	}
	c.wg.Add(1)
	go c.syncLoop()
	defer c.Close()

	deadline := time.After(2 * time.Second)
	for {
		mu.Lock()
		r := reconnects
		mu.Unlock()
		if r >= 3 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("only %d reconnects observed", r)
		case <-time.After(5 * time.Millisecond):
		}
	}
}

// TestSyncLoopHealthyStreamNotRecycledByConnectTimeout is the regression test for
// the bug where ConnectTimeout bounded the ENTIRE first stream, tearing down a
// healthy long-lived connection every ~ConnectTimeout and causing perpetual
// reconnect churn. A connection that delivers a snapshot then stays up must NOT
// be recycled once it has delivered, even many ConnectTimeout windows later.
func TestSyncLoopHealthyStreamNotRecycledByConnectTimeout(t *testing.T) {
	ft := &fakeTransport{snaps: []*core.FlagsSnapshot{snapshot("v1", boolFlag("f", true, "on"))}}
	ctx, cancel := context.WithCancel(context.Background())
	c := &Client{
		// Tiny ConnectTimeout: if it (wrongly) bounded the whole stream, the
		// fake connection — which delivers v1 then blocks — would be recycled
		// ~20x/second instead of staying up.
		cfg:       Config{ConnectTimeout: 50 * time.Millisecond, ReconnectMaxBackoff: time.Millisecond},
		logger:    newDiscardLogger(),
		ready:     make(chan struct{}),
		ctx:       ctx,
		cancel:    cancel,
		transport: ft,
	}
	c.wg.Add(1)
	go c.syncLoop()
	defer c.Close()

	wctx, wcancel := context.WithTimeout(context.Background(), time.Second)
	defer wcancel()
	if err := c.WaitReady(wctx); err != nil {
		t.Fatalf("WaitReady = %v", err)
	}

	// Wait well past many ConnectTimeout windows; a healthy stream must stay up.
	time.Sleep(400 * time.Millisecond) // 8x ConnectTimeout

	ft.mu.Lock()
	calls := ft.calls
	ft.mu.Unlock()
	if calls != 1 {
		t.Fatalf("healthy stream recycled: transport.stream called %d times, want 1 "+
			"(ConnectTimeout must bound only time-to-first-snapshot, not the live stream)", calls)
	}
}

// --- Retry-After parsing ------------------------------------------------------

func TestParseRetryAfter(t *testing.T) {
	if d := parseRetryAfter("10"); d != 10*time.Second {
		t.Errorf("delta-seconds = %v", d)
	}
	if d := parseRetryAfter(""); d != 0 {
		t.Errorf("empty = %v", d)
	}
	if d := parseRetryAfter("garbage"); d != 0 {
		t.Errorf("garbage = %v", d)
	}
}

// --- blocking pipe (test util) -----------------------------------------------

type blockingReader struct{ ch chan []byte }
type blockingWriter struct{ ch chan []byte }

func newBlockingPipe() (*blockingReader, *blockingWriter) {
	ch := make(chan []byte)
	return &blockingReader{ch}, &blockingWriter{ch}
}

func (r *blockingReader) Read(p []byte) (int, error) {
	b, ok := <-r.ch
	if !ok {
		return 0, context.Canceled
	}
	return copy(p, b), nil
}

func (w *blockingWriter) close() { close(w.ch) }
