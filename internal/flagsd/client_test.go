package flagsd

import (
	"path/filepath"
	"testing"

	"trains/internal/api"
)

func TestClientServesDefaultsBeforeAnySnapshot(t *testing.T) {
	client, err := New("http://127.0.0.1:1", "ffk_test", filepath.Join(t.TempDir(), "flags.json"))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	var source api.Flags = client
	if source.Bool("transferLimit", false) {
		t.Error("Bool returned true with no snapshot")
	}
	if !source.Bool("transferLimit", true) {
		t.Error("Bool did not forward the caller's default")
	}
	if version := source.Version(); version != "" {
		t.Errorf("Version = %q, want empty with no snapshot", version)
	}
}

func TestNewRejectsMissingConfiguration(t *testing.T) {
	if _, err := New("", "ffk_test", ""); err == nil {
		t.Error("New accepted an empty service URL")
	}
	if _, err := New("http://127.0.0.1:1", "", ""); err == nil {
		t.Error("New accepted an empty key")
	}
}

func TestPublicNamesMapToFlagsdKeys(t *testing.T) {
	if key := flagsdKey("transferLimit"); key != "transfer_limit" {
		t.Errorf("flagsdKey(transferLimit) = %q, want transfer_limit", key)
	}
	if key := flagsdKey("already.lower"); key != "already.lower" {
		t.Errorf("flagsdKey passed through as %q", key)
	}
}
