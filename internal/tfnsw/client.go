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
)

// Client talks to the TfNSW Trip Planner. The API key is held only here and is
// never logged or echoed into a response.
type Client struct {
	BaseURL        string
	HTTPClient     *http.Client
	AttemptTimeout time.Duration
	MaxAttempts    int

	apiKey string
	loc    *time.Location
	now    func() time.Time
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
		BaseURL:        DefaultBaseURL,
		HTTPClient:     &http.Client{},
		AttemptTimeout: defaultAttemptTimeout,
		MaxAttempts:    defaultMaxAttempts,
		apiKey:         apiKey,
		loc:            loc,
		now:            time.Now,
	}, nil
}

// Location is the timezone all served timestamps use.
func (c *Client) Location() *time.Location { return c.loc }

// Stops searches stations by name. Note type_sf=any: type_sf=stop is broken
// upstream ("stop invalid", code -2000), so we filter to stations ourselves.
func (c *Client) Stops(ctx context.Context, query string) (*StopsResponse, error) {
	q := url.Values{}
	q.Set("outputFormat", "rapidJSON")
	q.Set("coordOutputFormat", "EPSG:4326")
	q.Set("type_sf", "any")
	q.Set("name_sf", query)
	q.Set("TfNSWSF", "true")

	body, err := c.get(ctx, "/stop_finder", q)
	if err != nil {
		return nil, err
	}
	return mapStops(body)
}

// Departures returns the next journeys from one station to another.
func (c *Client) Departures(ctx context.Context, from, to string, limit int) (*DeparturesResponse, error) {
	now := c.now()
	local := now.In(c.loc)

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
	q.Set("calcNumberOfTrips", strconv.Itoa(limit))
	q.Set("TfNSWTR", "true")
	// Keep train (1) and metro (2); exclude light rail (4), bus (5), coach (7),
	// ferry (9), On Demand (10) and school bus (11). exclMOT_10 was added
	// 2026-09-01 after On Demand buses were seen routing Rhodes → Bondi
	// Junction; the probe cut that response from 11 journeys to 6, all class 1.
	// mapTrip still drops any journey carrying a class we do not serve, so a
	// future leak degrades to fewer journeys rather than an untakeable one.
	q.Set("excludedMeans", "checkbox")
	for _, mot := range []string{"4", "5", "7", "9", "10", "11"} {
		q.Set("exclMOT_"+mot, "1")
	}

	body, err := c.get(ctx, "/trip", q)
	if err != nil {
		return nil, err
	}
	return mapTrip(body, from, to, limit, now, c.loc)
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
	// Judge success by status and payload only: successful stop_finder
	// responses carry systemMessages entries of type "error".
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
