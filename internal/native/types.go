// Package native publishes shared timetable and realtime data for native clients.
package native

import "time"

const SchemaVersion = 1

var Sources = []string{"sydneytrains", "nswtrains", "metro", "ferries", "mff"}

type Manifest struct {
	SchemaVersion   int                `json:"schemaVersion"`
	GeneratedAt     time.Time          `json:"generatedAt"`
	ExpiresAt       time.Time          `json:"expiresAt"`
	ServiceDateFrom string             `json:"serviceDateFrom"`
	ServiceDateTo   string             `json:"serviceDateTo"`
	Packages        []TimetablePackage `json:"packages"`
	TripIndex       *TripIndex         `json:"tripIndex,omitempty"`
}

type TripIndex struct {
	Name   string `json:"name"`
	SHA256 string `json:"sha256"`
}

type TimetablePackage struct {
	Source          string `json:"source"`
	SchemaVersion   int    `json:"schemaVersion"`
	SHA256          string `json:"sha256"`
	URL             string `json:"url"`
	Bytes           int64  `json:"bytes"`
	ServiceDateFrom string `json:"serviceDateFrom"`
	ServiceDateTo   string `json:"serviceDateTo"`
}

type Snapshot struct {
	SchemaVersion   int          `json:"schemaVersion"`
	Source          string       `json:"source"`
	HeaderTimestamp time.Time    `json:"headerTimestamp"`
	GeneratedAt     time.Time    `json:"generatedAt"`
	ExpiresAt       time.Time    `json:"expiresAt"`
	Updates         []TripUpdate `json:"updates"`
}

type TripUpdate struct {
	TripID       string       `json:"tripId"`
	ServiceDate  string       `json:"serviceDate"`
	RouteID      string       `json:"routeId,omitempty"`
	StartTime    string       `json:"startTime,omitempty"`
	DirectionID  *uint32      `json:"directionId,omitempty"`
	Status       string       `json:"status"`
	Timestamp    *time.Time   `json:"timestamp,omitempty"`
	DelaySeconds *int32       `json:"delaySeconds,omitempty"`
	StopUpdates  []StopUpdate `json:"stopUpdates"`
}

type StopUpdate struct {
	StopID                string  `json:"stopId,omitempty"`
	StopSequence          *uint32 `json:"stopSequence,omitempty"`
	AssignedStopID        string  `json:"assignedStopId,omitempty"`
	ArrivalMs             *int64  `json:"arrivalMs,omitempty"`
	DepartureMs           *int64  `json:"departureMs,omitempty"`
	ArrivalDelaySeconds   *int32  `json:"arrivalDelaySeconds,omitempty"`
	DepartureDelaySeconds *int32  `json:"departureDelaySeconds,omitempty"`
	ScheduleRelationship  string  `json:"scheduleRelationship"`
}

type RealtimeCounts struct {
	Raw       int
	Accepted  int
	Unknown   int
	Ambiguous int
	Stale     int
	Duplicate int
}

type Representation struct {
	JSON []byte
	GZIP []byte
	ETag string
}

type RealtimeData struct {
	Snapshot       Snapshot
	Representation Representation
	Stale          bool
	index          map[string]int
}
