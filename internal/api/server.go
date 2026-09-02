// Package api serves docs/contracts/api.md: the JSON endpoints, their cache
// headers, the error contract, and the static client shell.
package api

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"os"
	"strconv"
	"time"

	"trains/internal/cache"
	"trains/internal/tfnsw"
)

// Upstream is the part of the TfNSW client the handlers need. Handler tests
// substitute a fake so no test touches the network.
type Upstream interface {
	Departures(ctx context.Context, from, to string, limit int, at time.Time) (*tfnsw.DeparturesResponse, error)
	Stops(ctx context.Context, query string) (*tfnsw.StopsResponse, error)
}

// Cache lifetimes. The in-memory TTLs mirror the s-maxage the contract
// advertises to the CDN, so an origin behind a cold CDN still costs at most one
// upstream call per key per TTL.
const (
	departuresTTL = 30 * time.Second
	stopsTTL      = 24 * time.Hour

	// A settled past window does not change, so it is cached for an hour and
	// the CDN is told it may keep it for one. Caching it is not only cheap but
	// better: upstream drops realtime actuals from a window a few hours after
	// it passes, so the cached copy taken while the actuals were still there is
	// the more truthful answer.
	departuresPastTTL = time.Hour

	// The contract's stale-on-upstream-failure windows differ because
	// departures data ages badly while the near-static station list
	// does not, so a week-old search index beats a 502 during a long outage.
	// A past window has already happened, so a day-old copy of it is exactly as
	// true as a fresh fetch — matching the stale-while-revalidate we advertise.
	departuresStaleWindow     = 10 * time.Minute
	departuresPastStaleWindow = 24 * time.Hour
	stopsStaleWindow          = 7 * 24 * time.Hour

	// fetchBudget bounds one upstream fetch including its retry.
	fetchBudget = 12 * time.Second
)

// Cache-Control values from the contract.
const (
	departuresCacheControl     = "public, s-maxage=30, stale-while-revalidate=60"
	departuresPastCacheControl = "public, s-maxage=3600, stale-while-revalidate=86400"
	stopsCacheControl          = "public, s-maxage=86400, stale-while-revalidate=604800"
	errorCacheableControl      = "public, s-maxage=60"
	noStore                    = "no-store"
)

// The `at` window, from the contract.
const (
	// bucketSize quantises `at`, so a client scrolling into the past pages on
	// stable keys and every response stays a pure function of the query string.
	bucketSize = 10 * time.Minute

	// settledAge is how far into the past a bucket must be before every journey
	// in it has departed and what ran can no longer change. A bucket newer than
	// this can still contain a train that has not left, so it keeps the live
	// cache policy.
	settledAge = 20 * time.Minute

	// How far a client may page. See departAt: these bound the key space.
	maxPastWindow   = 24 * time.Hour
	maxFutureWindow = 2 * time.Hour
)

// Journey count bounds from the contract.
const (
	defaultLimit = 6
	maxLimit     = 10
)

const minQueryLength = 2

// Server holds the caches and upstream client shared by all requests. It holds
// no per-user state: every response is a pure function of the query string.
type Server struct {
	upstream Upstream
	// Two departure caches, not one: a live window is worth 30 seconds and a
	// settled past window is worth an hour, and cache.Cache holds one TTL.
	departures     *cache.Cache[*tfnsw.DeparturesResponse]
	departuresPast *cache.Cache[*tfnsw.DeparturesResponse]
	stops          *cache.Cache[*tfnsw.StopsResponse]
	webDir         string
	now            func() time.Time
}

// New returns a server serving the API plus, if webDir exists, the static
// client at /.
func New(upstream Upstream, webDir string) *Server {
	return &Server{
		upstream:       upstream,
		departures:     cache.New[*tfnsw.DeparturesResponse](departuresTTL, departuresStaleWindow),
		departuresPast: cache.New[*tfnsw.DeparturesResponse](departuresPastTTL, departuresPastStaleWindow),
		stops:          cache.New[*tfnsw.StopsResponse](stopsTTL, stopsStaleWindow),
		webDir:         webDir,
		now:            time.Now,
	}
}

// Handler returns the routed, CORS-wrapped handler for the whole service.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/departures", s.handleDepartures)
	mux.HandleFunc("GET /api/v1/stops", s.handleStops)
	mux.HandleFunc("GET /healthz", handleHealthz)
	// Unmatched API paths answer in the error envelope rather than falling
	// through to the static file server.
	mux.HandleFunc("GET /api/", handleNotFound)
	mux.Handle("GET /", s.staticHandler())
	return withCORS(mux)
}

