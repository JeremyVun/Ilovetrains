package tfnsw

import (
	"encoding/json"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"time"
)

// EFA product classes we serve. Everything else is excluded upstream via
// exclMOT_* and defensively re-filtered here.
const (
	classTrain = 1
	classMetro = 2
)

// EFA product classes for walking segments: a footpath between platforms
// (class 99, verified) or a guaranteed connection (class 100). They are not
// services, so they neither count as legs nor exclude a journey — the walk is
// folded into the gap between the legs either side of it.
const (
	classFootpath   = 99
	classConnection = 100
)

// cancelPattern is deliberately loose. The upstream cancellation shape is
// UNVERIFIED (no disruption was observed during Phase 0 probing); the
// documented expectation is a realtimeStatus entry such as "TRIP_CANCELLED".
// Anything containing "cancel" counts, so we degrade toward showing a service
// as cancelled rather than silently presenting a train that will not run.
var cancelPattern = regexp.MustCompile(`(?i)cancel`)

var platformSuffix = regexp.MustCompile(`,\s*Platform\s.*$`)

// Axis order of upstream's EPSG:4326 `coord` pair, verified 2026-09-01 against
// real stop_finder responses rather than assumed from the CRS: Central Station
// is [-33.884024, 151.206203] and the Adelaide coach stop G50001 is
// [-34.927477, 138.595501]. Read the other way round those are a point in
// Lebanon and one in the Southern Ocean, so latitude is first.
const (
	coordLat = 0
	coordLon = 1
	coordLen = 2
)

func modeName(class int) (string, bool) {
	switch class {
	case classTrain:
		return "train", true
	case classMetro:
		return "metro", true
	}
	return "", false
}

// mapStops turns a stop_finder payload into our stops response: stations only,
// train/metro only, best match first.
func mapStops(body []byte) (*StopsResponse, error) {
	var raw stopFinderResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("%w: decoding stop_finder: %v", ErrUpstream, err)
	}

	type scored struct {
		stop    Stop
		isBest  bool
		quality int
	}
	var candidates []scored
	seen := make(map[string]bool)

	for _, loc := range raw.Locations {
		if loc.Type != "stop" || loc.ID == "" || seen[loc.ID] {
			continue
		}
		modes := serveableModes(loc.Modes)
		if len(modes) == 0 {
			continue
		}
		seen[loc.ID] = true
		candidates = append(candidates, scored{
			stop: Stop{
				ID:       loc.ID,
				Name:     stationName(loc),
				Modes:    modes,
				Location: stopLocation(loc),
			},
			isBest:  loc.IsBest,
			quality: loc.MatchQuality,
		})
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].isBest != candidates[j].isBest {
			return candidates[i].isBest
		}
		return candidates[i].quality > candidates[j].quality
	})

	stops := make([]Stop, 0, len(candidates))
	for _, c := range candidates {
		stops = append(stops, c.stop)
	}
	return &StopsResponse{Stops: stops}, nil
}

// stopLocation reads a station's coordinates. Upstream is not obliged to carry
// them, and a fabricated position would send the client's nearest-station
// prediction to the wrong platform, so a missing pair maps to null.
func stopLocation(p place) *Location {
	if len(p.Coord) < coordLen {
		return nil
	}
	return &Location{Lat: p.Coord[coordLat], Lon: p.Coord[coordLon]}
}

// serveableModes maps EFA product classes to our mode names, keeping only
// train and metro and preserving that order.
func serveableModes(classes []int) []string {
	var modes []string
	for _, class := range []int{classTrain, classMetro} {
		for _, c := range classes {
			if c == class {
				name, _ := modeName(class)
				modes = append(modes, name)
				break
			}
		}
	}
	return modes
}

