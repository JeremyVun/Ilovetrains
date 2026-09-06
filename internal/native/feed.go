package native

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const defaultFeedBaseURL = "https://api.transport.nsw.gov.au"

var feedPaths = map[string]struct {
	schedule string
	realtime string
}{
	"sydneytrains": {"/v1/gtfs/schedule/sydneytrains", "/v2/gtfs/realtime/sydneytrains"},
	"nswtrains":    {"/v1/gtfs/schedule/nswtrains", "/v1/gtfs/realtime/nswtrains"},
	"metro":        {"/v2/gtfs/schedule/metro", "/v2/gtfs/realtime/metro"},
	"ferries":      {"/v1/gtfs/schedule/ferries/sydneyferries", "/v1/gtfs/realtime/ferries/sydneyferries"},
	"mff":          {"/v1/gtfs/schedule/ferries/MFF", "/v1/gtfs/realtime/ferries/MFF"},
}

type Conditional struct {
	ETag         string `json:"etag,omitempty"`
	LastModified string `json:"lastModified,omitempty"`
}

type FetchResult struct {
	Body         []byte
	NotModified  bool
	ETag         string
	LastModified string
}

type FeedFetcher interface {
	FetchRealtime(context.Context, string, Conditional) (FetchResult, error)
	FetchSchedule(context.Context, string, Conditional) (FetchResult, error)
}

type HTTPFeedClient struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

func NewHTTPFeedClient(apiKey, baseURL string, client *http.Client) (*HTTPFeedClient, error) {
	if apiKey == "" {
		return nil, errors.New("native feeds: API key is empty")
	}
	if baseURL == "" {
		baseURL = defaultFeedBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, errors.New("native feeds: invalid base URL")
	}
	if client == nil {
		client = &http.Client{Timeout: 50 * time.Second}
	}
	copy := *client
	copy.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &HTTPFeedClient{baseURL: strings.TrimRight(baseURL, "/"), apiKey: apiKey, client: &copy}, nil
}

func (c *HTTPFeedClient) FetchRealtime(ctx context.Context, source string, condition Conditional) (FetchResult, error) {
	paths, ok := feedPaths[source]
	if !ok {
		return FetchResult{}, errors.New("native feeds: unknown source")
	}
	return c.fetch(ctx, paths.realtime, condition, 16<<20)
}

func (c *HTTPFeedClient) FetchSchedule(ctx context.Context, source string, condition Conditional) (FetchResult, error) {
	paths, ok := feedPaths[source]
	if !ok {
		return FetchResult{}, errors.New("native feeds: unknown source")
	}
	return c.fetch(ctx, paths.schedule, condition, 128<<20)
}

func (c *HTTPFeedClient) fetch(ctx context.Context, path string, condition Conditional, limit int64) (FetchResult, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return FetchResult{}, fmt.Errorf("native feeds: build request: %w", err)
	}
	req.Header.Set("Authorization", "apikey "+c.apiKey)
	req.Header.Set("Accept-Encoding", "identity")
	if condition.ETag != "" {
		req.Header.Set("If-None-Match", condition.ETag)
	}
	if condition.LastModified != "" {
		req.Header.Set("If-Modified-Since", condition.LastModified)
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return FetchResult{}, fmt.Errorf("native feeds: request: %w", err)
	}
	defer resp.Body.Close()
	result := FetchResult{ETag: resp.Header.Get("ETag"), LastModified: resp.Header.Get("Last-Modified")}
	if resp.StatusCode == http.StatusNotModified {
		result.NotModified = true
		return result, nil
	}
	if resp.StatusCode != http.StatusOK {
		return FetchResult{}, fmt.Errorf("native feeds: HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, limit+1))
	if err != nil {
		return FetchResult{}, fmt.Errorf("native feeds: read response: %w", err)
	}
	if int64(len(body)) > limit {
		return FetchResult{}, errors.New("native feeds: response exceeds size limit")
	}
	if len(body) == 0 {
		return FetchResult{}, errors.New("native feeds: empty response")
	}
	if bytes.Contains(body, []byte(c.apiKey)) {
		return FetchResult{}, errors.New("native feeds: credential appeared in response")
	}
	result.Body = body
	return result, nil
}
