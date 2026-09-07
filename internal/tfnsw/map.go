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
	classFerry = 9
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

var boardingSuffix = regexp.MustCompile(`,\s*(?:Platform|Wharf|Side)\s.*$`)

func modeName(class int) (Mode, bool) {
	switch class {
	case classTrain:
		return ModeTrain, true
	case classMetro:
		return ModeMetro, true
	case classFerry:
		return ModeFerry, true
	}
	return "", false
}

// mapTrip turns a trip payload into our departures response. fromID/toID are
// echoed back as requested so the response is a pure function of the query;
// station names come from the journeys themselves.
func mapTrip(body []byte, fromID, toID string, limit int, generatedAt time.Time, loc *time.Location) (*DeparturesResponse, error) {
	return mapTripWithPolicy(body, fromID, toID, limit, generatedAt, loc, defaultConnectionPolicy())
}

// connectionPolicy bounds the planned change between two services. Zero
// disables either bound.
type connectionPolicy struct {
	Minimum time.Duration
	Maximum time.Duration
}

func defaultConnectionPolicy() connectionPolicy {
	return connectionPolicy{Minimum: DefaultMinimumConnectionTime, Maximum: DefaultMaximumConnectionTime}
}

// plannedJourney is a mapped journey with the planned times the pruning rules
// read, so they judge the printed plan the same way the connection floor does.
type plannedJourney struct {
	journey       Journey
	effective     time.Time
	departure     time.Time
	arrival       time.Time
	longestChange time.Duration
}

type servicePath struct {
	legs  []leg
	walks [][]leg
}

func mapTripWithPolicy(body []byte, fromID, toID string, limit int, generatedAt time.Time,
	loc *time.Location, policy connectionPolicy) (*DeparturesResponse, error) {
	return mapTripWithOptions(body, fromID, toID, limit, generatedAt, loc, policy,
		DeparturesOptions{Modes: AllModes(), TransferLimit: NoTransferLimit})
}

func mapTripWithOptions(body []byte, fromID, toID string, limit int, generatedAt time.Time,
	loc *time.Location, policy connectionPolicy, options DeparturesOptions) (*DeparturesResponse, error) {
	modes, err := CanonicalModes(options.Modes)
	if err != nil {
		return nil, fmt.Errorf("tfnsw: modes: %w", err)
	}
	allowed := make(map[Mode]bool, len(modes))
	for _, mode := range modes {
		allowed[mode] = true
	}
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

	var rows []plannedJourney

	for _, j := range raw.Journeys {
		path, serveable := serviceLegsWithModes(j, allowed)
		// Dropped here, before the limit below, so the client still receives up
		// to `limit` journeys it can actually take.
		if !serveable || len(path.legs) == 0 {
			continue
		}
		if options.TransferLimit >= 0 && len(path.legs)-1 > options.TransferLimit {
			continue
		}
		if !connectionFloorMet(path, policy.Minimum) {
			continue
		}
		first, last := path.legs[0], path.legs[len(path.legs)-1]
		// The response cannot describe a walk before boarding or after alighting at another stop.
		if (walkingLeg(j.Legs[0]) && endpointStation(first.Origin).ID != fromID) ||
			(walkingLeg(j.Legs[len(j.Legs)-1]) && endpointStation(last.Destination).ID != toID) {
			continue
		}

		schedDep, ok := parseTime(first.Origin.DepartureTimePlanned)
		if !ok {
			continue
		}
		estDep := realtime(first, first.Origin.DepartureTimeEstimated)
		schedArr, _ := parseTime(last.Destination.ArrivalTimePlanned)
		estArr := realtime(last, last.Destination.ArrivalTimeEstimated)

		mode, _ := modeName(first.Transportation.Product.Class)
		row := plannedJourney{
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
					Mode: string(mode),
				},
				DestinationHeadsign: headsign(first.Transportation),
				// stopsAway needs live vehicle position data the Trip Planner
				// does not carry; the contract allows null.
				StopsAway: nil,
				Cancelled: cancelled(path.legs),
				Legs:      len(path.legs),
				LegDetail: legDetail(path.legs, loc),
			},
			effective:     effective(estDep, schedDep),
			departure:     schedDep,
			arrival:       schedArr,
			longestChange: longestConnection(path),
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
	rows = pruneLongWaits(rows, policy.Maximum)
	for i, row := range rows {
		if limit > 0 && i >= limit {
			break
		}
		resp.Journeys = append(resp.Journeys, row.journey)
	}
	return resp, nil
}

// connectionFloorMet uses the printed plan, not a transient realtime delay.
// The floor decides whether the planner may offer the route; live shrinkage is
// still shown honestly by the client's tight-change treatment.
func connectionFloorMet(path servicePath, minimum time.Duration) bool {
	if len(path.legs) < 2 {
		return true
	}
	for i := 1; i < len(path.legs); i++ {
		connection, ok := plannedConnection(path, i)
		if !ok || (minimum > 0 && connection < minimum) {
			return false
		}
	}
	return true
}

