package tfnsw

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Golden tests run against the real TfNSW responses captured on 2026-08-31 by
// tools/probe-tfnsw.sh. No test in this package touches the network.

func fixture(t *testing.T, name string) []byte {
	t.Helper()
	body, err := os.ReadFile(filepath.Join("..", "..", "tools", "fixtures", name))
	if err != nil {
		t.Fatalf("reading fixture: %v", err)
	}
	return body
}

func sydney(t *testing.T) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(TimeZone)
	if err != nil {
		t.Fatalf("loading %s: %v", TimeZone, err)
	}
	return loc
}

func mustParse(t *testing.T, value string) time.Time {
	t.Helper()
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		t.Fatalf("parsing %q: %v", value, err)
	}
	return parsed
}

func TestMapStopsCentral(t *testing.T) {
	got, err := mapStops(fixture(t, "stop_finder_central.json"))
	if err != nil {
		t.Fatalf("mapStops: %v", err)
	}
	// The fixture holds 8 locations: one station, plus POIs, a street and an
	// Adelaide coach stop (modes [7]) that must all be filtered out.
	if len(got.Stops) != 1 {
		t.Fatalf("stops = %d, want 1: %+v", len(got.Stops), got.Stops)
	}
	stop := got.Stops[0]
	if stop.ID != "200060" {
		t.Errorf("id = %q, want 200060", stop.ID)
	}
	if stop.Name != "Central Station" {
		t.Errorf("name = %q, want %q", stop.Name, "Central Station")
	}
	// Upstream modes are [1,2,4,5,7,11]; only train and metro are served.
	if len(stop.Modes) != 2 || stop.Modes[0] != "train" || stop.Modes[1] != "metro" {
		t.Errorf("modes = %v, want [train metro]", stop.Modes)
	}
}

func TestMapStopsParramatta(t *testing.T) {
	got, err := mapStops(fixture(t, "stop_finder_parramatta.json"))
	if err != nil {
		t.Fatalf("mapStops: %v", err)
	}
	if len(got.Stops) != 1 {
		t.Fatalf("stops = %d, want 1: %+v", len(got.Stops), got.Stops)
	}
	stop := got.Stops[0]
	if stop.ID != "215020" || stop.Name != "Parramatta Station" {
		t.Errorf("stop = %+v, want id 215020 / Parramatta Station", stop)
	}
	// Upstream modes are [1,5,11]: train, bus, school bus.
	if len(stop.Modes) != 1 || stop.Modes[0] != "train" {
		t.Errorf("modes = %v, want [train]", stop.Modes)
	}
}

func TestMapStopsEmptyResultIsNotAnError(t *testing.T) {
	// A no-match stop_finder response still carries a type:"error"
	// systemMessage; it must map to an empty list, not a failure.
	body := []byte(`{"version":"10.6.21.17","systemMessages":[{"type":"error","module":"BROKER","code":-8011,"text":""}],"locations":[]}`)
	got, err := mapStops(body)
	if err != nil {
		t.Fatalf("mapStops: %v", err)
	}
	if len(got.Stops) != 0 {
		t.Errorf("stops = %+v, want empty", got.Stops)
	}
}

func TestMapStopsRanksBestMatchFirst(t *testing.T) {
	body := []byte(`{"locations":[
		{"id":"1","name":"Ok Station","type":"stop","matchQuality":500,"modes":[1]},
		{"id":"2","name":"Best Station","type":"stop","matchQuality":100,"isBest":true,"modes":[1]},
		{"id":"3","name":"Better Station","type":"stop","matchQuality":900,"modes":[2]}]}`)
	got, err := mapStops(body)
	if err != nil {
		t.Fatalf("mapStops: %v", err)
	}
	want := []string{"2", "3", "1"}
	if len(got.Stops) != len(want) {
		t.Fatalf("stops = %+v, want %d entries", got.Stops, len(want))
	}
	for i, id := range want {
		if got.Stops[i].ID != id {
			t.Errorf("stop %d = %q, want %q", i, got.Stops[i].ID, id)
		}
	}
}