// mapTrip turns a trip payload into our departures response. fromID/toID are
// echoed back as requested so the response is a pure function of the query;
// station names come from the journeys themselves.
func mapTrip(body []byte, fromID, toID string, limit int, generatedAt time.Time, loc *time.Location) (*DeparturesResponse, error) {
	var raw tripResponse
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("%w: decoding trip: %v", ErrUpstream, err)
	}

	resp := &DeparturesResponse{
		From:        Place{ID: fromID},
		To:          Place{ID: toID},
		GeneratedAt: formatTime(generatedAt, loc),
		Journeys:    []Journey{},
	}

	type sortable struct {
		journey   Journey
		effective time.Time
	}
	var rows []sortable

	for _, j := range raw.Journeys {
		legs, serveable := serviceLegs(j)
		// Dropped here, before the limit below, so the client still receives up
		// to `limit` journeys it can actually take.
		if !serveable || len(legs) == 0 {
			continue
		}
		first, last := legs[0], legs[len(legs)-1]

		schedDep, ok := parseTime(first.Origin.DepartureTimePlanned)
		if !ok {
			continue
		}
		estDep := realtime(first, first.Origin.DepartureTimeEstimated)
		schedArr, _ := parseTime(last.Destination.ArrivalTimePlanned)
		estArr := realtime(last, last.Destination.ArrivalTimeEstimated)

		mode, _ := modeName(first.Transportation.Product.Class)
		row := sortable{
			journey: Journey{
				Departure: Departure{
					Scheduled: formatTime(schedDep, loc),
					Estimated: formatTimePtr(estDep, loc),
					Platform:  platformName(first.Origin),
				},
				Arrival: Arrival{
					Scheduled: formatTime(schedArr, loc),
					Estimated: formatTimePtr(estArr, loc),
				},
				Line: Line{
					Name: lineName(first.Transportation),
					Mode: mode,
				},
				DestinationHeadsign: headsign(first.Transportation),
				// stopsAway needs live vehicle position data the Trip Planner
				// does not carry; the contract allows null.
				StopsAway: nil,
				Cancelled: cancelled(legs),
				Legs:      len(legs),
				LegDetail: legDetail(legs, loc),
			},
			effective: effective(estDep, schedDep),
		}
		rows = append(rows, row)

		if resp.From.Name == "" {
			resp.From.Name = stationName(endpointStation(first.Origin))
		}
		if resp.To.Name == "" {
			resp.To.Name = stationName(endpointStation(last.Destination))
		}
	}

	sort.SliceStable(rows, func(i, j int) bool {
		return rows[i].effective.Before(rows[j].effective)
	})
	for i, row := range rows {
		if limit > 0 && i >= limit {
			break
		}
		resp.Journeys = append(resp.Journeys, row.journey)
	}
	return resp, nil
}

// serviceLegs returns the train/metro legs of a journey, dropping walking
// segments so `legs` counts services and legs > 1 means a real interchange.
//
// serveable is false when the journey rides something we neither serve nor
// walk — On Demand buses (class 10) leak past the exclMOT exclusions, and a
// journey you cannot take by train is not an answer to this board's question,
// so the caller drops the whole journey rather than pretending the bus leg
// away and offering a trip that starts at the wrong station.
func serviceLegs(j journey) (legs []leg, serveable bool) {
	for _, l := range j.Legs {
		if l.Transportation == nil {
			continue
		}
		switch l.Transportation.Product.Class {
		case classTrain, classMetro:
			legs = append(legs, l)
		case classFootpath, classConnection:
			// Folded into the gap between the legs either side.
		default:
			return nil, false
		}
	}
	return legs, true
}