func (s *Server) staticHandler() http.Handler {
	// Go's MIME table has no entry for .webmanifest, so the file server sniffs
	// it as text/plain and the install prompt never appears. Registering the
	// type is idempotent.
	_ = mime.AddExtensionType(".webmanifest", "application/manifest+json")

	if info, err := os.Stat(s.webDir); err != nil || !info.IsDir() {
		// The client is built in a later phase; until then / is simply empty.
		return http.HandlerFunc(handleNotFound)
	}
	fs := http.FileServer(http.Dir(s.webDir))
	// Explicit no-cache on every shell file: without it Cloudflare imposes its
	// default 4h edge TTL on static extensions and a deploy does not reach
	// returning phones until it expires (observed live 2026-09-01: sw.js served
	// as a cf-cache-status HIT 47 minutes after the v4 deploy). no-cache means
	// revalidate, not don't-store — Last-Modified 304s keep it cheap, the
	// service worker keeps clients fast, and sw.js freshness is what governs
	// shell updates, so it above all must never be served stale by a proxy.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		fs.ServeHTTP(w, r)
	})
}

func (s *Server) handleDepartures(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	from, err := stopID(query.Get("from"), "from")
	if err != nil {
		writeError(w, err)
		return
	}
	to, err := stopID(query.Get("to"), "to")
	if err != nil {
		writeError(w, err)
		return
	}
	if from == to {
		writeError(w, badRequest("from and to must be different stops"))
		return
	}
	limit, err := journeyLimit(query.Get("limit"))
	if err != nil {
		writeError(w, err)
		return
	}
	now := s.now()
	at, err := departAt(query.Get("at"), now)
	if err != nil {
		writeError(w, err)
		return
	}

	// The bucket is part of the key, so a past page and the live board never
	// share an entry, and asking for the current bucket explicitly is a
	// different answer (it echoes `at`) from asking for now.
	key := from + "|" + to + "|" + strconv.Itoa(limit) + "|" + bucketKey(at)
	store, cacheControl := s.departures, departuresCacheControl
	if settled(at, now) {
		store, cacheControl = s.departuresPast, departuresPastCacheControl
	}

	result, err := store.Do(r.Context(), key, func(ctx context.Context) (*tfnsw.DeparturesResponse, error) {
		ctx, cancel := fetchContext(ctx)
		defer cancel()
		return s.upstream.Departures(ctx, from, to, limit, at)
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeData(w, cacheControl, result.Stale, result.Value)
}

// settled reports whether a window is far enough in the past that every journey
// in it has already departed, so the answer can be cached hard. A zero `at` is
// the live board and never settled.
func settled(at, now time.Time) bool {
	return !at.IsZero() && at.Before(now.Add(-settledAge))
}

// bucketKey renders a window for the cache key. The empty string is "now",
// which must not collide with any real bucket.
func bucketKey(at time.Time) string {
	if at.IsZero() {
		return ""
	}
	return strconv.FormatInt(at.Unix(), 10)
}

func (s *Server) handleStops(w http.ResponseWriter, r *http.Request) {
	query, err := searchText(r.URL.Query().Get("q"))
	if err != nil {
		writeError(w, err)
		return
	}

	result, err := s.stops.Do(r.Context(), query, func(ctx context.Context) (*tfnsw.StopsResponse, error) {
		ctx, cancel := fetchContext(ctx)
		defer cancel()
		return s.upstream.Stops(ctx, query)
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeData(w, stopsCacheControl, result.Stale, result.Value)
}

func handleHealthz(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, noStore, map[string]bool{"ok": true})
}

// fetchContext detaches the upstream call from the requesting client. The
// single-flight leader's fetch serves every waiter, so one client disconnecting
// must not fail the others.
func fetchContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), fetchBudget)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isAPIPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}
		// No credentials are ever involved, so a wildcard origin is safe and
		// keeps responses identical for every caller (and every CDN).
		h := w.Header()
		h.Set("Access-Control-Allow-Origin", "*")
		h.Set("Access-Control-Expose-Headers", "X-Data-Stale")
		if r.Method == http.MethodOptions {
			h.Set("Access-Control-Allow-Methods", "GET, OPTIONS")
			h.Set("Cache-Control", errorCacheableControl)
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isAPIPath(path string) bool {
	return path == "/healthz" || len(path) >= 5 && path[:5] == "/api/"
}

func upstreamStatus(err error) (int, string) {
	switch {
	case errors.Is(err, tfnsw.ErrTimeout), errors.Is(err, context.DeadlineExceeded):
		return http.StatusGatewayTimeout, "upstream_timeout"
	default:
		return http.StatusBadGateway, "upstream_unavailable"
	}
}
