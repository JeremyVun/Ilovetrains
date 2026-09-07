package native

import (
	"bufio"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	sydneyZone         = "Australia/Sydney"
	stopTimeWindow     = 3 * time.Hour
	headerWindowBefore = 24 * time.Hour
	headerWindowAfter  = 24 * time.Hour
)

type dateOutcome int

const (
	dateResolved dateOutcome = iota
	dateUnknown
	dateAmbiguous
	dateNoInstance
)

type tripCalendar struct {
	firstDepartureSecs int32
	startDate          int32
	endDate            int32
	weekdays           uint8
	added              []int32
	removed            []int32
}

type ServiceDates struct {
	trips    map[string]tripCalendar
	location *time.Location
}

type serviceInstance struct {
	date  string
	start time.Time
}

func LoadServiceDates(dir string) (*ServiceDates, error) {
	payload, err := os.ReadFile(filepath.Join(dir, "manifest.json"))
	if err != nil {
		return nil, err
	}
	var manifest Manifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return nil, fmt.Errorf("native timetable: decode %s: %w", dir, err)
	}
	if manifest.TripIndex == nil {
		return &ServiceDates{}, nil
	}
	return loadTripIndex(filepath.Join(dir, manifest.TripIndex.Name), manifest.TripIndex.SHA256)
}

func loadTripIndex(path, digest string) (*ServiceDates, error) {
	location, err := time.LoadLocation(sydneyZone)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	hash := sha256.New()
	tee := io.TeeReader(file, hash)
	reader, err := gzip.NewReader(tee)
	if err != nil {
		return nil, fmt.Errorf("native timetable: trip index %s: %w", filepath.Base(path), err)
	}
	dates := &ServiceDates{trips: make(map[string]tripCalendar), location: location}
	scanner := bufio.NewScanner(reader)
	line := 0
	for scanner.Scan() {
		line++
		fields := strings.Split(scanner.Text(), "\t")
		if len(fields) != 8 {
			return nil, fmt.Errorf("native timetable: trip index line %d has %d fields", line, len(fields))
		}
		calendar, err := parseTripCalendar(fields)
		if err != nil {
			return nil, fmt.Errorf("native timetable: trip index line %d: %w", line, err)
		}
		dates.trips[fields[0]+"\x00"+fields[1]] = calendar
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	if err := reader.Close(); err != nil {
		return nil, err
	}
	if _, err := io.Copy(io.Discard, tee); err != nil {
		return nil, err
	}
	if hex.EncodeToString(hash.Sum(nil)) != digest {
		return nil, errors.New("native timetable: trip index hash mismatch")
	}
	return dates, nil
}

func parseTripCalendar(fields []string) (tripCalendar, error) {
	numbers := make([]int32, 4)
	for index, field := range fields[2:6] {
		value, err := strconv.ParseInt(field, 10, 32)
		if err != nil {
			return tripCalendar{}, err
		}
		numbers[index] = int32(value)
	}
	if numbers[3] < 0 || numbers[3] > 127 {
		return tripCalendar{}, fmt.Errorf("invalid weekday mask %d", numbers[3])
	}
	added, err := parseDateList(fields[6])
	if err != nil {
		return tripCalendar{}, err
	}
	removed, err := parseDateList(fields[7])
	if err != nil {
		return tripCalendar{}, err
	}
	return tripCalendar{
		firstDepartureSecs: numbers[0], startDate: numbers[1], endDate: numbers[2],
		weekdays: uint8(numbers[3]), added: added, removed: removed,
	}, nil
}

func parseDateList(field string) ([]int32, error) {
	if field == "" {
		return nil, nil
	}
	parts := strings.Split(field, ",")
	result := make([]int32, 0, len(parts))
	for _, part := range parts {
		value, err := strconv.ParseInt(part, 10, 32)
		if err != nil {
			return nil, err
		}
		result = append(result, int32(value))
	}
	return result, nil
}

func (s *ServiceDates) Len() int {
	if s == nil {
		return 0
	}
	return len(s.trips)
}

func (s *ServiceDates) resolve(source, tripID string, header, stopTime time.Time) (string, dateOutcome) {
	if s == nil || s.location == nil {
		return "", dateUnknown
	}
	calendar, ok := s.trips[source+"\x00"+tripID]
	if !ok {
		return "", dateUnknown
	}
	local := header.In(s.location)
	candidates := make([]serviceInstance, 0, 3)
	for offset := -1; offset <= 1; offset++ {
		day := time.Date(local.Year(), local.Month(), local.Day()+offset, 12, 0, 0, 0, s.location)
		compact := int32(day.Year()*10000 + int(day.Month())*100 + day.Day())
		if !calendar.runsOn(compact, mondayIndex(day.Weekday())) {
			continue
		}
		candidates = append(candidates, serviceInstance{
			date:  strconv.FormatInt(int64(compact), 10),
			start: time.Date(day.Year(), day.Month(), day.Day(), 0, 0, int(calendar.firstDepartureSecs), 0, s.location),
		})
	}
	date, outcome := "", dateNoInstance
	if !stopTime.IsZero() {
		date, outcome = nearestInstance(candidates, stopTime, stopTimeWindow, stopTimeWindow)
	}
	if outcome == dateNoInstance {
		date, outcome = nearestInstance(candidates, header, headerWindowBefore, headerWindowAfter)
	}
	if outcome == dateNoInstance {
		return "", dateAmbiguous
	}
	return date, outcome
}

func nearestInstance(candidates []serviceInstance, target time.Time, before, after time.Duration) (string, dateOutcome) {
	best, bestDistance, tied := "", time.Duration(0), false
	for _, candidate := range candidates {
		offset := candidate.start.Sub(target)
		if offset < -before || offset > after {
			continue
		}
		distance := offset
		if distance < 0 {
			distance = -distance
		}
		switch {
		case best == "" || distance < bestDistance:
			best, bestDistance, tied = candidate.date, distance, false
		case distance == bestDistance:
			tied = true
		}
	}
	switch {
	case best == "":
		return "", dateNoInstance
	case tied:
		return "", dateAmbiguous
	}
	return best, dateResolved
}

func (c tripCalendar) runsOn(date int32, weekday int) bool {
	for _, exception := range c.added {
		if exception == date {
			return true
		}
	}
	if date < c.startDate || date > c.endDate || c.weekdays&(1<<weekday) == 0 {
		return false
	}
	for _, exception := range c.removed {
		if exception == date {
			return false
		}
	}
	return true
}

func mondayIndex(day time.Weekday) int {
	return (int(day) + 6) % 7
}