// legDetail maps the service legs of one journey in order, so a client can
// show the transfers. Transfer wait is the gap between consecutive legs, which
// is where any walking time lives.
func legDetail(legs []leg, loc *time.Location) []Leg {
	out := make([]Leg, 0, len(legs))
	for _, l := range legs {
		mode, _ := modeName(l.Transportation.Product.Class)
		schedDep, _ := parseTime(l.Origin.DepartureTimePlanned)
		schedArr, _ := parseTime(l.Destination.ArrivalTimePlanned)
		out = append(out, Leg{
			Line:     Line{Name: lineName(l.Transportation), Mode: mode},
			Headsign: headsign(l.Transportation),
			From:     legPlace(l.Origin),
			To:       legPlace(l.Destination),
			Departure: LegTime{
				Scheduled: formatTime(schedDep, loc),
				Estimated: formatTimePtr(realtime(l, l.Origin.DepartureTimeEstimated), loc),
			},
			Arrival: LegTime{
				Scheduled: formatTime(schedArr, loc),
				Estimated: formatTimePtr(realtime(l, l.Destination.ArrivalTimeEstimated), loc),
			},
			Cancelled: legCancelled(l),
		})
	}
	return out
}

// legPlace names the station a leg ends at while keeping its platform, which
// the station name itself never carries.
func legPlace(p place) LegPlace {
	station := endpointStation(p)
	return LegPlace{
		ID:       station.ID,
		Name:     stationName(station),
		Platform: platformName(p),
	}
}

// realtime returns the estimated timestamp only when the leg is actually
// realtime-controlled. Upstream fills estimated fields with a copy of the
// planned time even for schedule-only services, so presence of the field is
// not evidence of realtime data; serving it would fake a live estimate.
func realtime(l leg, value string) time.Time {
	if !isRealtime(l) {
		return time.Time{}
	}
	t, ok := parseTime(value)
	if !ok {
		return time.Time{}
	}
	return t
}

func isRealtime(l leg) bool {
	return l.IsRealtimeControlled || len(l.RealtimeStatus) > 0
}

// cancelled reports a journey as cancelled when any of its services is: a
// rider who cannot complete the second leg cannot make the trip.
func cancelled(legs []leg) bool {
	for _, l := range legs {
		if legCancelled(l) {
			return true
		}
	}
	return false
}

func legCancelled(l leg) bool {
	for _, status := range l.RealtimeStatus {
		if cancelPattern.MatchString(status) {
			return true
		}
	}
	return false
}

func platformName(p place) *string {
	if p.Properties == nil {
		return nil
	}
	name := p.Properties.PlatformName
	if name == "" {
		name = p.Properties.PlannedPlatformName
	}
	if name == "" {
		return nil
	}
	return &name
}

func lineName(t *transportation) string {
	for _, candidate := range []string{t.DisassembledName, t.Number, t.Name} {
		if candidate != "" {
			return candidate
		}
	}
	return ""
}

func headsign(t *transportation) string {
	if t.Destination == nil {
		return ""
	}
	return t.Destination.Name
}

// endpointStation prefers the station over the platform: a trip leg endpoint is
// a platform ("Central Station, Platform 12", id 2000332) whose parent is the
// station the client asked for (id 200060).
func endpointStation(p place) place {
	if p.Parent != nil && p.Parent.Type == "stop" {
		return *p.Parent
	}
	return p
}

// stationName produces a display name: "Central Station, Platform 12" and
// "Central Station, Sydney" both become "Central Station".
func stationName(p place) string {
	name := p.DisassembledName
	if name == "" {
		name = p.Name
	}
	return strings.TrimSpace(platformSuffix.ReplaceAllString(name, ""))
}

func effective(estimated, scheduled time.Time) time.Time {
	if !estimated.IsZero() {
		return estimated
	}
	return scheduled
}

func parseTime(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

// formatTime renders an instant in Australia/Sydney local offset, which is
// +10:00 or +11:00 depending on DST — never hardcode either.
func formatTime(t time.Time, loc *time.Location) string {
	if t.IsZero() {
		return ""
	}
	return t.In(loc).Format(time.RFC3339)
}

func formatTimePtr(t time.Time, loc *time.Location) *string {
	if t.IsZero() {
		return nil
	}
	s := formatTime(t, loc)
	return &s
}
