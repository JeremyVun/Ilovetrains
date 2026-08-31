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
	Departures(ctx context.Context, from, to string, limit int) (*tfnsw.DeparturesResponse, error)
	Stops(ctx context.Context, query string) (*tfnsw.StopsResponse, error)
}

// Cache lifetimes. The in-memory TTLs mirror the s-maxage the contract
// advertises to the CDN, so an origin behind a cold CDN still costs at most one
// upstream call per key per TTL.
const (
	departuresTTL = 30 * time.Second
	stopsTTL      = 24 * time.Hour

	// The contract's stale-on-upstream-failure windows (owner ruling
	// 2026-08-31): departures data ages badly, the near-static station list
	// does not, so a week-old search index beats a 502 during a long outage.
	departuresStaleWindow = 10 * time.Minute
	stopsStaleWindow      = 7 * 24 * time.Hour

	// fetchBudget bounds one upstream fetch including its retry.
	fetchBudget = 12 * time.Second
)

// Cache-Control values from the contract.
const (
	departuresCacheControl = "public, s-maxage=30, stale-while-revalidate=60"
	stopsCacheControl      = "public, s-maxage=86400, stale-while-revalidate=604800"
	errorCacheableControl  = "public, s-maxage=60"
	noStore                = "no-store"
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
	upstream   Upstream
	departures *cache.Cache[*tfnsw.DeparturesResponse]
	stops      *cache.Cache[*tfnsw.StopsResponse]
	webDir     string
}

// New returns a server serving the API plus, if webDir exists, the static
// client at /.
func New(upstream Upstream, webDir string) *Server {
	return &Server{
		upstream:   upstream,
		departures: cache.New[*tfnsw.DeparturesResponse](departuresTTL, departuresStaleWindow),
		stops:      cache.New[*tfnsw.StopsResponse](stopsTTL, stopsStaleWindow),
		webDir:     webDir,
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

	key := from + "|" + to + "|" + strconv.Itoa(limit)
	result, err := s.departures.Do(r.Context(), key, func(ctx context.Context) (*tfnsw.DeparturesResponse, error) {
		ctx, cancel := fetchContext(ctx)
		defer cancel()
		return s.upstream.Departures(ctx, from, to, limit)
	})
	if err != nil {
		writeError(w, err)
		return
	}
	writeData(w, departuresCacheControl, result.Stale, result.Value)
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
