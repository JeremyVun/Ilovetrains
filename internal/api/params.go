package api

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
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

func searchText(value string) (string, error) {
	value = strings.TrimSpace(value)
	if len([]rune(value)) < minQueryLength {
		return "", badRequest(fmt.Sprintf("q must be at least %d characters", minQueryLength))
	}
	return value, nil
}
