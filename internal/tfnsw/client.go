// Package tfnsw is the client for the Transport for NSW Trip Planner API and
// the mapping from its responses to the shapes in docs/contracts/api.md.
package tfnsw

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// DefaultBaseURL is the verified TfNSW Open Data gateway base.
const DefaultBaseURL = "https://api.transport.nsw.gov.au/v1/tp"

// TimeZone is the only timezone this service reports times in.
const TimeZone = "Australia/Sydney"

// Failure modes the API layer maps onto the error contract.
var (
	// ErrUpstream means TfNSW erred or returned something unusable (502).
	ErrUpstream = errors.New("upstream unavailable")
	// ErrTimeout means TfNSW did not answer in time (504).
	ErrTimeout = errors.New("upstream timeout")
)

const (
	defaultAttemptTimeout = 8 * time.Second
	defaultMaxAttempts    = 2
	maxResponseBytes      = 8 << 20
	// DefaultMinimumConnectionTime is the planning floor, not a warning
	// threshold. A journey below it is never offered.
	DefaultMinimumConnectionTime = 3 * time.Minute
	// DefaultMaximumConnectionTime is the planning ceiling. A journey whose
	// change exceeds it is offered only when nothing later arrives before
	// that wait would have ended; see pruneLongWaits.
	DefaultMaximumConnectionTime = 60 * time.Minute
)

// Client talks to the TfNSW Trip Planner. The API key is held only here and is
// never logged or echoed into a response.
type Client struct {
	BaseURL               string
	HTTPClient            *http.Client
	AttemptTimeout        time.Duration
	MaxAttempts           int
	MinimumConnectionTime time.Duration
	MaximumConnectionTime time.Duration

	apiKey string
	loc    *time.Location
	now    func() time.Time
}

// NoTransferLimit leaves the change count uncapped; the zero value would cap
// at direct journeys only.
const NoTransferLimit = -1

// DeparturesOptions controls which journeys may be served.
type DeparturesOptions struct {
	Modes         []Mode
	TransferLimit int
}

// NewClient returns a client for the given API key, loading the Sydney
// timezone up front so a broken tzdata fails at startup, not per request.
func NewClient(apiKey string) (*Client, error) {
	if apiKey == "" {
		return nil, errors.New("tfnsw: API key is empty")
	}
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		return nil, fmt.Errorf("tfnsw: loading %s: %w", TimeZone, err)
	}
	return &Client{
		BaseURL:               DefaultBaseURL,
		HTTPClient:            &http.Client{},
		AttemptTimeout:        defaultAttemptTimeout,
		MaxAttempts:           defaultMaxAttempts,
		MinimumConnectionTime: DefaultMinimumConnectionTime,
		MaximumConnectionTime: DefaultMaximumConnectionTime,
		apiKey:                apiKey,
		loc:                   loc,
		now:                   time.Now,
	}, nil
}

// Location is the timezone all served timestamps use.
func (c *Client) Location() *time.Location { return c.loc }

// Departures returns the journeys from one station to another departing at or
// after `at`. A zero `at` means now.
//
// Upstream answers for past itdDate/itdTime and, for the recent past, answers
// with realtime actuals rather than the timetable (verified 2026-09-01; see
// docs/references/tfnsw-open-data.md). The realtime gate in mapTrip is what
// keeps an aged-out window honest: once upstream forgets a service was
// monitored, `estimated` goes null instead of echoing the timetable back as if
// it were live.
func (c *Client) Departures(ctx context.Context, from, to string, limit int, at time.Time) (*DeparturesResponse, error) {
	return c.DeparturesWithOptions(ctx, from, to, limit, at, DeparturesOptions{TransferLimit: NoTransferLimit})
}

