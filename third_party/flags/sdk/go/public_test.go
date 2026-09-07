package flags

import (
	"testing"
	"time"

	core "github.com/JeremyVun/flags/server/pkg/flags"
)

func TestAllPublicFlagsVisibilityAndSnapshotChanges(t *testing.T) {
	c := newTestClient(t, Config{})
	ctx := EvalContext{Key: "ilovetrains"}
	if len(c.AllPublicFlags(ctx)) != 0 {
		t.Fatal("unready client exposed flags")
	}
	public := boolFlag("tiny_train", true, "on")
	public.Public = true
	private := stringFlag("private", "never expose")
	broken := boolFlag("broken", true, "missing")
	broken.Public = true
	c.seed(&core.FlagsSnapshot{Version: "1", Flags: []core.Flag{public, private, broken}})
	values := c.AllPublicFlags(ctx)
	if len(values) != 1 || values[public.Key] != true {
		t.Fatalf("public flags: %v", values)
	}
	public.Public = false
	c.seed(&core.FlagsSnapshot{Version: "2", Flags: []core.Flag{public}})
	if len(c.AllPublicFlags(ctx)) != 0 {
		t.Fatal("newly private flag still exposed")
	}
	public.Public = true
	public.Enabled = false
	c.seed(&core.FlagsSnapshot{Version: "3", Flags: []core.Flag{public}})
	if c.AllPublicFlags(ctx)[public.Key] != false {
		t.Fatal("disabled flag enabled")
	}
	c.seed(&core.FlagsSnapshot{Version: "4"})
	if len(c.AllPublicFlags(ctx)) != 0 {
		t.Fatal("deleted flag still exposed")
	}
}

func TestAllPublicFlagsStaleDoesNotLeakLastKnownValues(t *testing.T) {
	c := newTestClient(t, Config{StaleThreshold: time.Second})
	f := boolFlag("tiny_train", true, "on")
	f.Public = true
	c.seed(&core.FlagsSnapshot{Version: "1", Flags: []core.Flag{f}})
	c.lastSync.Store(time.Now().Add(-2 * time.Second).UnixNano())
	if len(c.AllPublicFlags(EvalContext{Key: "app"})) != 0 {
		t.Fatal("stale values exposed")
	}
}
