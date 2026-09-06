package native

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHTTPFeedClientUsesConditionalRequestWithoutLeakingKey(t *testing.T) {
	var authorization, ifNoneMatch, ifModifiedSince string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authorization = r.Header.Get("Authorization")
		ifNoneMatch = r.Header.Get("If-None-Match")
		ifModifiedSince = r.Header.Get("If-Modified-Since")
		w.Header().Set("ETag", `"next"`)
		w.WriteHeader(http.StatusNotModified)
	}))
	defer upstream.Close()
	client, err := NewHTTPFeedClient("private-key", upstream.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	got, err := client.FetchRealtime(context.Background(), "metro", Conditional{ETag: `"old"`, LastModified: "yesterday"})
	if err != nil {
		t.Fatal(err)
	}
	if !got.NotModified || got.ETag != `"next"` {
		t.Fatalf("result = %+v", got)
	}
	if authorization != "apikey private-key" || ifNoneMatch != `"old"` || ifModifiedSince != "yesterday" {
		t.Fatalf("headers = %q %q %q", authorization, ifNoneMatch, ifModifiedSince)
	}
}

func TestHTTPFeedClientDoesNotFollowRedirectWithAuthorization(t *testing.T) {
	credentialReachedTarget := false
	target := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		credentialReachedTarget = r.Header.Get("Authorization") != ""
	}))
	defer target.Close()
	redirector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Redirect(w, &http.Request{}, target.URL, http.StatusFound)
	}))
	defer redirector.Close()
	client, _ := NewHTTPFeedClient("private-key", redirector.URL, nil)
	if _, err := client.FetchRealtime(context.Background(), "mff", Conditional{}); err == nil {
		t.Fatal("accepted redirect response")
	}
	if credentialReachedTarget {
		t.Fatal("authorization reached redirect target")
	}
}

func TestHTTPFeedClientRejectsUnknownSourceBeforeNetwork(t *testing.T) {
	client, _ := NewHTTPFeedClient("private-key", "https://example.invalid", nil)
	if _, err := client.FetchRealtime(context.Background(), "../secret", Conditional{}); err == nil {
		t.Fatal("accepted unknown source")
	}
}

func TestHTTPFeedClientRejectsCredentialEcho(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("prefix private-key suffix"))
	}))
	defer upstream.Close()
	client, _ := NewHTTPFeedClient("private-key", upstream.URL, nil)
	if _, err := client.FetchRealtime(context.Background(), "metro", Conditional{}); err == nil {
		t.Fatal("accepted credential echo")
	}
}
