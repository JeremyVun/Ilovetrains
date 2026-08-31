// Command server runs the trains_app backend: a stateless caching proxy in
// front of the TfNSW Trip Planner, plus the static client shell.
//
// Configuration is environment only:
//
//	TFNSW_API_KEY   required; never logged, never sent to a client
//	PORT            listen port, default 8080
//	WEB_DIR         static client directory, default ./web (optional)
//	TFNSW_BASE_URL  upstream base, default the TfNSW gateway
package main

import (
	"context"
	"errors"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"trains/internal/api"
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

	webDir := envOr("WEB_DIR", "./web")
	addr := net.JoinHostPort("", envOr("PORT", "8080"))

	server := &http.Server{
		Addr:              addr,
		Handler:           withAccessLog(api.New(client, webDir).Handler()),
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

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
