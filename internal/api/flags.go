package api

import "net/http"

// Flags is the evaluated feature-flag source. Evaluation takes no context
// because the server holds no identity to evaluate against: a flag is on or
// off for everyone.
type Flags interface {
	Bool(key string, def bool) bool
	Version() string
}

func WithFlags(flags Flags) Option {
	return func(server *Server) { server.flags = flags }
}

const transferLimitFlag = "transferLimit"

// publicFlags is the set GET /api/v1/flags names. The server publishes the
// flags it knows clients read; it never forwards a snapshot.
var publicFlags = []string{transferLimitFlag}

// FlagsResponse is the body of GET /api/v1/flags.
type FlagsResponse struct {
	Version string          `json:"version"`
	Flags   map[string]bool `json:"flags"`
}

func (s *Server) handleFlags(w http.ResponseWriter, _ *http.Request) {
	body := FlagsResponse{Flags: make(map[string]bool, len(publicFlags))}
	if s.flags != nil {
		body.Version = s.flags.Version()
	}
	for _, key := range publicFlags {
		body.Flags[key] = s.flagOn(key)
	}
	writeJSON(w, http.StatusOK, flagsCacheControl, body)
}

func (s *Server) flagOn(key string) bool {
	if s.flags == nil {
		return false
	}
	return s.flags.Bool(key, false)
}

func (s *Server) transferLimitOn() bool { return s.flagOn(transferLimitFlag) }
