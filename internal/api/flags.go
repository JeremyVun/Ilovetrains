package api

import "net/http"

// Only supported, public, evaluated values may reach a client. Missing,
// unconfigured, private and invalid values all leave the toy off.
func (s *Server) handleFlags(w http.ResponseWriter, r *http.Request) {
	enabled := false
	if s.publicFlags != nil {
		enabled, _ = s.publicFlags()["tiny_train"].(bool)
	}
	writeJSON(w, http.StatusOK, noStore, map[string]bool{"tiny_train": enabled})
}
