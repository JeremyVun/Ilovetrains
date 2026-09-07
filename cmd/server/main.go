// Command server runs the trains_app backend: a stateless caching proxy in
// front of the TfNSW Trip Planner, plus the static client shell.
//
// Configuration is environment only:
//
//	TFNSW_API_KEY   required; never logged, never sent to a client
//	PORT            listen port, default 8080
//	WEB_DIR         static client directory, default ./web (optional)
//	TFNSW_BASE_URL  upstream base, default the TfNSW gateway
//	TFNSW_FEED_BASE_URL schedule/realtime gateway, default TfNSW
//	NATIVE_DATA_DIR writable compiled timetable state, default ./native-data/runtime
//	NATIVE_BOOTSTRAP_DIR packaged initial timetable, default ./native-data/bootstrap
//	TIMETABLE_COMPILER compiler script, default ./tools/compile-timetable.py
//	MIN_CONNECTION_TIME minimum planned transfer, default 3m (Go duration)
//	MAX_CONNECTION_TIME longest planned transfer offered while a later
//	                    departure arrives sooner than that wait ends,
//	                    default 60m (Go duration)
//	FLAGSD_URL      flagsd base URL; with FLAGSD_KEY it enables feature flags
//	FLAGSD_KEY      flagsd read key; never logged
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"trains/internal/api"
	"trains/internal/flagsd"
	"trains/internal/native"
	"trains/internal/tfnsw"
)

const (
	shutdownGrace     = 10 * time.Second
	readHeaderTimeout = 5 * time.Second
	writeTimeout      = 30 * time.Second
	idleTimeout       = 120 * time.Second
)

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	if err := run(); err != nil {
		log.Fatalf("server: %v", err)
	}
}

func run() error {
	apiKey := os.Getenv("TFNSW_API_KEY")
	if apiKey == "" {
		return errors.New("TFNSW_API_KEY is not set")
	}

	client, err := tfnsw.NewClient(apiKey)
	if err != nil {
		return err
	}
	if base := os.Getenv("TFNSW_BASE_URL"); base != "" {
		client.BaseURL = base
	}
	if value := os.Getenv("MIN_CONNECTION_TIME"); value != "" {
		minimum, parseErr := time.ParseDuration(value)
		if parseErr != nil || minimum < 0 {
			return errors.New("MIN_CONNECTION_TIME must be a non-negative Go duration")
		}
		client.MinimumConnectionTime = minimum
	}
	if value := os.Getenv("MAX_CONNECTION_TIME"); value != "" {
		maximum, parseErr := time.ParseDuration(value)
		if parseErr != nil || maximum < 0 {
			return errors.New("MAX_CONNECTION_TIME must be a non-negative Go duration")
		}
		client.MaximumConnectionTime = maximum
	}

	webDir := envOr("WEB_DIR", "./web")
	addr := net.JoinHostPort("", envOr("PORT", "8080"))
	nativeDataDir := envOr("NATIVE_DATA_DIR", "./native-data/runtime")
	feedClient, err := native.NewHTTPFeedClient(apiKey, os.Getenv("TFNSW_FEED_BASE_URL"), nil)
	if err != nil {
		return err
	}
	nativeService, err := native.NewService(native.Config{
		Fetcher:      feedClient,
		DataDir:      nativeDataDir,
		BootstrapDir: envOr("NATIVE_BOOTSTRAP_DIR", "./native-data/bootstrap"),
		CompilerPath: envOr("TIMETABLE_COMPILER", "./tools/compile-timetable.py"),
		Logf:         log.Printf,
	})
	if err != nil {
		return err
	}
	options := []api.Option{api.WithNative(nativeService)}
	flagSource, err := newFlagSource(nativeDataDir)
	if err != nil {
		return err
	}
	if flagSource != nil {
		defer flagSource.Close()
		options = append(options, api.WithFlags(flagSource))
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go nativeService.Run(ctx)

	server := &http.Server{
		Addr:              addr,
		Handler:           withAccessLog(api.New(client, webDir, options...).Handler()),
		ReadHeaderTimeout: readHeaderTimeout,
		WriteTimeout:      writeTimeout,
		IdleTimeout:       idleTimeout,
	}

	listenErr := make(chan error, 1)
	go func() {
		log.Printf("listening on %s (web dir %q)", addr, webDir)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			listenErr <- err
		}
		close(listenErr)
	}()

	select {
	case err := <-listenErr:
		return err
	case <-ctx.Done():
	}

	log.Print("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), shutdownGrace)
	defer cancel()
	return server.Shutdown(shutdownCtx)
}

// newFlagSource returns nil when either variable is unset, which leaves every
// flag at its default.
func newFlagSource(nativeDataDir string) (*flagsd.Client, error) {
	url, key := os.Getenv("FLAGSD_URL"), os.Getenv("FLAGSD_KEY")
	if url == "" || key == "" {
		log.Print("flags disabled (FLAGSD_URL or FLAGSD_KEY unset)")
		return nil, nil
	}
	cacheDir := nativeDataDir
	if cacheDir == "" {
		cacheDir = os.TempDir()
	}
	source, err := flagsd.New(url, key, filepath.Join(cacheDir, "flags-snapshot.json"))
	if err != nil {
		return nil, err
	}
	log.Printf("flags enabled (flagsd at %s)", url)
	return source, nil
}

func envOr(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

// withAccessLog logs method, path, status and duration. Query strings hold only
// stop ids and search text; the API key is never part of a request URL.
func withAccessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(recorder, r)
		log.Printf("%s %s%s %d %s", r.Method, r.URL.Path, querySuffix(r.URL.RawQuery),
			recorder.status, time.Since(started).Round(time.Millisecond))
	})
}

func querySuffix(raw string) string {
	if raw == "" {
		return ""
	}
	return "?" + raw
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
