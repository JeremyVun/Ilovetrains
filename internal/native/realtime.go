package native

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"time"

	gtfs "github.com/MobilityData/gtfs-realtime-bindings/golang/gtfs"
	"google.golang.org/protobuf/proto"
)

const (
	realtimeLifetime      = 90 * time.Second
	scheduledTimestampAge = 10 * time.Minute
	timestampSkewAhead    = 5 * time.Second
)

func NormalizeRealtime(source string, body []byte, receivedAt time.Time, dates *ServiceDates) (Snapshot, Representation, RealtimeCounts, error) {
	var counts RealtimeCounts
	if !validSource(source) {
		return Snapshot{}, Representation{}, counts, errors.New("unknown realtime source")
	}
	var feed gtfs.FeedMessage
	if err := proto.Unmarshal(body, &feed); err != nil {
		return Snapshot{}, Representation{}, counts, fmt.Errorf("decode GTFS realtime: %w", err)
	}
	if feed.Header == nil || feed.Header.GetIncrementality() != gtfs.FeedHeader_FULL_DATASET {
		return Snapshot{}, Representation{}, counts, errors.New("realtime feed is not FULL_DATASET")
	}
	headerSeconds := feed.Header.GetTimestamp()
	if headerSeconds == 0 {
		return Snapshot{}, Representation{}, counts, errors.New("realtime feed has no source timestamp")
	}
	headerTime := time.Unix(int64(headerSeconds), 0).UTC()
	if headerTime.After(receivedAt.Add(5 * time.Minute)) {
		return Snapshot{}, Representation{}, counts, errors.New("realtime source timestamp is in the future")
	}

	type identified struct {
		raw         *gtfs.TripUpdate
		tripID      string
		serviceDate string
	}
	resolved := make([]identified, 0, len(feed.Entity))
	occurrences := make(map[string]int, len(feed.Entity))
	for _, entity := range feed.Entity {
		raw := entity.GetTripUpdate()
		if raw == nil {
			continue
		}
		counts.Raw++
		if raw.Trip == nil {
			continue
		}
		tripID, serviceDate := raw.Trip.GetTripId(), raw.Trip.GetStartDate()
		if tripID == "" {
			counts.Unknown++
			continue
		}
		if !validServiceDate(serviceDate) {
			date, outcome := dates.resolve(source, tripID, headerTime, earliestStopTime(raw))
			switch outcome {
			case dateUnknown:
				counts.Unknown++
				continue
			case dateAmbiguous:
				counts.Ambiguous++
				continue
			}
			serviceDate = date
		}
		resolved = append(resolved, identified{raw: raw, tripID: tripID, serviceDate: serviceDate})
		occurrences[tripID+"\x00"+serviceDate]++
	}

	updates := make([]TripUpdate, 0, len(resolved))
	for _, item := range resolved {
		raw, tripID, serviceDate := item.raw, item.tripID, item.serviceDate
		if occurrences[tripID+"\x00"+serviceDate] != 1 {
			counts.Duplicate++
			continue
		}
		status, ok := tripStatus(raw.Trip.GetScheduleRelationship())
		if !ok {
			continue
		}
		update := TripUpdate{
			TripID: tripID, ServiceDate: serviceDate, RouteID: raw.Trip.GetRouteId(),
			StartTime: raw.Trip.GetStartTime(), Status: status,
			StopUpdates: make([]StopUpdate, 0, len(raw.StopTimeUpdate)),
		}
		if raw.Trip.DirectionId != nil {
			value := raw.Trip.GetDirectionId()
			update.DirectionID = &value
		}
		if raw.Timestamp != nil && raw.GetTimestamp() != 0 {
			value := time.Unix(int64(raw.GetTimestamp()), 0).UTC()
			if !usableObservation(status, value, headerTime) {
				counts.Stale++
				continue
			}
			update.Timestamp = &value
		}
		if raw.Delay != nil {
			value := raw.GetDelay()
			update.DelaySeconds = &value
		}
		for _, rawStop := range raw.StopTimeUpdate {
			if stop, ok := normalizeStop(rawStop); ok {
				update.StopUpdates = append(update.StopUpdates, stop)
			}
		}
		updates = append(updates, update)
	}
	sort.Slice(updates, func(i, j int) bool {
		if updates[i].ServiceDate != updates[j].ServiceDate {
			return updates[i].ServiceDate < updates[j].ServiceDate
		}
		return updates[i].TripID < updates[j].TripID
	})

	counts.Accepted = len(updates)
	snapshot := Snapshot{
		SchemaVersion: SchemaVersion, Source: source, HeaderTimestamp: headerTime,
		GeneratedAt: receivedAt.UTC(), ExpiresAt: headerTime.Add(realtimeLifetime), Updates: updates,
	}
	representation, err := encodeSnapshot(snapshot)
	return snapshot, representation, counts, err
}