func TestMapTripCentralToParramatta(t *testing.T) {
	generatedAt := mustParse(t, "2026-08-31T12:47:00Z")
	got, err := mapTrip(fixture(t, "trip_central_parramatta.json"), "200060", "215020", 6, generatedAt, sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}

	if got.From.ID != "200060" || got.From.Name != "Central Station" {
		t.Errorf("from = %+v, want 200060 / Central Station", got.From)
	}
	if got.To.ID != "215020" || got.To.Name != "Parramatta Station" {
		t.Errorf("to = %+v, want 215020 / Parramatta Station", got.To)
	}
	// Upstream reports UTC; we serve Sydney offset. 31 August is AEST (+10:00).
	if got.GeneratedAt != "2026-08-31T22:47:00+10:00" {
		t.Errorf("generatedAt = %q, want 2026-08-31T22:47:00+10:00", got.GeneratedAt)
	}
	if len(got.Journeys) != 6 {
		t.Fatalf("journeys = %d, want 6", len(got.Journeys))
	}

	first := got.Journeys[0]
	if first.Departure.Scheduled != "2026-08-31T22:48:00+10:00" {
		t.Errorf("departure.scheduled = %q, want 2026-08-31T22:48:00+10:00", first.Departure.Scheduled)
	}
	if first.Departure.Estimated == nil || *first.Departure.Estimated != "2026-08-31T22:48:00+10:00" {
		t.Errorf("departure.estimated = %v, want 2026-08-31T22:48:00+10:00", first.Departure.Estimated)
	}
	if first.Departure.Platform == nil || *first.Departure.Platform != "Platform 12" {
		t.Errorf("platform = %v, want %q", first.Departure.Platform, "Platform 12")
	}
	if first.Arrival.Scheduled != "2026-08-31T23:17:00+10:00" {
		t.Errorf("arrival.scheduled = %q, want 2026-08-31T23:17:00+10:00", first.Arrival.Scheduled)
	}
	if first.Line.Name != "T1" || first.Line.Mode != "train" {
		t.Errorf("line = %+v, want T1 / train", first.Line)
	}
	if first.DestinationHeadsign != "Penrith via Parramatta" {
		t.Errorf("headsign = %q, want %q", first.DestinationHeadsign, "Penrith via Parramatta")
	}
	if first.Legs != 1 {
		t.Errorf("legs = %d, want 1", first.Legs)
	}
	if first.Cancelled {
		t.Error("cancelled = true, want false")
	}
	if first.StopsAway != nil {
		t.Errorf("stopsAway = %v, want null", first.StopsAway)
	}

	// Intercity services keep their own line code.
	if got.Journeys[2].Line.Name != "BMT" {
		t.Errorf("journey 2 line = %q, want BMT", got.Journeys[2].Line.Name)
	}
}

