package main

import (
	"errors"
	"net/url"
	"strings"

	flags "github.com/JeremyVun/flags/sdk/go"
)

// publicFlagsFromEnv starts one background SDK client without delaying boot.
// Evaluation uses a fixed application context; no traveller data leaves the app.
func publicFlagsFromEnv(getenv func(string) string) (func() map[string]any, func(), error) {
	empty := func() map[string]any { return nil }
	noop := func() {}
	base := strings.TrimSpace(getenv("FLAGS_URL"))
	if base == "" {
		return empty, noop, nil
	}
	u, err := url.Parse(base)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, nil, errors.New("FLAGS_URL must be an HTTP(S) base URL without credentials, query or fragment")
	}
	valueOr := func(name, fallback string) string {
		if value := strings.TrimSpace(getenv(name)); value != "" {
			return value
		}
		return fallback
	}
	client, err := flags.NewClient(flags.Config{
		ServiceURL:  base,
		Key:         getenv("FLAGS_KEY"),
		Project:     valueOr("FLAGS_PROJECT", "ilovetrains"),
		Environment: valueOr("FLAGS_ENV", "production"),
		User:        "svc:ilovetrains",
		Application: "ilovetrains-api",
		// Keep the SDK's in-memory last-good snapshot through disconnects.
		// No disk cache: every process starts disabled until its first sync.
	})
	if err != nil {
		return nil, nil, err
	}
	return func() map[string]any {
		return client.AllPublicFlags(flags.EvalContext{Key: "ilovetrains"})
	}, func() { client.Close() }, nil
}
