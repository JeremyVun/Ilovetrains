package stations

import (
	"math"
	"os"
	"testing"
)

// The table is generated from web/js/search.js itself. A value that changes
// here without changing there is drift between the two rankings.
func TestFuzzyScoreMatchesTheClient(t *testing.T) {
	cases := []struct {
		name  string
		query string
		want  int
	}{
		{"Central Station", "central", 1000},
		// n is "central" once "station" is stripped, so the full name is not
		// an exact match and is too far for the edit-distance floor.
		{"Central Station", "Central Station", 0},
		{"Central Station", "  CENTRAL  ", 1000},
		{"Central Coast", "central", 894},
		{"Central Coast", "centra", 893},
		{"Rhodes Station", "Rhode", 899},
		{"Roseville Station", "Rhode", 0},
		{"North Strathfield Station", "Rhode", 0},
		{"Rhodes Station", "rhodes", 1000},
		{"Rhodes Station", "rodhes", 450},
		{"Rhodes Station", "rhoda", 450},
		{"Bondi Junction Station", "junction", 790},
		{"Bondi Junction Station", "bondi", 891},
		{"Bondi Junction Station", "ondi", 699},
		{"Sydney Olympic Park Station", "park", 780},
		{"Olympic Park Station", "olympic park", 1000},
		{"Town Hall Station", "hall", 790},
		{"Town Hall Station", "xyzzy", 0},
		{"Central Station", "", 0},
		{"Mount Victoria Station", "mount vic", 895},
		{"Wynyard Station", "wynyad", 475},
	}
	for _, tc := range cases {
		if got := fuzzyScore(tc.name, tc.query); got != tc.want {
			t.Errorf("fuzzyScore(%q, %q) = %d, want %d", tc.name, tc.query, got, tc.want)
		}
	}
}

func TestFuzzyRankingPutsRhodesFirstForRhode(t *testing.T) {
	if fuzzyScore("Rhodes Station", "Rhode") <= fuzzyScore("Roseville Station", "Rhode") {
		t.Error("Rhodes must outrank Roseville for the partial Rhode")
	}
	if got := Search("rhode", 10); len(got) == 0 || got[0].Name != "Rhodes Station" {
		t.Errorf("Search(rhode)[0] = %+v, want Rhodes Station", got)
	}
}

func TestSearchRanksTheStationTheQueryNames(t *testing.T) {
	for _, tc := range []struct{ query, want string }{
		{"central", "Central Station"},
		{"central station", "Central Station"},
		{"town hall", "Town Hall Station"},
		{"bondi", "Bondi Junction Station"},
		{"tallawong", "Tallawong Station"},
		{"olympic park", "Olympic Park Station"},
	} {
		got := Search(tc.query, 10)
		if len(got) == 0 || got[0].Name != tc.want {
			t.Errorf("Search(%q)[0] = %+v, want %s", tc.query, got, tc.want)
		}
	}
}

func TestSearchHonoursTheLimitAndDropsNonMatches(t *testing.T) {
	if got := Search("st", 3); len(got) > 3 {
		t.Errorf("Search(st, 3) returned %d stops", len(got))
	}
	if got := Search("qqzzxx", 10); len(got) != 0 {
		t.Errorf("Search(qqzzxx) = %+v, want none", got)
	}
	if got := Search("", 10); len(got) != 0 {
		t.Errorf("Search(empty) = %+v, want none", got)
	}
}

func TestEveryStationHasAUsableLocation(t *testing.T) {
	for _, stop := range All() {
		if stop.ID == "" || stop.Name == "" || len(stop.Modes) == 0 {
			t.Errorf("incomplete station: %+v", stop)
		}
		if stop.Location == nil {
			t.Errorf("%s has no location", stop.Name)
			continue
		}
		if math.IsNaN(stop.Location.Lat) || math.IsInf(stop.Location.Lat, 0) ||
			math.IsNaN(stop.Location.Lon) || math.IsInf(stop.Location.Lon, 0) {
			t.Errorf("%s location is not finite: %+v", stop.Name, *stop.Location)
		}
	}
}

// The client loads its own copy of the same file; a divergence would give the
// two sides different station ids for the same name.
func TestEmbeddedIndexEqualsTheClientCopy(t *testing.T) {
	web, err := os.ReadFile("../../web/stations.json")
	if err != nil {
		t.Fatalf("reading web/stations.json: %v", err)
	}
	if string(web) != string(indexJSON) {
		t.Error("internal/stations/stations.json and web/stations.json differ; run node tools/build-stations.js")
	}
}