func TestMapTripEstimatedIsNullWithoutRealtime(t *testing.T) {
	// Journeys 4 and 5 in the fixture have isRealtimeControlled null and
	// realtimeStatus null, yet upstream still fills departureTimeEstimated
	// with a copy of the planned time. Serving that would fake a live
	// estimate, so it must come back null.
	got, err := mapTrip(fixture(t, "trip_central_parramatta.json"), "200060", "215020", 6,
		mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	for _, i := range []int{4, 5} {
		journey := got.Journeys[i]
		if journey.Departure.Estimated != nil {
			t.Errorf("journey %d departure.estimated = %q, want null", i, *journey.Departure.Estimated)
		}
		if journey.Arrival.Estimated != nil {
			t.Errorf("journey %d arrival.estimated = %q, want null", i, *journey.Arrival.Estimated)
		}
		if journey.Departure.Scheduled == "" {
			t.Errorf("journey %d lost its scheduled time", i)
		}
	}
}

func TestMapTripMetro(t *testing.T) {
	got, err := mapTrip(fixture(t, "trip_tallawong_chatswood.json"), "2155384", "206710", 6,
		mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	if got.From.Name != "Tallawong Station" || got.To.Name != "Chatswood Station" {
		t.Errorf("from/to = %+v / %+v", got.From, got.To)
	}
	if len(got.Journeys) != 3 {
		t.Fatalf("journeys = %d, want 3", len(got.Journeys))
	}
	first := got.Journeys[0]
	// Product class 2 is the Sydney Metro Network.
	if first.Line.Name != "M1" || first.Line.Mode != "metro" {
		t.Errorf("line = %+v, want M1 / metro", first.Line)
	}
	if first.DestinationHeadsign != "Sydenham" {
		t.Errorf("headsign = %q, want Sydenham", first.DestinationHeadsign)
	}
	if first.Departure.Scheduled != "2026-08-31T22:50:00+10:00" {
		t.Errorf("departure.scheduled = %q, want 2026-08-31T22:50:00+10:00", first.Departure.Scheduled)
	}
}

func TestFixturesCarryExpectedUpstreamFields(t *testing.T) {
	// Guards the assumptions the mapping is built on: if a refreshed fixture
	// loses these, the mapping tests above are no longer testing reality.
	cases := []struct {
		file      string
		number    string
		class     int
		platform  string
		monitored bool
	}{
		{"trip_central_parramatta.json", "T1 North Shore & Western Line", classTrain, "Platform 12", true},
		{"trip_tallawong_chatswood.json", "M1 Metro North West & Bankstown Line", classMetro, "Platform 2", true},
	}
	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			var raw tripResponse
			if err := json.Unmarshal(fixture(t, tc.file), &raw); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			leg := raw.Journeys[0].Legs[0]
			if leg.Transportation.Number != tc.number {
				t.Errorf("number = %q, want %q", leg.Transportation.Number, tc.number)
			}
			if leg.Transportation.Product.Class != tc.class {
				t.Errorf("product.class = %d, want %d", leg.Transportation.Product.Class, tc.class)
			}
			if leg.Origin.Properties.PlatformName != tc.platform {
				t.Errorf("platformName = %q, want %q", leg.Origin.Properties.PlatformName, tc.platform)
			}
			if isRealtime(leg) != tc.monitored {
				t.Errorf("isRealtime = %v, want %v", isRealtime(leg), tc.monitored)
			}
		})
	}
}

