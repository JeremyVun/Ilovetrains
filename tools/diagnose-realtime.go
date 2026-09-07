// Replay captured protobuf feeds through the production normalizer without credentials.
// Usage: go run tools/diagnose-realtime.go /path/to/capture-directory
package main

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
	"trains/internal/native"
)

func main() {
	if len(os.Args) < 2 || len(os.Args) > 3 {
		panic("usage: diagnose-realtime <capture-directory> [bootstrap-directory]")
	}
	bootstrap := "native-data/bootstrap"
	if len(os.Args) == 3 {
		bootstrap = os.Args[2]
	}
	dates, err := native.LoadServiceDates(bootstrap)
	check(err)
	metadata, err := os.ReadFile(filepath.Join(os.Args[1], "capture.json"))
	check(err)
	var records []struct {
		File       string
		SHA256     string
		ReceivedAt time.Time
	}
	check(json.Unmarshal(metadata, &records))
	type evidence struct {
		hash       string
		receivedAt time.Time
	}
	verified := map[string]evidence{}
	for _, record := range records {
		verified[record.File] = evidence{record.SHA256, record.ReceivedAt}
	}
	files := 0
	fmt.Fprintf(os.Stderr, "trip index entries: %d\n", dates.Len())
	for _, source := range []string{"sydneytrains", "nswtrains", "metro", "ferries", "mff"} {
		paths, err := filepath.Glob(filepath.Join(os.Args[1], source+"-[0-9]*.pb"))
		check(err)
		for _, path := range paths {
			files++
			body, err := os.ReadFile(path)
			check(err)
			capture, ok := verified[filepath.Base(path)]
			if !ok || capture.receivedAt.IsZero() || fmt.Sprintf("%x", sha256.Sum256(body)) != capture.hash {
				panic("missing metadata or hash mismatch: " + filepath.Base(path))
			}
			var feed gtfs.FeedMessage
			check(proto.Unmarshal(body, &feed))
			header := time.Unix(int64(feed.GetHeader().GetTimestamp()), 0).UTC()
			snapshot, _, resolution, err := native.NormalizeRealtime(source, body, capture.receivedAt, dates)
			check(err)
			counts := map[string]int{}
			for _, entity := range feed.Entity {
				u := entity.GetTripUpdate()
				if u == nil {
					continue
				}
				counts["rawUpdates"]++
				counts["status:"+u.GetTrip().GetScheduleRelationship().String()]++
				if u.GetTrip().GetStartDate() == "" {
					counts["missingStartDate"]++
				}
				if u.Timestamp != nil && u.GetTimestamp() != 0 {
					age := int64(feed.GetHeader().GetTimestamp()) - int64(u.GetTimestamp())
					if age > 90 {
						counts["tripTimestampOlderThan90s"]++
					}
					if age < -5 {
						counts["tripTimestampMoreThan5sAhead"]++
					}
				}
			}
			counts["normalizedUpdates"] = len(snapshot.Updates)
			counts["resolverUnknown"] = resolution.Unknown
			counts["resolverAmbiguous"] = resolution.Ambiguous
			counts["resolverStale"] = resolution.Stale
			counts["resolverDuplicate"] = resolution.Duplicate
			// Diagnostic only: inject an arbitrary valid date to isolate the next gate.
			// This is NOT a proposed service-date resolver; no modified feed is saved.
			for _, entity := range feed.Entity {
				if u := entity.GetTripUpdate(); u != nil && u.Trip != nil && u.Trip.GetStartDate() == "" {
					u.Trip.StartDate = proto.String("20000101")
				}
			}
			modified, err := proto.Marshal(&feed)
			check(err)
			counterfactual, _, _, err := native.NormalizeRealtime(source, modified, capture.receivedAt, dates)
			check(err)
			counts["dateGateOnlyBypassedDiagnostic"] = len(counterfactual.Updates)
			out, err := json.Marshal(map[string]any{"file": filepath.Base(path), "sha256": capture.hash, "headerTimestamp": header, "freshAtCapture": capture.receivedAt.Before(snapshot.ExpiresAt), "counts": counts})
			check(err)
			fmt.Println(string(out))
		}
	}
	if files == 0 {
		panic("no captured realtime protobuf files found")
	}
}

func check(err error) {
	if err != nil {
		panic(err)
	}
}
