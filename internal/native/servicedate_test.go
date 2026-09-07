package native

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func testServiceDates(t *testing.T, trips map[string]tripCalendar) *ServiceDates {
	t.Helper()
	location, err := time.LoadLocation(sydneyZone)
	if err != nil {
		t.Fatal(err)
	}
	return &ServiceDates{trips: trips, location: location}
}

func sydneyTime(t *testing.T, year int, month time.Month, day, hour, minute int) time.Time {
	t.Helper()
	location, err := time.LoadLocation(sydneyZone)
	if err != nil {
		t.Fatal(err)
	}
	return time.Date(year, month, day, hour, minute, 0, 0, location)
}

func TestResolveServiceDatePicksTheRunningInstance(t *testing.T) {
	const everyDay = uint8(0b1111111)
	dates := testServiceDates(t, map[string]tripCalendar{
		"sydneytrains\x00late":     {firstDepartureSecs: 90600, startDate: 20260901, endDate: 20261031, weekdays: everyDay},
		"sydneytrains\x00friday":   {firstDepartureSecs: 84600, startDate: 20260901, endDate: 20261031, weekdays: 1 << 4},
		"sydneytrains\x00morning":  {firstDepartureSecs: 21600, startDate: 20260901, endDate: 20261031, weekdays: everyDay},
		"sydneytrains\x00saturday": {firstDepartureSecs: 21600, startDate: 20260901, endDate: 20261031, weekdays: 1 << 5},
		"sydneytrains\x00suspended": {firstDepartureSecs: 21600, startDate: 20260901, endDate: 20261031, weekdays: everyDay,
			removed: []int32{20260906}},
		"sydneytrains\x00special": {firstDepartureSecs: 21600, startDate: 20260901, endDate: 20260902, weekdays: 0,
			added: []int32{20260906}},
		"sydneytrains\x00overnight": {firstDepartureSecs: 95400, startDate: 20260901, endDate: 20261031, weekdays: everyDay},
	})

	cases := []struct {
		name     string
		trip     string
		header   time.Time
		stopTime time.Time
		want     string
		outcome  dateOutcome
	}{
		{name: "after midnight belongs to the previous service day", trip: "late",
			header: sydneyTime(t, 2026, time.September, 6, 1, 33), want: "20260905"},
		{name: "the same trip late in the evening belongs to today", trip: "late",
			header: sydneyTime(t, 2026, time.September, 6, 23, 0), want: "20260906"},
		{name: "a Friday-only trip seen on Saturday morning ran on Friday", trip: "friday",
			header: sydneyTime(t, 2026, time.September, 5, 0, 30), want: "20260904"},
		{name: "an absolute stop time outvotes the header", trip: "morning",
			header:   sydneyTime(t, 2026, time.September, 6, 1, 33),
			stopTime: sydneyTime(t, 2026, time.September, 5, 7, 0), want: "20260905"},
		{name: "the header decides when no stop time is given", trip: "morning",
			header: sydneyTime(t, 2026, time.September, 6, 1, 33), want: "20260906"},
		{name: "a removed date is not a candidate", trip: "suspended",
			header: sydneyTime(t, 2026, time.September, 6, 7, 0), want: "20260907"},
		{name: "an added date is a candidate outside the calendar range", trip: "special",
			header: sydneyTime(t, 2026, time.September, 6, 5, 30), want: "20260906"},
		{name: "daylight saving does not move the service day", trip: "overnight",
			header: sydneyTime(t, 2026, time.October, 4, 3, 40), want: "20261003"},
		{name: "an instance outside the header window is ambiguous", trip: "saturday",
			header: sydneyTime(t, 2026, time.September, 6, 1, 33), outcome: dateAmbiguous},
		{name: "a stop time far from every instance is ambiguous", trip: "morning",
			header:   sydneyTime(t, 2026, time.September, 6, 1, 33),
			stopTime: sydneyTime(t, 2026, time.September, 6, 15, 0), outcome: dateAmbiguous},
		{name: "a trip absent from the index is unknown", trip: "ghost",
			header: sydneyTime(t, 2026, time.September, 6, 1, 33), outcome: dateUnknown},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			date, outcome := dates.resolve("sydneytrains", test.trip, test.header, test.stopTime)
			if outcome != test.outcome || date != test.want {
				t.Fatalf("resolve = %q/%d, want %q/%d", date, outcome, test.want, test.outcome)
			}
		})
	}
}