func TestMapTripCancellationIsDefensive(t *testing.T) {
	// The upstream cancellation shape is unverified (no disruption was
	// observed while probing). Any realtimeStatus containing "cancel" counts,
	// so a service that will not run is never shown as running.
	for _, status := range []string{"TRIP_CANCELLED", "trip_cancelled", "CANCELLED_STOP"} {
		body := bytes.ReplaceAll(fixture(t, "trip_central_parramatta.json"),
			[]byte(`"MONITORED"`), []byte(`"`+status+`"`))
		got, err := mapTrip(body, "200060", "215020", 6, mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
		if err != nil {
			t.Fatalf("mapTrip: %v", err)
		}
		if !got.Journeys[0].Cancelled {
			t.Errorf("status %q: cancelled = false, want true", status)
		}
		// Cancelled journeys are included, never dropped.
		if len(got.Journeys) != 6 {
			t.Errorf("status %q: journeys = %d, want 6", status, len(got.Journeys))
		}
	}
	// The healthy fixture must stay uncancelled, or the check above proves
	// nothing.
	got, err := mapTrip(fixture(t, "trip_central_parramatta.json"), "200060", "215020", 6,
		mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	if got.Journeys[0].Cancelled {
		t.Error("MONITORED journey reported as cancelled")
	}
}

func TestMapTripSortsByEffectiveDeparture(t *testing.T) {
	// Second journey is scheduled later but running early, so it departs
	// first; the delayed one moves behind it.
	body := []byte(`{"journeys":[
	 {"interchanges":0,"legs":[{"isRealtimeControlled":true,"realtimeStatus":["MONITORED"],
	  "origin":{"departureTimePlanned":"2026-08-31T12:00:00Z","departureTimeEstimated":"2026-08-31T12:20:00Z"},
	  "destination":{"arrivalTimePlanned":"2026-08-31T12:30:00Z"},
	  "transportation":{"disassembledName":"LATE","product":{"class":1},"destination":{"name":"X"}}}]},
	 {"interchanges":0,"legs":[{"isRealtimeControlled":true,"realtimeStatus":["MONITORED"],
	  "origin":{"departureTimePlanned":"2026-08-31T12:10:00Z","departureTimeEstimated":"2026-08-31T12:08:00Z"},
	  "destination":{"arrivalTimePlanned":"2026-08-31T12:40:00Z"},
	  "transportation":{"disassembledName":"EARLY","product":{"class":1},"destination":{"name":"X"}}}]}]}`)
	got, err := mapTrip(body, "a", "b", 6, mustParse(t, "2026-08-31T12:00:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	if len(got.Journeys) != 2 {
		t.Fatalf("journeys = %d, want 2", len(got.Journeys))
	}
	if got.Journeys[0].Line.Name != "EARLY" || got.Journeys[1].Line.Name != "LATE" {
		t.Errorf("order = %q, %q; want EARLY, LATE",
			got.Journeys[0].Line.Name, got.Journeys[1].Line.Name)
	}
}

func TestMapTripCountsOnlyTransitLegs(t *testing.T) {
	// A walking transfer between platforms is not an interchange the rider
	// cares about counting; `legs` must count services.
	body := []byte(`{"journeys":[{"interchanges":1,"legs":[
	 {"origin":{"departureTimePlanned":"2026-08-31T12:00:00Z"},"destination":{"arrivalTimePlanned":"2026-08-31T12:10:00Z"},
	  "transportation":{"disassembledName":"T1","product":{"class":1},"destination":{"name":"X"}}},
	 {"origin":{"departureTimePlanned":"2026-08-31T12:10:00Z"},"destination":{"arrivalTimePlanned":"2026-08-31T12:15:00Z"},
	  "transportation":{"disassembledName":"walk","product":{"class":100},"destination":{"name":"X"}}},
	 {"origin":{"departureTimePlanned":"2026-08-31T12:20:00Z"},"destination":{"arrivalTimePlanned":"2026-08-31T12:40:00Z"},
	  "transportation":{"disassembledName":"M1","product":{"class":2},"destination":{"name":"Y"}}}]}]}`)
	got, err := mapTrip(body, "a", "b", 6, mustParse(t, "2026-08-31T12:00:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	journey := got.Journeys[0]
	if journey.Legs != 2 {
		t.Errorf("legs = %d, want 2 (walk leg excluded)", journey.Legs)
	}
	// Departure comes from the first service, arrival from the last.
	if journey.Departure.Scheduled != "2026-08-31T22:00:00+10:00" {
		t.Errorf("departure = %q", journey.Departure.Scheduled)
	}
	if journey.Arrival.Scheduled != "2026-08-31T22:40:00+10:00" {
		t.Errorf("arrival = %q", journey.Arrival.Scheduled)
	}
	if journey.Line.Name != "T1" {
		t.Errorf("line = %q, want the first service", journey.Line.Name)
	}
}

func TestMapTripHonoursLimit(t *testing.T) {
	got, err := mapTrip(fixture(t, "trip_central_parramatta.json"), "200060", "215020", 2,
		mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	if len(got.Journeys) != 2 {
		t.Fatalf("journeys = %d, want 2", len(got.Journeys))
	}
}

func TestMapTripNoJourneysSerialisesAsEmptyList(t *testing.T) {
	got, err := mapTrip([]byte(`{"version":"10.6.21.17","journeys":null}`), "200060", "215020", 6,
		mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	encoded, err := json.Marshal(got)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"journeys":[]`)) {
		t.Errorf("body = %s, want an empty journeys array", encoded)
	}
}

func TestFormatTimeFollowsSydneyDST(t *testing.T) {
	// A hardcoded +10:00 offset would silently be an hour wrong all summer.
	loc := sydney(t)
	cases := []struct{ utc, want string }{
		{"2026-08-31T12:48:00Z", "2026-08-31T22:48:00+10:00"}, // AEST
		{"2026-01-15T02:00:00Z", "2026-01-15T13:00:00+11:00"}, // AEDT
	}
	for _, tc := range cases {
		if got := formatTime(mustParse(t, tc.utc), loc); got != tc.want {
			t.Errorf("formatTime(%s) = %q, want %q", tc.utc, got, tc.want)
		}
	}
}

func TestJourneyJSONKeepsUnknownValuesExplicitlyNull(t *testing.T) {
	// The contract says clients get null, never a missing key and never a
	// fabricated value.
	encoded, err := json.Marshal(Journey{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, want := range []string{`"estimated":null`, `"platform":null`, `"stopsAway":null`} {
		if !bytes.Contains(encoded, []byte(want)) {
			t.Errorf("body = %s, want it to contain %s", encoded, want)
		}
	}
}
