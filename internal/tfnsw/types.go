package tfnsw

// The types in this file are the wire shapes served by our own API. They are
// defined by docs/contracts/api.md; changing a JSON tag here is a contract
// change. Pointer fields are deliberately not `omitempty`: the contract says
// unknown values are served as explicit null, never omitted and never faked.

// Place identifies a station in a departures response.
type Place struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Departure is the origin end of a journey.
type Departure struct {
	Scheduled string  `json:"scheduled"`
	Estimated *string `json:"estimated"`
	Platform  *string `json:"platform"`
}

// Arrival is the destination end of a journey.
type Arrival struct {
	Scheduled string  `json:"scheduled"`
	Estimated *string `json:"estimated"`
}

// Line describes the service operating a journey. Mode is "train" or "metro".
type Line struct {
	Name string `json:"name"`
	Mode string `json:"mode"`
}

// LegPlace is one end of a service leg: the station, plus the platform the
// service uses there (null when upstream does not say).
type LegPlace struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Platform *string `json:"platform"`
}

// LegTime is a scheduled/estimated pair at one end of a leg. Estimated is null
// unless that leg is realtime-controlled, exactly as at the journey level.
type LegTime struct {
	Scheduled string  `json:"scheduled"`
	Estimated *string `json:"estimated"`
}

// Leg is one train or metro service inside a journey. Walking between legs is
// not a leg; it lives in the gap between one leg's arrival and the next leg's
// departure.
type Leg struct {
	Line      Line     `json:"line"`
	Headsign  string   `json:"headsign"`
	From      LegPlace `json:"from"`
	To        LegPlace `json:"to"`
	Departure LegTime  `json:"departure"`
	Arrival   LegTime  `json:"arrival"`
	Cancelled bool     `json:"cancelled"`
}

// Journey is one departure from origin to destination. LegDetail always has
// Legs entries; the journey-level fields mirror the first and last of them.
type Journey struct {
	Departure           Departure `json:"departure"`
	Arrival             Arrival   `json:"arrival"`
	Line                Line      `json:"line"`
	DestinationHeadsign string    `json:"destinationHeadsign"`
	StopsAway           *int      `json:"stopsAway"`
	Cancelled           bool      `json:"cancelled"`
	Legs                int       `json:"legs"`
	LegDetail           []Leg     `json:"legDetail"`
}

// DeparturesResponse is the body of GET /api/v1/departures.
type DeparturesResponse struct {
	From        Place     `json:"from"`
	To          Place     `json:"to"`
	GeneratedAt string    `json:"generatedAt"`
	Journeys    []Journey `json:"journeys"`
}

// Stop is one station in a stop search result.
type Stop struct {
	ID    string   `json:"id"`
	Name  string   `json:"name"`
	Modes []string `json:"modes"`
}

// StopsResponse is the body of GET /api/v1/stops.
type StopsResponse struct {
	Stops []Stop `json:"stops"`
}