func longestConnection(path servicePath) time.Duration {
	var longest time.Duration
	for i := 1; i < len(path.legs); i++ {
		connection, ok := plannedConnection(path, i)
		if ok && connection > longest {
			longest = connection
		}
	}
	return longest
}

func plannedConnection(path servicePath, next int) (time.Duration, bool) {
	arrival, arrivalOK := parseTime(path.legs[next-1].Destination.ArrivalTimePlanned)
	departure, departureOK := parseTime(path.legs[next].Origin.DepartureTimePlanned)
	if !arrivalOK || !departureOK {
		return 0, false
	}
	connection := departure.Sub(arrival)
	if connection < 0 {
		return 0, false
	}
	var walks []leg
	if next-1 < len(path.walks) {
		walks = path.walks[next-1]
	}
	for _, walk := range walks {
		duration, ok := walkingDuration(walk)
		if !ok {
			return 0, false
		}
		if duration > connection {
			return 0, false
		}
		connection -= duration
	}
	return connection, true
}

func walkingDuration(walk leg) (time.Duration, bool) {
	if walk.Duration != nil {
		seconds := int64(*walk.Duration)
		if seconds < 0 || seconds > int64(1<<63-1)/int64(time.Second) {
			return 0, false
		}
		return time.Duration(seconds) * time.Second, true
	}
	departure, departureOK := parseTime(walk.Origin.DepartureTimePlanned)
	arrival, arrivalOK := parseTime(walk.Destination.ArrivalTimePlanned)
	if !departureOK || !arrivalOK {
		return 0, false
	}
	duration := arrival.Sub(departure)
	if duration < 0 {
		return 0, false
	}
	return duration, true
}

func walkingLeg(l leg) bool {
	return l.Transportation != nil &&
		(l.Transportation.Product.Class == classFootpath || l.Transportation.Product.Class == classConnection)
}

// Upstream never charges for waiting, so after a line closes it offers the
// last train out with a three-hour change to arrive minutes before the first
// sane morning trip. Judged latest-first so only surviving journeys count as
// the better alternative; the last train of the night keeps its long change.
func pruneLongWaits(rows []plannedJourney, ceiling time.Duration) []plannedJourney {
	if ceiling <= 0 {
		return rows
	}
	kept := make([]plannedJourney, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		row := rows[i]
		if row.longestChange > ceiling && laterArrivesWithin(kept, row) {
			continue
		}
		kept = append(kept, row)
	}
	for i, j := 0, len(kept)-1; i < j; i, j = i+1, j-1 {
		kept[i], kept[j] = kept[j], kept[i]
	}
	return kept
}

func laterArrivesWithin(later []plannedJourney, row plannedJourney) bool {
	deadline := row.arrival.Add(row.longestChange)
	for _, candidate := range later {
		if candidate.departure.After(row.departure) && candidate.arrival.Before(deadline) {
			return true
		}
	}
	return false
}

// serviceLegs returns the served legs of a journey, dropping walking segments
// from the response while retaining them for the connection policy.
//
// serveable is false when the journey rides something we neither serve nor
// walk — On Demand buses (class 10) leak past the exclMOT exclusions, and a
// journey you cannot take by a served mode is not an answer to this board's
// question,
// so the caller drops the whole journey rather than pretending the bus leg
// away and offering a trip that starts at the wrong station.
func serviceLegs(j journey) (path servicePath, serveable bool) {
	all := make(map[Mode]bool, len(servedModes))
	for _, mode := range servedModes {
		all[mode] = true
	}
	return serviceLegsWithModes(j, all)
}

func serviceLegsWithModes(j journey, allowed map[Mode]bool) (path servicePath, serveable bool) {
	var pendingWalks []leg
	for _, l := range j.Legs {
		if l.Transportation == nil {
			continue
		}
		switch l.Transportation.Product.Class {
		case classTrain, classMetro, classFerry:
			mode, _ := modeName(l.Transportation.Product.Class)
			if !allowed[mode] {
				return servicePath{}, false
			}
			if len(path.legs) > 0 {
				path.walks = append(path.walks, pendingWalks)
			}
			path.legs = append(path.legs, l)
			pendingWalks = nil
		case classFootpath, classConnection:
			if len(path.legs) > 0 {
				pendingWalks = append(pendingWalks, l)
			}
		default:
			return servicePath{}, false
		}
	}
	return path, true
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
			Line:     Line{Name: lineName(l.Transportation), Mode: string(mode)},
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

// stationName keeps a wharf's real name while removing its boarding suffix.
func stationName(p place) string {
	name := p.DisassembledName
	if name == "" {
		name = p.Name
	}
	return strings.TrimSpace(boardingSuffix.ReplaceAllString(name, ""))
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

func emptyDepartures(from, to string, at, generatedAt time.Time, loc *time.Location) *DeparturesResponse {
	return &DeparturesResponse{
		From:        Place{ID: from},
		To:          Place{ID: to},
		GeneratedAt: formatTime(generatedAt, loc),
		At:          formatTimePtr(at, loc),
		Journeys:    []Journey{},
	}
}
