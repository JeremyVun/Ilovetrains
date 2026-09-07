package api

import "net/http"

const transferLimitFlag = "transferLimit"

// The published name clients read, mapped to its flagsd key: flagsd validates
// keys as lower snake case, so the two spellings differ.
var publicFlagKeys = map[string]string{
	transferLimitFlag: "transfer_limit",
	"tiny_train":      "tiny_train",
}

// Only supported, public, evaluated values may reach a client. Missing,
// unconfigured, private and invalid values all read as off.
func (s *Server) handleFlags(w http.ResponseWriter, _ *http.Request) {
	values := make(map[string]bool, len(publicFlagKeys))
	for name := range publicFlagKeys {
		values[name] = s.flagOn(name)
	}
	writeJSON(w, http.StatusOK, noStore, values)
}

func (s *Server) flagOn(name string) bool {
	if s.publicFlags == nil {
		return false
	}
	on, _ := s.publicFlags()[publicFlagKeys[name]].(bool)
	return on
}

func (s *Server) transferLimitOn() bool { return s.flagOn(transferLimitFlag) }
