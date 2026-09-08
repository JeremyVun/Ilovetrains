package analytics

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

func TestEmitPostsProjectTaggedCountersAndReportsDrops(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	var keys []string
	status := http.StatusNoContent
	service := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(body))
		keys = append(keys, r.Header.Get("X-Analytics-Key"))
		mu.Unlock()
		if r.URL.Path != "/e" || r.Header.Get("Content-Type") != "application/json" {
			t.Errorf("unexpected request %s %s", r.URL.Path, r.Header.Get("Content-Type"))
		}
		w.WriteHeader(status)
		if status == http.StatusOK {
			fmt.Fprint(w, `{"recorded":0,"dropped":1}`)
		}
	}))
	defer service.Close()

	var logged []string
	emitter, err := New(service.URL+"/", "ilovetrains", "k", func(format string, args ...any) {
		logged = append(logged, fmt.Sprintf(format, args...))
	})
	if err != nil {
		t.Fatal(err)
	}
	emitter.Emit([]Event{{Type: "feed_prediction_scored", Count: 3, Dimensions: map[string]string{"source": "metro", "lead": "0-2m"}}})
	waitFor(t, func() bool { mu.Lock(); defer mu.Unlock(); return len(bodies) == 1 })
	var wire []map[string]any
	if err := json.Unmarshal([]byte(bodies[0]), &wire); err != nil {
		t.Fatal(err)
	}
	if len(wire) != 1 || wire[0]["p"] != "ilovetrains" || wire[0]["t"] != "feed_prediction_scored" || wire[0]["n"] != float64(3) || keys[0] != "k" {
		t.Errorf("wire = %s key=%q", bodies[0], keys[0])
	}
	if _, present := wire[0]["u"]; present {
		t.Errorf("a unit id reached the wire")
	}

	status = http.StatusOK
	emitter.Emit([]Event{{Type: "x", Count: 1}})
	waitFor(t, func() bool { return len(logged) == 1 })
	if logged[0] != "analytics: 1 events dropped: service dropped 1 of 1" {
		t.Errorf("drop log = %q", logged[0])
	}
}

func TestNilEmitterAndBadConfig(t *testing.T) {
	var emitter *Emitter
	emitter.Emit([]Event{{Type: "x"}})
	if e, err := New("", "p", "", nil); e != nil || err != nil {
		t.Errorf("unset endpoint should be a nil emitter, got %v %v", e, err)
	}
	if _, err := New("ftp://x", "p", "", nil); err == nil {
		t.Error("ftp endpoint accepted")
	}
	if _, err := New("http://x", "", "", nil); err == nil {
		t.Error("empty project accepted")
	}
}

func TestDeltaBucket(t *testing.T) {
	cases := map[int64]string{0: "within1", 60: "within1", -60: "within1", 61: "late1-2", -61: "early1-2",
		120: "late1-2", 121: "late2-5", -300: "early2-5", 301: "late5+", -9999: "early5+"}
	for seconds, want := range cases {
		if got := DeltaBucket(seconds); got != want {
			t.Errorf("DeltaBucket(%d) = %q, want %q", seconds, got, want)
		}
	}
}

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met")
		}
		time.Sleep(5 * time.Millisecond)
	}
}
