// Package analytics posts anonymous counters to the shared analytics service
// described in docs/contracts/analytics.md. Every event is a count with
// categorical dimensions; nothing about a request or a rider is carried.
package analytics

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	postTimeout = 5 * time.Second
	maxBatch    = 500
)

type Event struct {
	Type       string            `json:"t"`
	Count      int               `json:"n"`
	Dimensions map[string]string `json:"d,omitempty"`
}

type wireEvent struct {
	Project string `json:"p"`
	Event
}

type Emitter struct {
	endpoint string
	project  string
	key      string
	client   *http.Client
	logf     func(string, ...any)
}

// New returns nil when no endpoint is configured; a nil Emitter drops events.
func New(endpoint, project, key string, logf func(string, ...any)) (*Emitter, error) {
	if endpoint == "" {
		return nil, nil
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		return nil, errors.New("analytics endpoint must be an http(s) URL")
	}
	if project == "" {
		return nil, errors.New("analytics project is required")
	}
	return &Emitter{
		endpoint: strings.TrimRight(endpoint, "/") + "/e", project: project, key: key,
		client: &http.Client{Timeout: postTimeout}, logf: logf,
	}, nil
}

// Emit posts in the background and never reports back to its caller: the
// server's own work must not wait on, or fail with, the analytics service.
func (e *Emitter) Emit(events []Event) {
	if e == nil || len(events) == 0 {
		return
	}
	go e.post(events)
}

func (e *Emitter) post(events []Event) {
	for len(events) > 0 {
		batch := events
		if len(batch) > maxBatch {
			batch = events[:maxBatch]
		}
		events = events[len(batch):]
		if err := e.send(batch); err != nil && e.logf != nil {
			e.logf("analytics: %d events dropped: %v", len(batch), err)
		}
	}
}

func (e *Emitter) send(events []Event) error {
	wire := make([]wireEvent, len(events))
	for i, event := range events {
		wire[i] = wireEvent{Project: e.project, Event: event}
	}
	body, err := json.Marshal(wire)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), postTimeout)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, e.endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/json")
	if e.key != "" {
		request.Header.Set("X-Analytics-Key", e.key)
	}
	response, err := e.client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNoContent {
		return nil
	}
	if response.StatusCode == http.StatusOK {
		var outcome struct {
			Recorded int `json:"recorded"`
			Dropped  int `json:"dropped"`
		}
		if json.NewDecoder(response.Body).Decode(&outcome) == nil && outcome.Dropped > 0 {
			return errors.New("service dropped " + strconv.Itoa(outcome.Dropped) + " of " + strconv.Itoa(len(events)))
		}
		return nil
	}
	return errors.New("service answered " + response.Status)
}

// DeltaBucket names a signed difference in seconds the way every accuracy
// event does, so a dashboard reads one vocabulary for feed and Trip Planner.
func DeltaBucket(seconds int64) string {
	abs := seconds
	if abs < 0 {
		abs = -abs
	}
	var size string
	switch {
	case abs <= 60:
		return "within1"
	case abs <= 120:
		size = "1-2"
	case abs <= 300:
		size = "2-5"
	default:
		size = "5+"
	}
	if seconds < 0 {
		return "early" + size
	}
	return "late" + size
}
