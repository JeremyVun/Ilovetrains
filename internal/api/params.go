package api

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// stopIDPattern matches TfNSW global stop IDs: "200060" (Central), "2155384"
// (Tallawong), "G50001" (interstate). Anything else is rejected here rather
// than forwarded, so junk never costs an upstream request.
var stopIDPattern = regexp.MustCompile(`^[A-Za-z0-9]{2,20}$`)

func stopID(value, param string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", badRequest(fmt.Sprintf("%s is required", param))
	}
	if !stopIDPattern.MatchString(value) {
		return "", badRequest(fmt.Sprintf("%s is not a valid stop id", param))
	}
	return value, nil
}

func journeyLimit(value string) (int, error) {
	if strings.TrimSpace(value) == "" {
		return defaultLimit, nil
	}
	limit, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return 0, badRequest("limit must be a whole number")
	}
	if limit < 1 || limit > maxLimit {
		return 0, badRequest(fmt.Sprintf("limit must be between 1 and %d", maxLimit))
	}
	return limit, nil
}

// departAt parses the optional `at` parameter into the bucket it falls in. A
// zero time means the caller did not ask for a window and wants now.
func departAt(value string, now time.Time) (time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, nil
	}
	parsed, ok := parseISOTime(value)
	if !ok {
		return time.Time{}, badRequest(
			"at must be an ISO 8601 time with an offset, e.g. 2026-09-01T17:30:00+10:00")
	}
	bucket := floorToBucket(parsed)
	// Every reachable bucket is a distinct cache key and a distinct potential
	// upstream request, so the paging window is a quota decision, not a
	// usability one: 26 hours of buckets is 157 keys per station pair and
	// limit. Both the bucket and the limits are floored, so the bounds are
	// exactly that many keys and a client that sends precisely `now - 24h` is
	// inside the window rather than 400ing on a rounding artefact.
	if bucket.Before(floorToBucket(now.Add(-maxPastWindow))) {
		return time.Time{}, badRequest("at must be within the last 24 hours")
	}
	if bucket.After(floorToBucket(now.Add(maxFutureWindow))) {
		return time.Time{}, badRequest("at must be no more than 2 hours in the future")
	}
	return bucket, nil
}

// parseISOTime reads an RFC 3339 timestamp, repairing the one mangling every
// client hits: `+` is a space in a URL query, so an offset that was not
// percent-encoded arrives as "2026-09-01T17:30:00 10:00". A space cannot occur
// anywhere else in a timestamp we accept, so restoring it is unambiguous —
// better than answering 400 to a request whose meaning is perfectly clear.
func parseISOTime(value string) (time.Time, bool) {
	for _, candidate := range []string{value, strings.Replace(value, " ", "+", 1)} {
		if parsed, err := time.Parse(time.RFC3339, candidate); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

// floorToBucket rounds an instant down to the start of its bucket.
//
// Truncate floors absolute time since the epoch, which is the same instant as
// flooring Sydney wall-clock time only because every Australia/Sydney offset
// (+10:00 AEST, +11:00 AEDT) is a whole number of hours and therefore a whole
// number of buckets. TestBucketMatchesSydneyWallClock holds that equivalence.
func floorToBucket(t time.Time) time.Time {
	return t.Truncate(bucketSize)
}

func searchText(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len([]rune(value)) < minQueryLength {
		return "", badRequest(fmt.Sprintf("q must be at least %d characters", minQueryLength))
	}
	return value, nil
}
