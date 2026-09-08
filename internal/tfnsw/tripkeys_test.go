package tfnsw

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLegsCarryFeedJoinKeysOffTheWire(t *testing.T) {
	got, err := mapTrip(fixture(t, "trip_central_parramatta.json"), "200060", "215020", 6,
		mustParse(t, "2026-08-31T12:47:00Z"), sydney(t))
	if err != nil {
		t.Fatalf("mapTrip: %v", err)
	}
	leg := got.Journeys[0].LegDetail[0]
	want := []string{"145T.1396.158.12.A.8.90984066", "3001.nsw-2-T1-W.1.TA.2999.sj2"}
	if len(leg.TripIDs) != 2 || leg.TripIDs[0] != want[0] || leg.TripIDs[1] != want[1] {
		t.Errorf("TripIDs = %q, want %q", leg.TripIDs, want)
	}
	if leg.OriginStopID != "2000332" {
		t.Errorf("OriginStopID = %q, want the boarding platform 2000332", leg.OriginStopID)
	}
	wire, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(wire), "145T.1396") || strings.Contains(string(wire), "OriginStopID") {
		t.Errorf("join keys leaked onto the wire")
	}
}
