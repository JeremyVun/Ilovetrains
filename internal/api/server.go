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
	"strings"
	"time"

	"trains/internal/cache"
	"trains/internal/native"
	"trains/internal/stations"
	"trains/internal/tfnsw"
)

// Upstream is the part of the TfNSW client the handlers need. Handler tests
// substitute a fake so no test touches the network.
type Upstream interface {
	DeparturesWithOptions(ctx context.Context, from, to string, limit int, at time.Time,
		options tfnsw.DeparturesOptions) (*tfnsw.DeparturesResponse, error)
}

// Cache lifetimes. The in-memory TTLs mirror the s-maxage the contract
// advertises to the CDN, so an origin behind a cold CDN still costs at most one
// upstream call per key per TTL.
const (
	departuresTTL = 30 * time.Second

	// A settled past window does not change, so it is cached for an hour and
	// the CDN is told it may keep it for one. Caching it is not only cheap but
	// better: upstream drops realtime actuals from a window a few hours after
	// it passes, so the cached copy taken while the actuals were still there is
	// the more truthful answer.
	departuresPastTTL = time.Hour

	// A past window has already happened, so a day-old copy of it is exactly as
	// true as a fresh fetch — matching the stale-while-revalidate we advertise.
	departuresStaleWindow     = 10 * time.Minute
	departuresPastStaleWindow = 24 * time.Hour

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
	// in it has departed. Departure alone does not settle a window: an old
	// bucket can still hold a train that has not arrived.
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

// stopsLimit caps a station search. The index is small and the setup sheet
// shows a short list.
const stopsLimit = 10

// Server holds the caches and upstream client shared by all requests. It holds
// no per-user state: every response is a pure function of the query string.
type Server struct {
	upstream Upstream
	// cache.Cache holds one TTL, and the hour store is only ever filled by promotion.
	departures     *cache.Cache[*tfnsw.DeparturesResponse]
	departuresPast *cache.Cache[*tfnsw.DeparturesResponse]
	webDir         string
	loc            *time.Location
	now            func() time.Time
	native         *native.Service
}

type Option func(*Server)

func WithNative(service *native.Service) Option {
	return func(server *Server) { server.native = service }
}

// New returns a server serving the API plus, if webDir exists, the static
// client at /.
func New(upstream Upstream, webDir string, options ...Option) *Server {
	loc, err := time.LoadLocation(tfnsw.TimeZone)
	if err != nil {
		panic(err)
	}
	server := &Server{
		upstream:       upstream,
		departures:     cache.New[*tfnsw.DeparturesResponse](departuresTTL, departuresStaleWindow),
		departuresPast: cache.New[*tfnsw.DeparturesResponse](departuresPastTTL, departuresPastStaleWindow),
		webDir:         webDir,
		loc:            loc,
		now:            time.Now,
	}
	for _, option := range options {
		option(server)
	}
	return server
}

// Handler returns the routed, CORS-wrapped handler for the whole service.
func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/departures", s.handleDepartures)
	mux.HandleFunc("GET /api/v1/stops", s.handleStops)
	if s.native != nil {
		mux.HandleFunc("GET /api/v1/timetable/manifest", s.handleTimetableManifest)
		mux.HandleFunc("GET /api/v1/timetable/packages/{package}", s.handleTimetablePackage)
		mux.HandleFunc("GET /api/v1/realtime/{source}", s.handleRealtime)
	}
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
	_ = mime.AddExtensionType(".apk", "application/vnd.android.package-archive")

	if info, err := os.Stat(s.webDir); err != nil || !info.IsDir() {
		// The client is built in a later phase; until then / is simply empty.
		return http.HandlerFunc(handleNotFound)
	}
	fs := http.FileServer(http.Dir(s.webDir))
	// HTTP caches must not mix releases; the versioned worker owns shell caching.
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		// Build timestamps can move backwards while module content changes.
		r = r.Clone(r.Context())
		r.Header.Del("If-Modified-Since")
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
	modes, err := journeyModes(query["modes"])
	if err != nil {
		writeError(w, err)
		return
	}

	// The bucket is part of the key, so a past page and the live board never
	// share an entry, and asking for the current bucket explicitly is a
	// different answer (it echoes `at`) from asking for now.
	key := from + "|" + to + "|" + strconv.Itoa(limit) + "|" + bucketKey(at) + "|" + modesKey(modes)
	past := settledBucket(at, now)
	if response, ok := s.departuresPast.Get(key); past && ok {
		writeData(w, departuresPastCacheControl, false, response)
		return
	}

	result, err := s.departures.Do(r.Context(), key, func(ctx context.Context) (*tfnsw.DeparturesResponse, error) {
		if len(modes) == 0 {
			return s.emptyDepartures(from, to, at, now), nil
		}
		ctx, cancel := fetchContext(ctx)
		defer cancel()
		return s.upstream.DeparturesWithOptions(ctx, from, to, limit, at, tfnsw.DeparturesOptions{Modes: modes})
	})
	if err != nil {
		if response, ok := s.departuresPast.Stale(key); past && ok {
			writeData(w, departuresPastCacheControl, true, response)
			return
		}
		writeError(w, err)
		return
	}

	cacheControl := departuresCacheControl
	// A stale answer is what upstream could not confirm, so it never becomes
	// the hour-long copy of a window.
	if past && !result.Stale && allJourneysArrived(result.Value, now) {
		s.departuresPast.Put(key, result.Value)
		cacheControl = departuresPastCacheControl
	}
	writeData(w, cacheControl, result.Stale, result.Value)
}

func (s *Server) emptyDepartures(from, to string, at, generatedAt time.Time) *tfnsw.DeparturesResponse {
	response := &tfnsw.DeparturesResponse{
		From:        tfnsw.Place{ID: from},
		To:          tfnsw.Place{ID: to},
		GeneratedAt: generatedAt.In(s.loc).Format(time.RFC3339),
		Journeys:    []tfnsw.Journey{},
	}
	if !at.IsZero() {
		echoed := at.In(s.loc).Format(time.RFC3339)
		response.At = &echoed
	}
	return response
}

func modesKey(modes []tfnsw.Mode) string {
	parts := make([]string, len(modes))
	for i, mode := range modes {
		parts[i] = string(mode)
	}
	return strings.Join(parts, ",")
}

// A zero `at` is the live board and never a candidate for the hour store.
func settledBucket(at, now time.Time) bool {
	return !at.IsZero() && at.Before(now.Add(-settledAge))
}

// An unreadable arrival is no evidence of one, so it keeps the window live.
func allJourneysArrived(response *tfnsw.DeparturesResponse, now time.Time) bool {
	for _, journey := range response.Journeys {
		if journey.Cancelled {
			continue
		}
		arrival := journey.Arrival.Scheduled
		if journey.Arrival.Estimated != nil {
			arrival = *journey.Arrival.Estimated
		}
		parsed, err := time.Parse(time.RFC3339, arrival)
		if err != nil || parsed.After(now) {
			return false
		}
	}
	return true
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
	writeData(w, stopsCacheControl, false, StopsResponse{Stops: stations.Search(query, stopsLimit)})
}

// StopsResponse is the body of GET /api/v1/stops.
type StopsResponse struct {
	Stops []stations.Stop `json:"stops"`
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
