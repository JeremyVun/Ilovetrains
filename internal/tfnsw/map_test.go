package tfnsw

import (
	"bytes"
	"encoding/json"
	"fmt"
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

func ptr(value string) *string { return &value }

// legDiff compares two legs by their wire form, so a pointer field that should
// be null is judged the way a client sees it.
func legDiff(want, got Leg) string {
	encodedWant, err := json.Marshal(want)
	if err != nil {
		return fmt.Sprintf("marshalling want: %v", err)
	}
	encodedGot, err := json.Marshal(got)
	if err != nil {
		return fmt.Sprintf("marshalling got: %v", err)
	}
	if bytes.Equal(encodedWant, encodedGot) {
		return ""
	}
	return fmt.Sprintf("\n got  %s\n want %s", encodedGot, encodedWant)
}

// withFootpathAtTransfer moves the fixture's real class-99 footpath leg (from
// the On Demand journey 1, Strathfield concourse to Platform 4) into the Town
// Hall transfer of journey 0. Upstream did not give us a walking leg inside a
// train-only journey, and a hand-written one would only test the shape we
// imagined.
func withFootpathAtTransfer(t *testing.T, body []byte) []byte {
	t.Helper()
	var raw struct {
		Journeys []struct {
			Legs []json.RawMessage `json:"legs"`
		} `json:"journeys"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	footpath := raw.Journeys[1].Legs[1]
	var walk struct {
		Transportation struct {
			Product struct {
				Class int `json:"class"`
			} `json:"product"`
		} `json:"transportation"`
	}
	if err := json.Unmarshal(footpath, &walk); err != nil {
		t.Fatalf("unmarshal footpath: %v", err)
	}
	if walk.Transportation.Product.Class != classFootpath {
		t.Fatalf("fixture leg is class %d, want the class-%d footpath",
			walk.Transportation.Product.Class, classFootpath)
	}

	legs := raw.Journeys[0].Legs
	spliced, err := json.Marshal(map[string]any{"journeys": []any{
		map[string]any{"interchanges": 1, "legs": []json.RawMessage{legs[0], footpath, legs[1]}},
	}})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return spliced
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

func TestMapStopsCarriesLocation(t *testing.T) {
	// Axis order is the whole risk here: EPSG:4326 names latitude first, but
	// plenty of APIs serve x,y anyway. These are the real captured coordinates —
	// swap them and Central lands in Lebanon, which is what this test is for.
	cases := []struct {
		file     string
		lat, lon float64
	}{
		{"stop_finder_central.json", -33.884024, 151.206203},
		{"stop_finder_parramatta.json", -33.81749, 151.005325},
	}
	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			got, err := mapStops(fixture(t, tc.file))
			if err != nil {
				t.Fatalf("mapStops: %v", err)
			}
			location := got.Stops[0].Location
			if location == nil {
				t.Fatal("location = null, want the station's coordinates")
			}
			if location.Lat != tc.lat || location.Lon != tc.lon {
				t.Errorf("location = %+v, want lat %v lon %v", *location, tc.lat, tc.lon)
			}
			// Sydney is south of the equator and east of Greenwich. A transposed
			// pair passes the equality check above only if the fixture changed,
			// so state the invariant that would survive a refresh too.
			if location.Lat > 0 || location.Lon < 0 {
				t.Errorf("location = %+v, want a southern/eastern point", *location)
			}
		})
	}
}

func TestMapStopsLocationIsNullWhenUpstreamOmitsIt(t *testing.T) {
	// Every station in the captured fixtures has coordinates, so the absent case
	// has to be stated here: a fabricated position would send the client's
	// nearest-station prediction somewhere the rider is not.
	body := []byte(`{"locations":[
		{"id":"1","name":"No Coord Station","type":"stop","modes":[1]},
		{"id":"2","name":"Short Coord Station","type":"stop","modes":[1],"coord":[-33.8]},
		{"id":"3","name":"Fine Station","type":"stop","modes":[1],"coord":[-33.8,151.2]}]}`)
	got, err := mapStops(body)
	if err != nil {
		t.Fatalf("mapStops: %v", err)
	}
	if len(got.Stops) != 3 {
		t.Fatalf("stops = %d, want 3", len(got.Stops))
	}
	for _, i := range []int{0, 1} {
		if got.Stops[i].Location != nil {
			t.Errorf("stop %d location = %+v, want null", i, *got.Stops[i].Location)
		}
	}
	if got.Stops[2].Location == nil {
		t.Error("stop 2 location = null, want the coordinates it carries")
	}
}

func TestStopJSONKeepsLocationExplicitlyNull(t *testing.T) {
	encoded, err := json.Marshal(Stop{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !bytes.Contains(encoded, []byte(`"location":null`)) {
		t.Errorf("body = %s, want it to contain \"location\":null", encoded)
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

// TestMapTripPastWindowKeepsRealtimeActuals is the golden for the whole `at`
// feature. The fixture is a real trip response for a window 20 minutes in the
// past (captured 2026-09-01 17:53 for itdTime=1732), and it proves the thing
// the contract had to leave DRAFT: upstream answers past windows with realtime
// ACTUALS, not the timetable. Every one of these six T1s left Central about
// three minutes late and arrived late by its own amount — values that cannot
// come from a schedule, and that a client can therefore show as what really
// happened.
func TestMapTripPastWindowKeepsRealtimeActuals(t *testing.T) {
	got, err := mapTrip(fixture(t, "trip_central_parramatta_past.json"), "200060", "215020", 6,
		mustParse(t, "2026-09-01T07:53:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	if len(got.Journeys) != 6 {
		t.Fatalf("journeys = %d, want 6", len(got.Journeys))
	}
	// Journeys are in the requested past window, not at the fetch time: the
	// first one departs before generatedAt.
	first := got.Journeys[0]
	if first.Departure.Scheduled != "2026-09-01T17:34:00+10:00" {
		t.Errorf("departure.scheduled = %q, want 2026-09-01T17:34:00+10:00",
			first.Departure.Scheduled)
	}
	if first.Departure.Estimated == nil || *first.Departure.Estimated != "2026-09-01T17:37:18+10:00" {
		t.Errorf("departure.estimated = %v, want the actual 2026-09-01T17:37:18+10:00",
			first.Departure.Estimated)
	}
	if first.Arrival.Scheduled != "2026-09-01T17:59:00+10:00" {
		t.Errorf("arrival.scheduled = %q, want 2026-09-01T17:59:00+10:00", first.Arrival.Scheduled)
	}
	if first.Arrival.Estimated == nil || *first.Arrival.Estimated != "2026-09-01T18:03:30+10:00" {
		t.Errorf("arrival.estimated = %v, want the actual 2026-09-01T18:03:30+10:00",
			first.Arrival.Estimated)
	}
	if first.Departure.Platform == nil || *first.Departure.Platform != "Platform 18" {
		t.Errorf("platform = %v, want Platform 18", first.Departure.Platform)
	}
	if first.Line.Name != "T1" || first.DestinationHeadsign != "Emu Plains via Parramatta" {
		t.Errorf("line/headsign = %+v / %q", first.Line, first.DestinationHeadsign)
	}

	// A schedule copy would put estimated exactly on scheduled everywhere. Every
	// journey in this window carries a real, distinct delay on both ends — that
	// is what makes the past worth showing rather than replaying the timetable.
	for i, journey := range got.Journeys {
		if journey.Departure.Estimated == nil || journey.Arrival.Estimated == nil {
			t.Fatalf("journey %d lost its realtime estimate", i)
		}
		if *journey.Departure.Estimated == journey.Departure.Scheduled {
			t.Errorf("journey %d departure.estimated equals scheduled; the fixture "+
				"was captured with a real delay on every service", i)
		}
		if *journey.Arrival.Estimated == journey.Arrival.Scheduled {
			t.Errorf("journey %d arrival.estimated equals scheduled", i)
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
		// The past window must stay MONITORED, or the golden above stops
		// testing that a departed service still carries its actuals.
		{"trip_central_parramatta_past.json", "T1 North Shore & Western Line", classTrain, "Platform 18", true},
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

// rhodes maps the Rhodes → Bondi Junction fixture, captured 2026-09-01 with a
// genuine T9 → Town Hall → T4 transfer, five On Demand journeys and the
// class-99 footpaths inside them.
func rhodes(t *testing.T, limit int) *DeparturesResponse {
	t.Helper()
	got, err := mapTrip(fixture(t, "trip_rhodes_bondijunction.json"), "213820", "202210", limit,
		mustParse(t, "2026-08-31T23:20:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	return got
}

func TestMapTripLegDetailForRealTransfer(t *testing.T) {
	got := rhodes(t, 6)
	if got.From.Name != "Rhodes Station" || got.To.Name != "Bondi Junction Station" {
		t.Errorf("from/to = %+v / %+v", got.From, got.To)
	}
	journey := got.Journeys[0]
	if journey.Legs != 2 || len(journey.LegDetail) != 2 {
		t.Fatalf("legs = %d, legDetail = %d, want 2 and 2", journey.Legs, len(journey.LegDetail))
	}

	// Both legs are MONITORED, so every estimate is real, not a copy of the
	// planned time served as if it were live.
	want := []Leg{{
		Line:     Line{Name: "T9", Mode: "train"},
		Headsign: "Gordon via Lindfield",
		From:     LegPlace{ID: "213820", Name: "Rhodes Station", Platform: ptr("Platform 1")},
		To:       LegPlace{ID: "200070", Name: "Town Hall Station", Platform: ptr("Platform 3")},
		Departure: LegTime{
			Scheduled: "2026-09-01T09:24:18+10:00", Estimated: ptr("2026-09-01T09:24:18+10:00"),
		},
		Arrival: LegTime{
			Scheduled: "2026-09-01T09:51:36+10:00", Estimated: ptr("2026-09-01T09:51:36+10:00"),
		},
	}, {
		Line:     Line{Name: "T4", Mode: "train"},
		Headsign: "Bondi Junction",
		From:     LegPlace{ID: "200070", Name: "Town Hall Station", Platform: ptr("Platform 5")},
		To:       LegPlace{ID: "202210", Name: "Bondi Junction Station", Platform: ptr("Platform 2")},
		Departure: LegTime{
			Scheduled: "2026-09-01T09:58:00+10:00", Estimated: ptr("2026-09-01T09:58:00+10:00"),
		},
		Arrival: LegTime{
			Scheduled: "2026-09-01T10:08:00+10:00", Estimated: ptr("2026-09-01T10:08:00+10:00"),
		},
	}}
	for i := range want {
		if diff := legDiff(want[i], journey.LegDetail[i]); diff != "" {
			t.Errorf("leg %d: %s", i, diff)
		}
	}

	// The journey level mirrors the first and last leg, so a client can show a
	// row without reading legDetail at all.
	if journey.Departure.Scheduled != want[0].Departure.Scheduled {
		t.Errorf("journey departure = %q, want the first leg's %q",
			journey.Departure.Scheduled, want[0].Departure.Scheduled)
	}
	if journey.Arrival.Scheduled != want[1].Arrival.Scheduled {
		t.Errorf("journey arrival = %q, want the last leg's %q",
			journey.Arrival.Scheduled, want[1].Arrival.Scheduled)
	}
	if journey.Line != want[0].Line || journey.DestinationHeadsign != want[0].Headsign {
		t.Errorf("journey line/headsign = %+v / %q, want the first leg's",
			journey.Line, journey.DestinationHeadsign)
	}
	if journey.Departure.Platform == nil || *journey.Departure.Platform != "Platform 1" {
		t.Errorf("journey platform = %v, want Platform 1", journey.Departure.Platform)
	}
}

func TestMapTripExcludesOnDemandJourneys(t *testing.T) {
	// Five of the fixture's eleven journeys ride a class-10 "On Demand" bus to
	// Strathfield before any train. exclMOT_10 now keeps them out upstream;
	// this is the guard for the next thing that leaks past the exclusions.
	got := rhodes(t, 10)
	if len(got.Journeys) != 6 {
		t.Fatalf("journeys = %d, want the 6 train journeys of 11", len(got.Journeys))
	}
	for i, journey := range got.Journeys {
		for _, leg := range journey.LegDetail {
			if leg.Line.Mode != "train" && leg.Line.Mode != "metro" {
				t.Errorf("journey %d carries a %q leg", i, leg.Line.Mode)
			}
		}
		// Every surviving journey starts where the rider is; the On Demand ones
		// start at Rhodes by bus and board a train at Strathfield.
		if journey.LegDetail[0].From.ID != "213820" {
			t.Errorf("journey %d starts at %+v, want Rhodes Station",
				i, journey.LegDetail[0].From)
		}
	}
}

func TestMapTripExclusionHappensBeforeLimit(t *testing.T) {
	// The On Demand journeys leave a minute after each train, so dropping them
	// after the limit would fill half the board with journeys the rider cannot
	// take and hide the trains behind them.
	got := rhodes(t, 4)
	want := []string{
		"2026-09-01T09:24:18+10:00",
		"2026-09-01T09:39:18+10:00",
		"2026-09-01T09:54:18+10:00",
		"2026-09-01T10:09:18+10:00",
	}
	if len(got.Journeys) != len(want) {
		t.Fatalf("journeys = %d, want %d takeable journeys", len(got.Journeys), len(want))
	}
	for i, scheduled := range want {
		if got.Journeys[i].Departure.Scheduled != scheduled {
			t.Errorf("journey %d departs %q, want the train at %q",
				i, got.Journeys[i].Departure.Scheduled, scheduled)
		}
	}
}

func TestMapTripLegDetailFoldsWalkingLegsIntoTheGap(t *testing.T) {
	// The real class-99 footpath from the fixture, moved into the Town Hall
	// transfer of the T9 → T4 journey: it must not be listed, and the gap
	// between the two services must still be the whole change window.
	got, err := mapTrip(withFootpathAtTransfer(t, fixture(t, "trip_rhodes_bondijunction.json")),
		"213820", "202210", 6, mustParse(t, "2026-08-31T23:20:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	journey := got.Journeys[0]
	if journey.Legs != 2 || len(journey.LegDetail) != 2 {
		t.Fatalf("legs = %d, legDetail = %d, want 2 and 2 (footpath not listed)",
			journey.Legs, len(journey.LegDetail))
	}
	if journey.LegDetail[0].Line.Name != "T9" || journey.LegDetail[1].Line.Name != "T4" {
		t.Errorf("legs = %q, %q; want T9, T4",
			journey.LegDetail[0].Line.Name, journey.LegDetail[1].Line.Name)
	}
	if journey.LegDetail[0].Arrival.Scheduled != "2026-09-01T09:51:36+10:00" ||
		journey.LegDetail[1].Departure.Scheduled != "2026-09-01T09:58:00+10:00" {
		t.Errorf("transfer gap = %q → %q, want the walk folded inside it",
			journey.LegDetail[0].Arrival.Scheduled, journey.LegDetail[1].Departure.Scheduled)
	}
}

func TestConnectionFloorRejectsUnreasonablyTightPlans(t *testing.T) {
	legs := []leg{
		{Destination: place{ArrivalTimePlanned: "2026-09-01T09:51:00Z"}},
		{Origin: place{DepartureTimePlanned: "2026-09-01T09:53:00Z"}},
	}
	if connectionFloorMet(legs, 3*time.Minute) {
		t.Error("2-minute planned connection passed a 3-minute floor")
	}
	legs[1].Origin.DepartureTimePlanned = "2026-09-01T09:54:00Z"
	if !connectionFloorMet(legs, 3*time.Minute) {
		t.Error("3-minute planned connection did not meet the floor")
	}
	if !connectionFloorMet(legs, 0) {
		t.Error("zero disables the tuneable floor")
	}
}

func TestMapTripLegDetailRealtimeIsPerLeg(t *testing.T) {
	// Fixture journeys 8 and 10 (5th and 6th after the On Demand ones are
	// dropped) are mixed: a schedule-only T9 into Town Hall, then a MONITORED
	// T4. Gating on the journey would either hide a real estimate or fabricate
	// one from the planned time.
	got := rhodes(t, 6)
	for _, i := range []int{4, 5} {
		journey := got.Journeys[i]
		if len(journey.LegDetail) != 2 {
			t.Fatalf("journey %d: legDetail = %d, want 2", i, len(journey.LegDetail))
		}
		if journey.LegDetail[0].Departure.Estimated != nil {
			t.Errorf("journey %d leg 0 departure.estimated = %q, want null (schedule only)",
				i, *journey.LegDetail[0].Departure.Estimated)
		}
		if journey.LegDetail[0].Arrival.Estimated != nil {
			t.Errorf("journey %d leg 0 arrival.estimated = %q, want null (schedule only)",
				i, *journey.LegDetail[0].Arrival.Estimated)
		}
		if journey.LegDetail[0].Departure.Scheduled == "" {
			t.Errorf("journey %d leg 0 lost its scheduled time", i)
		}
		if journey.LegDetail[1].Departure.Estimated == nil {
			t.Errorf("journey %d leg 1 departure.estimated = null, want the realtime value", i)
		}
	}
}

func TestMapTripLegDetailMatchesLegCountOnEveryFixture(t *testing.T) {
	cases := []struct{ file, from, to string }{
		{"trip_central_parramatta.json", "200060", "215020"},
		{"trip_tallawong_chatswood.json", "2155384", "206710"},
		{"trip_rhodes_bondijunction.json", "213820", "202210"},
		{"trip_central_parramatta_past.json", "200060", "215020"},
	}
	for _, tc := range cases {
		t.Run(tc.file, func(t *testing.T) {
			got, err := mapTrip(fixture(t, tc.file), tc.from, tc.to, 10,
				mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
			if err != nil {
				t.Fatalf("mapTrip: %v", err)
			}
			if len(got.Journeys) == 0 {
				t.Fatal("no journeys mapped")
			}
			for i, journey := range got.Journeys {
				if journey.Legs != len(journey.LegDetail) {
					t.Errorf("journey %d: legs = %d, legDetail = %d",
						i, journey.Legs, len(journey.LegDetail))
				}
				for k, leg := range journey.LegDetail {
					if leg.Line.Name == "" || leg.Line.Mode == "" {
						t.Errorf("journey %d leg %d: unnamed line %+v", i, k, leg.Line)
					}
					if leg.From.ID == "" || leg.From.Name == "" || leg.To.ID == "" || leg.To.Name == "" {
						t.Errorf("journey %d leg %d: %+v → %+v", i, k, leg.From, leg.To)
					}
					if leg.Departure.Scheduled == "" || leg.Arrival.Scheduled == "" {
						t.Errorf("journey %d leg %d: missing scheduled time", i, k)
					}
				}
				if journey.LegDetail[0].Departure.Scheduled != journey.Departure.Scheduled {
					t.Errorf("journey %d: departure %q, first leg %q",
						i, journey.Departure.Scheduled, journey.LegDetail[0].Departure.Scheduled)
				}
				last := journey.LegDetail[len(journey.LegDetail)-1]
				if last.Arrival.Scheduled != journey.Arrival.Scheduled {
					t.Errorf("journey %d: arrival %q, last leg %q",
						i, journey.Arrival.Scheduled, last.Arrival.Scheduled)
				}
			}
		})
	}
}

func TestMapTripLegCancellationIsPerLeg(t *testing.T) {
	// Only the second service is cancelled: the journey is cancelled, but a
	// client must be able to say which leg fell over.
	body := []byte(`{"journeys":[{"interchanges":1,"legs":[
	 {"isRealtimeControlled":true,"realtimeStatus":["MONITORED"],
	  "origin":{"departureTimePlanned":"2026-08-31T12:00:00Z"},"destination":{"arrivalTimePlanned":"2026-08-31T12:10:00Z"},
	  "transportation":{"disassembledName":"T1","product":{"class":1},"destination":{"name":"X"}}},
	 {"isRealtimeControlled":true,"realtimeStatus":["TRIP_CANCELLED"],
	  "origin":{"departureTimePlanned":"2026-08-31T12:20:00Z"},"destination":{"arrivalTimePlanned":"2026-08-31T12:40:00Z"},
	  "transportation":{"disassembledName":"T4","product":{"class":1},"destination":{"name":"Y"}}}]}]}`)
	got, err := mapTrip(body, "a", "b", 6, mustParse(t, "2026-08-31T12:00:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	journey := got.Journeys[0]
	if !journey.Cancelled {
		t.Error("journey cancelled = false, want true")
	}
	if journey.LegDetail[0].Cancelled {
		t.Error("leg 0 cancelled = true, want false")
	}
	if !journey.LegDetail[1].Cancelled {
		t.Error("leg 1 cancelled = false, want true")
	}
}

func TestLegJSONKeepsUnknownValuesExplicitlyNull(t *testing.T) {
	encoded, err := json.Marshal(Leg{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, want := range []string{`"platform":null`, `"estimated":null`} {
		if !bytes.Contains(encoded, []byte(want)) {
			t.Errorf("body = %s, want it to contain %s", encoded, want)
		}
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