// DeparturesWithOptions returns journeys whose every service leg is allowed.
func (c *Client) DeparturesWithOptions(ctx context.Context, from, to string, limit int, at time.Time,
	options DeparturesOptions) (*DeparturesResponse, error) {
	modes, err := CanonicalModes(options.Modes)
	if err != nil {
		return nil, fmt.Errorf("tfnsw: modes: %w", err)
	}
	now := c.now()
	if len(modes) == 0 {
		return emptyDepartures(from, to, at, now, c.loc), nil
	}
	window := at
	if window.IsZero() {
		window = now
	}
	local := window.In(c.loc)

	q := url.Values{}
	q.Set("outputFormat", "rapidJSON")
	q.Set("coordOutputFormat", "EPSG:4326")
	q.Set("depArrMacro", "dep")
	q.Set("itdDate", local.Format("20060102"))
	q.Set("itdTime", local.Format("1504"))
	q.Set("type_origin", "any")
	q.Set("name_origin", from)
	q.Set("type_destination", "any")
	q.Set("name_destination", to)
	// Ask for spare candidates because unsafe connections are dropped before
	// the public limit is applied.
	upstreamLimit := limit * 2
	if upstreamLimit < 10 {
		upstreamLimit = 10
	}
	q.Set("calcNumberOfTrips", strconv.Itoa(upstreamLimit))
	q.Set("TfNSWTR", "true")
	q.Set("excludedMeans", "checkbox")
	addModeExclusions(q, modes)

	body, err := c.get(ctx, "/trip", q)
	if err != nil {
		return nil, err
	}
	// generatedAt stays the fetch time, not the window: a client must always be
	// able to compute how old the data it is showing is, including for a past
	// window whose rows are hours older than the response.
	policy := connectionPolicy{Minimum: c.MinimumConnectionTime, Maximum: c.MaximumConnectionTime}
	resp, err := mapTripWithOptions(body, from, to, limit, now, c.loc, policy,
		DeparturesOptions{Modes: modes, TransferLimit: options.TransferLimit})
	if err != nil {
		return nil, err
	}
	resp.At = formatTimePtr(at, c.loc)
	return resp, nil
}

func addModeExclusions(q url.Values, modes []Mode) {
	excluded := []int{4, 5, 7, 10, 11}
	for mode, class := range map[Mode]int{
		ModeTrain: classTrain,
		ModeMetro: classMetro,
		ModeFerry: classFerry,
	} {
		if !containsMode(modes, mode) {
			excluded = append(excluded, class)
		}
	}
	for _, class := range excluded {
		q.Set("exclMOT_"+strconv.Itoa(class), "1")
	}
}

func containsMode(modes []Mode, want Mode) bool {
	for _, mode := range modes {
		if mode == want {
			return true
		}
	}
	return false
}

func (c *Client) get(ctx context.Context, path string, query url.Values) ([]byte, error) {
	endpoint := c.BaseURL + path + "?" + query.Encode()

	attempts := c.MaxAttempts
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	for attempt := range attempts {
		if attempt > 0 && ctx.Err() != nil {
			break
		}
		body, retryable, err := c.attempt(ctx, endpoint)
		if err == nil {
			return body, nil
		}
		lastErr = err
		if !retryable {
			break
		}
	}
	return nil, lastErr
}

// attempt makes one upstream request. It reports whether the failure is worth
// spending another request from the TfNSW quota on.
func (c *Client) attempt(ctx context.Context, endpoint string) (body []byte, retryable bool, err error) {
	timeout := c.AttemptTimeout
	if timeout <= 0 {
		timeout = defaultAttemptTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, false, fmt.Errorf("%w: building request: %v", ErrUpstream, err)
	}
	req.Header.Set("Authorization", "apikey "+c.apiKey)
	req.Header.Set("Accept", "application/json")

	client := c.HTTPClient
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, true, classify(err)
	}
	defer resp.Body.Close()

	body, err = io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if err != nil {
		return nil, true, classify(err)
	}
	// Judge success by status and payload only: successful responses carry
	// systemMessages entries of type "error".
	if resp.StatusCode != http.StatusOK {
		return nil, retryableStatus(resp.StatusCode),
			fmt.Errorf("%w: HTTP %d", ErrUpstream, resp.StatusCode)
	}
	if len(body) == 0 {
		return nil, true, fmt.Errorf("%w: empty response body", ErrUpstream)
	}
	return body, false, nil
}

// retryableStatus reports whether a status is worth one more request. A 4xx
// other than 429 means our request was wrong; retrying just burns quota.
func retryableStatus(status int) bool {
	return status == http.StatusTooManyRequests || status >= 500
}

// classify turns a transport-level failure into one of our two error kinds so
// the handler can pick 502 vs 504.
func classify(err error) error {
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("%w: %v", ErrTimeout, err)
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return fmt.Errorf("%w: %v", ErrTimeout, err)
	}
	return fmt.Errorf("%w: %v", ErrUpstream, err)
}