func TestResolveServiceDateWithoutAnIndexIsUnknown(t *testing.T) {
	header := sydneyTime(t, 2026, time.September, 6, 1, 33)
	for name, dates := range map[string]*ServiceDates{"nil": nil, "empty": {}} {
		t.Run(name, func(t *testing.T) {
			if _, outcome := dates.resolve("sydneytrains", "late", header, time.Time{}); outcome != dateUnknown {
				t.Fatalf("outcome = %d, want unknown", outcome)
			}
		})
	}
}

func TestNearestInstanceRejectsAnEqualDistanceTie(t *testing.T) {
	target := sydneyTime(t, 2026, time.September, 6, 12, 0)
	tied := []serviceInstance{
		{date: "20260905", start: target.Add(-2 * time.Hour)},
		{date: "20260906", start: target.Add(2 * time.Hour)},
	}
	if date, outcome := nearestInstance(tied, target, 6*time.Hour, 24*time.Hour); outcome != dateAmbiguous {
		t.Fatalf("tie resolved to %q/%d, want ambiguous", date, outcome)
	}
	closer := append(tied, serviceInstance{date: "20260907", start: target.Add(time.Hour)})
	if date, outcome := nearestInstance(closer, target, 6*time.Hour, 24*time.Hour); outcome != dateResolved || date != "20260907" {
		t.Fatalf("nearest = %q/%d, want 20260907", date, outcome)
	}
}

func writeTestTripIndex(t *testing.T, dir string, rows []string) TripIndex {
	t.Helper()
	var buffer bytes.Buffer
	writer, err := gzip.NewWriterLevel(&buffer, gzip.BestCompression)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		if _, err := writer.Write([]byte(row + "\n")); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(buffer.Bytes())
	index := TripIndex{Name: "trip-index-" + hex.EncodeToString(sum[:]) + ".tsv.gz", SHA256: hex.EncodeToString(sum[:])}
	if err := os.WriteFile(filepath.Join(dir, index.Name), buffer.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
	return index
}

func TestLoadServiceDatesReadsTheSidecarAndVerifiesItsHash(t *testing.T) {
	dir := t.TempDir()
	index := writeTestTripIndex(t, dir, []string{
		"sydneytrains\tlate\t90600\t20260901\t20261031\t127\t\t",
		"metro\tM1\t21600\t20260901\t20261031\t31\t20260906\t20260907",
	})
	manifest, err := json.Marshal(Manifest{TripIndex: &index})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	dates, err := LoadServiceDates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if dates.Len() != 2 {
		t.Fatalf("entries = %d, want 2", dates.Len())
	}
	if date, outcome := dates.resolve("sydneytrains", "late", sydneyTime(t, 2026, time.September, 6, 1, 33), time.Time{}); outcome != dateResolved || date != "20260905" {
		t.Fatalf("resolve = %q/%d", date, outcome)
	}
	metro := dates.trips["metro\x00M1"]
	if len(metro.added) != 1 || metro.added[0] != 20260906 || len(metro.removed) != 1 || metro.removed[0] != 20260907 {
		t.Fatalf("exceptions = %+v", metro)
	}

	if err := os.WriteFile(filepath.Join(dir, index.Name), []byte("corrupted"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadServiceDates(dir); err == nil {
		t.Fatal("accepted a trip index that does not match its manifest hash")
	}
}

func TestLoadServiceDatesWithoutASidecarIsEmpty(t *testing.T) {
	dir := t.TempDir()
	manifest, _ := json.Marshal(Manifest{})
	if err := os.WriteFile(filepath.Join(dir, "manifest.json"), manifest, 0o644); err != nil {
		t.Fatal(err)
	}
	dates, err := LoadServiceDates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if dates.Len() != 0 {
		t.Fatalf("entries = %d, want 0", dates.Len())
	}
}
