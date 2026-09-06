package api

import (
	"net/http"
	"os"
	"strconv"
	"strings"

	"trains/internal/native"
)

const (
	timetableManifestCacheControl = "public, s-maxage=300, stale-while-revalidate=86400"
	timetablePackageCacheControl  = "public, max-age=31536000, immutable"
	realtimeCacheControl          = "public, max-age=0, s-maxage=15, stale-while-revalidate=30"
)

func (s *Server) handleTimetableManifest(w http.ResponseWriter, r *http.Request) {
	_, representation, err := s.native.Manifest()
	if err != nil {
		writeNativeUnavailable(w)
		return
	}
	writeRepresentation(w, r, timetableManifestCacheControl, representation, false, false)
}

func (s *Server) handleTimetablePackage(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("package")
	if !strings.HasSuffix(name, ".zip") {
		handleNotFound(w, r)
		return
	}
	hash := strings.TrimSuffix(name, ".zip")
	path, ok := s.native.PackagePath(hash)
	if !ok {
		handleNotFound(w, r)
		return
	}
	etag := `"` + hash + `"`
	setSharedHeaders(w.Header(), timetablePackageCacheControl, etag)
	if requestMatches(r, etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		writeNativeUnavailable(w)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		writeNativeUnavailable(w)
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	http.ServeContent(w, r, name, info.ModTime(), file)
}

func (s *Server) handleRealtime(w http.ResponseWriter, r *http.Request) {
	data, err := s.native.Realtime(r.Context(), r.PathValue("source"))
	if err != nil {
		if strings.Contains(err.Error(), "unknown realtime source") {
			handleNotFound(w, r)
			return
		}
		writeNativeUnavailable(w)
		return
	}
	writeRepresentation(w, r, realtimeCacheControl, data.Representation, true, data.Stale)
}

func writeRepresentation(w http.ResponseWriter, r *http.Request, cacheControl string,
	representation native.Representation, allowGZIP, stale bool) {
	setSharedHeaders(w.Header(), cacheControl, representation.ETag)
	if stale {
		w.Header().Set("X-Data-Stale", "true")
	}
	if requestMatches(r, representation.ETag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	payload := representation.JSON
	if allowGZIP && acceptsGZIP(r.Header.Get("Accept-Encoding")) {
		payload = representation.GZIP
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", stringInt(int64(len(payload))))
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = w.Write(payload)
}

func setSharedHeaders(header http.Header, cacheControl, etag string) {
	header.Set("Cache-Control", cacheControl)
	header.Set("ETag", etag)
	header.Set("Vary", "Accept-Encoding")
}

func requestMatches(r *http.Request, etag string) bool {
	for value := range strings.SplitSeq(r.Header.Get("If-None-Match"), ",") {
		value = strings.TrimSpace(value)
		if value == "*" || value == etag || strings.TrimPrefix(value, "W/") == etag {
			return true
		}
	}
	return false
}

func acceptsGZIP(value string) bool {
	for coding := range strings.SplitSeq(value, ",") {
		parts := strings.Split(strings.TrimSpace(coding), ";")
		if strings.EqualFold(parts[0], "gzip") {
			for _, parameter := range parts[1:] {
				if strings.TrimSpace(parameter) == "q=0" {
					return false
				}
			}
			return true
		}
	}
	return false
}

func writeNativeUnavailable(w http.ResponseWriter) {
	writeJSON(w, http.StatusServiceUnavailable, noStore,
		errorBody{errorDetail{"data_unavailable", "Transit data is temporarily unavailable."}})
}

func stringInt(value int64) string {
	return strconv.FormatInt(value, 10)
}
