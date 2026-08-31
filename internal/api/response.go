package api

import (
	"encoding/json"
	"errors"
	"net/http"
)

// errorBody is the contract's error envelope.
type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// clientError is a request the caller can fix. It is cacheable, because the
// same bad query always produces it.
type clientError struct {
	code    string
	message string
}

func (e clientError) Error() string { return e.code + ": " + e.message }

func badRequest(message string) error {
	return clientError{code: "bad_request", message: message}
}

// writeData writes a successful payload with the endpoint's cache policy,
// flagging data served from cache after an upstream failure.
func writeData(w http.ResponseWriter, cacheControl string, stale bool, body any) {
	if stale {
		w.Header().Set("X-Data-Stale", "true")
	}
	writeJSON(w, http.StatusOK, cacheControl, body)
}

func writeError(w http.ResponseWriter, err error) {
	var clientErr clientError
	if errors.As(err, &clientErr) {
		writeJSON(w, http.StatusBadRequest, errorCacheableControl,
			errorBody{errorDetail{clientErr.code, clientErr.message}})
		return
	}
	status, code := upstreamStatus(err)
	writeJSON(w, status, noStore, errorBody{errorDetail{code, upstreamMessage(code)}})
}

// upstreamMessage keeps upstream error text out of our responses: it can echo
// request details and is not ours to expose.
func upstreamMessage(code string) string {
	if code == "upstream_timeout" {
		return "Transport for NSW did not respond in time."
	}
	return "Transport for NSW is not responding."
}

func handleNotFound(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, errorCacheableControl,
		errorBody{errorDetail{"not_found", "No such endpoint."}})
}

func writeJSON(w http.ResponseWriter, status int, cacheControl string, body any) {
	payload, err := json.Marshal(body)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "application/json; charset=utf-8")
	h.Set("Cache-Control", cacheControl)
	// The only permitted Vary: responses never depend on who is asking.
	h.Set("Vary", "Accept-Encoding")
	w.WriteHeader(status)
	_, _ = w.Write(append(payload, '\n'))
}
