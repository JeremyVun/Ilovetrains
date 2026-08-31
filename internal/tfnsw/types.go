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

// Journey is one departure from origin to destination.
type Journey struct {
	Departure           Departure `json:"departure"`
	Arrival             Arrival   `json:"arrival"`
	Line                Line      `json:"line"`
	DestinationHeadsign string    `json:"destinationHeadsign"`
	StopsAway           *int      `json:"stopsAway"`
	Cancelled           bool      `json:"cancelled"`
	Legs                int       `json:"legs"`
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
