// Package flagsd adapts the flagsd Go SDK to the api.Flags seam.
package flagsd

import (
	flags "github.com/JeremyVun/flags/sdk/go"

	"trains/internal/api"
)

const (
	project     = "ilovetrains"
	environment = "production"
	application = "ilovetrains"
)

// flagsd keys must match ^[a-z][a-z0-9_.-]*$, so the camel-case names the API
// publishes are translated here and nowhere else.
var flagsdKeys = map[string]string{"transferLimit": "transfer_limit"}

func flagsdKey(name string) string {
	if key, ok := flagsdKeys[name]; ok {
		return key
	}
	return name
}

type Client struct {
	sdk *flags.Client
}

var _ api.Flags = (*Client)(nil)

// New never blocks on flagsd being reachable; until the first snapshot arrives
// every flag reads the caller's default.
func New(serviceURL, key, cachePath string) (*Client, error) {
	sdk, err := flags.NewClient(flags.Config{
		ServiceURL:     serviceURL,
		Key:            key,
		Project:        project,
		Environment:    environment,
		Application:    application,
		FailMode:       flags.FailDefault,
		StaleThreshold: 0,
		LocalCachePath: cachePath,
	})
	if err != nil {
		return nil, err
	}
	return &Client{sdk: sdk}, nil
}

func (c *Client) Bool(key string, def bool) bool {
	return c.sdk.BoolVariation(flagsdKey(key), flags.EvalContext{}, def)
}

func (c *Client) Version() string { return c.sdk.Version() }

func (c *Client) Close() error { return c.sdk.Close() }
