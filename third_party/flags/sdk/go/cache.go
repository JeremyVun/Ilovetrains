package flags

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	core "github.com/JeremyVun/flags/server/pkg/flags"
)

// loadSnapshot reads a persisted snapshot from path for a warm cold-start
// (CONTRACT §8). It returns (nil, nil) when the file is absent (a normal first
// run); a decode error is returned so the caller can log it and proceed.
func loadSnapshot(path string) (*core.FlagsSnapshot, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("flags: read local cache: %w", err)
	}
	var snap core.FlagsSnapshot
	if err := json.Unmarshal(b, &snap); err != nil {
		return nil, fmt.Errorf("flags: decode local cache: %w", err)
	}
	return &snap, nil
}

// saveSnapshot persists snap to path using an atomic temp+rename so a crash
// mid-write never leaves a torn file (CONTRACT §8). The parent directory must
// exist.
func saveSnapshot(path string, snap *core.FlagsSnapshot) error {
	b, err := json.Marshal(snap)
	if err != nil {
		return fmt.Errorf("flags: encode local cache: %w", err)
	}
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".flags-cache-*.tmp")
	if err != nil {
		return fmt.Errorf("flags: temp local cache: %w", err)
	}
	tmpName := tmp.Name()
	// Best-effort cleanup if anything below fails before the rename.
	defer os.Remove(tmpName)

	if _, err := tmp.Write(b); err != nil {
		tmp.Close()
		return fmt.Errorf("flags: write local cache: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("flags: sync local cache: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("flags: close local cache: %w", err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("flags: rename local cache: %w", err)
	}
	return nil
}
