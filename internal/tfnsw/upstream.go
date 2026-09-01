package tfnsw

// Upstream (TfNSW Trip Planner, rapidJSON) response shapes. Only the fields we
// consume are declared; see docs/references/tfnsw-open-data.md for verified
// behavior and tools/fixtures/*.json for real captured responses.
//
// Note: `systemMessages` is deliberately not consumed. Successful stop_finder
// responses carry entries with type "error" (code -8011, empty text), so
// success is judged by HTTP status and payload content only.

type stopFinderResponse struct {
	Version   string  `json:"version"`
	Locations []place `json:"locations"`
}

type tripResponse struct {
	Version  string    `json:"version"`
	Journeys []journey `json:"journeys"`
}

type journey struct {
	Interchanges int   `json:"interchanges"`
	Legs         []leg `json:"legs"`
}

type leg struct {
	Duration             int             `json:"duration"`
	IsRealtimeControlled bool            `json:"isRealtimeControlled"`
	RealtimeStatus       []string        `json:"realtimeStatus"`
	Origin               place           `json:"origin"`
	Destination          place           `json:"destination"`
	Transportation       *transportation `json:"transportation"`
}

// place covers both stop_finder locations and trip leg endpoints; the upstream
// uses one shape for both.
type place struct {
	ID               string      `json:"id"`
	Name             string      `json:"name"`
	DisassembledName string      `json:"disassembledName"`
	Type             string      `json:"type"`
	MatchQuality     int         `json:"matchQuality"`
	IsBest           bool        `json:"isBest"`
	Modes            []int       `json:"modes"`
	Parent           *place      `json:"parent"`
	Properties       *properties `json:"properties"`

	// Coord is [latitude, longitude] under coordOutputFormat=EPSG:4326 — see
	// coordLat/coordLon in map.go for the evidence that fixes the axis order.
	Coord []float64 `json:"coord"`

	DepartureTimePlanned   string `json:"departureTimePlanned"`
	DepartureTimeEstimated string `json:"departureTimeEstimated"`
	ArrivalTimePlanned     string `json:"arrivalTimePlanned"`
	ArrivalTimeEstimated   string `json:"arrivalTimeEstimated"`
}

type properties struct {
	PlatformName        string `json:"platformName"`
	PlannedPlatformName string `json:"plannedPlatformName"`
}

type transportation struct {
	Name             string    `json:"name"`
	DisassembledName string    `json:"disassembledName"`
	Number           string    `json:"number"`
	Product          product   `json:"product"`
	Destination      *namedRef `json:"destination"`
}

type product struct {
	Class int    `json:"class"`
	Name  string `json:"name"`
}

type namedRef struct {
	Name string `json:"name"`
}
