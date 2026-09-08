package native

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"sync"
	"time"

	"trains/internal/analytics"
)

const (
	defaultRealtimeInterval = 60 * time.Second
	realtimeFetchTimeout    = 20 * time.Second
)

var ErrUnavailable = errors.New("native data unavailable")

type Config struct {
	Fetcher           FeedFetcher
	DataDir           string
	BootstrapDir      string
	CompilerPath      string
	RealtimeInterval  time.Duration
	TimetableInterval time.Duration
	Now               func() time.Time
	Logf              func(string, ...any)
	Emit              func([]analytics.Event)
}

type realtimeState struct {
	mu         sync.Mutex
	condition  Conditional
	data       *RealtimeData
	flight     chan struct{}
	sourceHash [sha256.Size]byte
	hasHash    bool
}

type Service struct {
	fetcher          FeedFetcher
	now              func() time.Time
	realtimeInterval time.Duration
	realtime         map[string]*realtimeState
	timetable        *timetableStore
	accuracy         *accuracyTracker
	logf             func(string, ...any)
}

func NewService(config Config) (*Service, error) {
	if config.Fetcher == nil {
		return nil, errors.New("native data: feed fetcher is required")
	}
	if config.Now == nil {
		config.Now = time.Now
	}
	if config.RealtimeInterval <= 0 {
		config.RealtimeInterval = defaultRealtimeInterval
	}
	store, err := newTimetableStore(config)
	if err != nil {
		return nil, err
	}
	service := &Service{
		fetcher: config.Fetcher, now: config.Now, realtimeInterval: config.RealtimeInterval,
		realtime: make(map[string]*realtimeState, len(Sources)), timetable: store, logf: config.Logf,
		accuracy: newAccuracyTracker(config.Emit),
	}
	for _, source := range Sources {
		service.realtime[source] = &realtimeState{}
	}
	return service, nil
}

func (s *Service) Run(ctx context.Context) {
	go s.timetable.run(ctx)
	if err := s.RefreshRealtime(ctx); err != nil && s.logf != nil {
		s.logf("native realtime refresh: %v", err)
	}
	ticker := time.NewTicker(s.realtimeInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := s.RefreshRealtime(ctx); err != nil && s.logf != nil {
				s.logf("native realtime refresh: %v", err)
			}
		}
	}
}

func (s *Service) RefreshRealtime(ctx context.Context) error {
	var wg sync.WaitGroup
	errs := make(chan error, len(Sources))
	for _, source := range Sources {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fetchCtx, cancel := context.WithTimeout(ctx, realtimeFetchTimeout)
			defer cancel()
			if err := s.refreshSource(fetchCtx, source); err != nil {
				errs <- fmt.Errorf("%s: %w", source, err)
			}
		}()
	}
	wg.Wait()
	close(errs)
	var joined error
	for err := range errs {
		joined = errors.Join(joined, err)
	}
	s.accuracy.summarize(s.logf, s.now(), false)
	return joined
}

func (s *Service) Realtime(ctx context.Context, source string) (RealtimeData, error) {
	state, ok := s.realtime[source]
	if !ok {
		return RealtimeData{}, errors.New("unknown realtime source")
	}
	state.mu.Lock()
	data := state.data
	state.mu.Unlock()
	if data == nil {
		fetchCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), realtimeFetchTimeout)
		defer cancel()
		if err := s.refreshSource(fetchCtx, source); err != nil {
			return RealtimeData{}, fmt.Errorf("%w: %v", ErrUnavailable, err)
		}
		state.mu.Lock()
		data = state.data
		state.mu.Unlock()
	}
	if data == nil {
		return RealtimeData{}, ErrUnavailable
	}
	result := *data
	result.Stale = s.now().After(result.Snapshot.ExpiresAt)
	return result, nil
}

func (s *Service) refreshSource(ctx context.Context, source string) error {
	state, ok := s.realtime[source]
	if !ok {
		return errors.New("unknown realtime source")
	}
	state.mu.Lock()
	if state.flight != nil {
		flight := state.flight
		state.mu.Unlock()
		select {
		case <-flight:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	flight := make(chan struct{})
	state.flight = flight
	condition := state.condition
	previousHash, hasHash := state.sourceHash, state.hasHash
	state.mu.Unlock()

	result, err := s.fetcher.FetchRealtime(ctx, source, condition)
	var data *RealtimeData
	var counts RealtimeCounts
	if err == nil && !result.NotModified {
		sourceHash := sha256.Sum256(result.Body)
		if !hasHash || sourceHash != previousHash {
			snapshot, representation, resolution, normalizeErr := NormalizeRealtime(source, result.Body, s.now(), s.timetable.serviceDates())
			if normalizeErr != nil {
				err = normalizeErr
			} else {
				data = &RealtimeData{Snapshot: snapshot, Representation: representation, index: tripIndex(snapshot)}
				counts = resolution
			}
		}
	}

	state.mu.Lock()
	if err == nil {
		if result.NotModified && state.data == nil {
			err = errors.New("upstream returned not modified without a cached snapshot")
		} else {
			if data != nil {
				state.data = data
			}
			if !result.NotModified {
				state.sourceHash = sha256.Sum256(result.Body)
				state.hasHash = true
			}
			if result.ETag != "" {
				state.condition.ETag = result.ETag
			}
			if result.LastModified != "" {
				state.condition.LastModified = result.LastModified
			}
		}
	}
	state.flight = nil
	close(flight)
	state.mu.Unlock()
	if err == nil && data != nil {
		s.logCounts(source, counts, data.Snapshot.GeneratedAt.Sub(data.Snapshot.HeaderTimestamp))
		s.accuracy.observe(data.Snapshot)
	}
	return err
}

func (s *Service) logCounts(source string, counts RealtimeCounts, headerAge time.Duration) {
	if s.logf == nil {
		return
	}
	s.logf("realtime source=%s raw=%d accepted=%d unknown=%d ambiguous=%d stale=%d duplicate=%d header_age=%s",
		source, counts.Raw, counts.Accepted, counts.Unknown, counts.Ambiguous, counts.Stale, counts.Duplicate,
		headerAge.Round(time.Second))
	if counts.Raw > 0 && counts.Accepted == 0 {
		s.logf("realtime warning source=%s published nothing from %d updates", source, counts.Raw)
	}
}

// TripMatch is the latest realtime update a set of upstream trip identifiers
// resolves to, across every feed source.
type TripMatch struct {
	Source string
	Update TripUpdate
	Header time.Time
	Stale  bool
}

func (s *Service) LookupTrip(ids ...string) (TripMatch, bool) {
	for _, source := range Sources {
		state := s.realtime[source]
		state.mu.Lock()
		data := state.data
		state.mu.Unlock()
		if data == nil {
			continue
		}
		for _, id := range ids {
			if position, ok := data.index[id]; ok {
				return TripMatch{
					Source: source, Update: data.Snapshot.Updates[position], Header: data.Snapshot.HeaderTimestamp,
					Stale: s.now().After(data.Snapshot.ExpiresAt),
				}, true
			}
		}
	}
	return TripMatch{}, false
}

func tripIndex(snapshot Snapshot) map[string]int {
	index := make(map[string]int, len(snapshot.Updates))
	for position, update := range snapshot.Updates {
		if _, seen := index[update.TripID]; !seen {
			index[update.TripID] = position
		}
	}
	return index
}