// A cancellation, replacement, addition or unscheduled run stays true for the rest of its
// service day; only a delay prediction decays.
func usableObservation(status string, timestamp, header time.Time) bool {
	if timestamp.After(header.Add(timestampSkewAhead)) {
		return false
	}
	return status != "scheduled" || !timestamp.Before(header.Add(-scheduledTimestampAge))
}

func earliestStopTime(update *gtfs.TripUpdate) time.Time {
	earliest := int64(0)
	for _, stop := range update.GetStopTimeUpdate() {
		for _, event := range []*gtfs.TripUpdate_StopTimeEvent{stop.GetArrival(), stop.GetDeparture()} {
			if event == nil || event.Time == nil || event.GetTime() <= 0 {
				continue
			}
			if earliest == 0 || event.GetTime() < earliest {
				earliest = event.GetTime()
			}
		}
	}
	if earliest == 0 {
		return time.Time{}
	}
	return time.Unix(earliest, 0).UTC()
}

func normalizeStop(raw *gtfs.TripUpdate_StopTimeUpdate) (StopUpdate, bool) {
	if raw == nil {
		return StopUpdate{}, false
	}
	relationship, ok := stopStatus(raw.GetScheduleRelationship())
	if !ok {
		return StopUpdate{}, false
	}
	stop := StopUpdate{
		StopID: raw.GetStopId(), AssignedStopID: raw.GetStopTimeProperties().GetAssignedStopId(),
		ScheduleRelationship: relationship,
	}
	if raw.StopSequence != nil {
		value := raw.GetStopSequence()
		stop.StopSequence = &value
	}
	if stop.StopID == "" && stop.StopSequence == nil {
		return StopUpdate{}, false
	}
	if event := raw.GetArrival(); event != nil {
		if event.Time != nil {
			value := event.GetTime() * 1000
			stop.ArrivalMs = &value
		}
		if event.Delay != nil {
			value := event.GetDelay()
			stop.ArrivalDelaySeconds = &value
		}
	}
	if event := raw.GetDeparture(); event != nil {
		if event.Time != nil {
			value := event.GetTime() * 1000
			stop.DepartureMs = &value
		}
		if event.Delay != nil {
			value := event.GetDelay()
			stop.DepartureDelaySeconds = &value
		}
	}
	return stop, true
}

func tripStatus(value gtfs.TripDescriptor_ScheduleRelationship) (string, bool) {
	switch value {
	case gtfs.TripDescriptor_SCHEDULED:
		return "scheduled", true
	case gtfs.TripDescriptor_ADDED:
		return "added", true
	case gtfs.TripDescriptor_UNSCHEDULED:
		return "unscheduled", true
	case gtfs.TripDescriptor_CANCELED:
		return "cancelled", true
	case gtfs.TripDescriptor_REPLACEMENT:
		return "replacement", true
	default:
		return "", false
	}
}

func stopStatus(value gtfs.TripUpdate_StopTimeUpdate_ScheduleRelationship) (string, bool) {
	switch value {
	case gtfs.TripUpdate_StopTimeUpdate_SCHEDULED:
		return "scheduled", true
	case gtfs.TripUpdate_StopTimeUpdate_SKIPPED:
		return "skipped", true
	case gtfs.TripUpdate_StopTimeUpdate_NO_DATA:
		return "noData", true
	case gtfs.TripUpdate_StopTimeUpdate_UNSCHEDULED:
		return "unscheduled", true
	default:
		return "", false
	}
}

func encodeSnapshot(snapshot Snapshot) (Representation, error) {
	payload, err := json.Marshal(snapshot)
	if err != nil {
		return Representation{}, err
	}
	payload = append(payload, '\n')
	var compressed bytes.Buffer
	writer, _ := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
	writer.Header.ModTime = time.Time{}
	if _, err := writer.Write(payload); err != nil {
		return Representation{}, err
	}
	if err := writer.Close(); err != nil {
		return Representation{}, err
	}
	sum := sha256.Sum256(payload)
	return Representation{JSON: payload, GZIP: compressed.Bytes(), ETag: `"` + hex.EncodeToString(sum[:]) + `"`}, nil
}

func validSource(source string) bool {
	for _, candidate := range Sources {
		if source == candidate {
			return true
		}
	}
	return false
}

func validServiceDate(value string) bool {
	if len(value) != 8 {
		return false
	}
	_, err := time.Parse("20060102", value)
	return err == nil
}
