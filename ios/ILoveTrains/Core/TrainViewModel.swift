import Foundation
import Combine

@MainActor
final class TrainViewModel: ObservableObject {
    @Published var state = AppState()
    @Published var feedbackDraft = ""
    @Published var feedbackCategory = "problem"
    private let store: DeviceStore
    private let api: TransitAPI
    private let planner: OfflinePlanner
    private var data = UserData()
    private var fix: Fix?
    private var explicit = false
    private var generation = 0
    private var sharedGeneration = 0
    private var boardTask: Task<Void, Never>?
    private var focusTask: Task<Void, Never>?
    private var historyTask: Task<Void, Never>?
    private var realtimeTask: Task<Void, Never>?
    private var loop: Task<Void, Never>?
    private var writeTask: Task<Void, Never>?
    private var bootstrap: Task<Void, Error>?
    private var historyRecorded = false
    private var settingsBack: Screen = .home
    private var lastTimetableCheck = 0.0
    private var lastRealtimeAttempt = 0.0
    private var active = false
    private var redirect: FocusedJourney?
    private var redirectTargetId: String?
    let location = LocationService()
    #if DEBUG
    var seeded = false
    var networkDisabled = false
    #endif

    init(store: DeviceStore = DeviceStore(), api: TransitAPI = TransitAPI(), planner: OfflinePlanner = OfflinePlanner()) {
        self.api = api; self.planner = planner
        #if DEBUG
        if let domain = ProcessInfo.processInfo.environment["ILOVETRAINS_TEST_DOMAIN"], UUID(uuidString: domain) != nil {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("UITests/" + domain)
            self.store = DeviceStore(directory: directory)
        } else { self.store = store }
        #else
        self.store = store
        #endif
        location.onPermission = { [weak self] granted, denied in self?.state.locationGranted = granted; self?.state.locationDenied = denied }
        location.onFix = { [weak self] in self?.receiveLocation($0) }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--offline") { networkDisabled = true }
        if configureCalibration() { seeded = true; return }
        #endif
        bootstrap = Task { try await planner.initialize() }
        Task { await start() }
    }

    private func start() async {
        data = await store.load()
        state.stations = (try? await store.stations()) ?? []
        settleFocus(); choosePrediction(); syncPersonal()
        if let pair = ends(), let cached = await store.cached(from: pair.0, to: pair.1, modes: data.modes) {
            publish(retainedOfflineBoard(cached), request: generation)
        }
        state.ready = true; state.screen = data.trips.isEmpty ? .setup : .home
        refresh()
        do { try await bootstrap?.value; state.timetableStatus = await planner.coverageDescription }
        catch { state.timetableStatus = "Offline timetable unavailable. Download it in Settings." }
        if active { refreshSharedData(); silentLocation() }
    }

    private func persist() {
        #if DEBUG
        if seeded { return }
        #endif
        let snapshot = data; let previous = writeTask
        writeTask = Task {
            await previous?.value
            do { try await store.save(snapshot) }
            catch { state.message = "Couldn’t save changes on this phone. Free some storage and try again." }
        }
    }
    private func currentFocus() -> FocusedJourney? { visibleFocus(data: data, now: state.now) }
    private func syncPersonal() {
        let focus = currentFocus()
        let first = focus?.tripId ?? state.selectedTripId
        state.trips = data.trips.filter { compatible($0, modes: data.modes) }.sorted { a, b in
            if (a.id == first) != (b.id == first) { return a.id == first }
            let score: (SavedTrip) -> Double = { trip in max(historyScore(events: self.data.history, tripId: trip.id, reverse: false, now: self.state.now), historyScore(events: self.data.history, tripId: trip.id, reverse: true, now: self.state.now)) }
            let sa = score(a), sb = score(b)
            return sa == sb ? a.createdAt < b.createdAt : sa > sb
        }
        state.totalTrips = data.trips.count; state.focus = focus
        state.focusComplete = focus.map { f in data.rides.contains { $0.tripId == f.tripId && $0.reverse == f.reverse && $0.departure == f.journey.departure } } ?? false
        state.appearance = data.appearance; state.enabledModes = data.modes; state.useLocation = data.useLocation
        state.automaticHome = automaticHome(data: data); state.home = data.home ?? state.automaticHome; state.homeIsManual = data.home != nil
        state.recentFrom = data.recentFrom; state.recentTo = data.recentTo
        state.tripMetadata = savedTripMetadata(data: data, fix: fix, selectedTripId: state.selectedTripId, selectedReverse: state.reverse, now: state.now)
        state.homeBoard = focus?.board ?? state.board
    }
    private func choosePrediction() {
        if explicit, data.trips.contains(where: { $0.id == state.selectedTripId && compatible($0, modes: data.modes) }) { return }
        let focus = currentFocus()
        let selected = focus.map { Selection(tripId: $0.tripId, reverse: $0.reverse) } ?? predict(data: data, stations: state.stations, fix: fix, now: state.now)
        let changed = state.selectedTripId != selected?.tripId || state.reverse != (selected?.reverse ?? false)
        state.selectedTripId = selected?.tripId; state.reverse = selected?.reverse ?? false; state.receipt = selected?.receipt
        if changed { state.board = nil }
    }
    private func ends(id: String? = nil, reverse: Bool? = nil) -> (Station, Station)? {
        guard let trip = data.trips.first(where: { $0.id == (id ?? state.selectedTripId) }) else { return nil }
        return (reverse ?? state.reverse) ? (trip.to, trip.from) : (trip.from, trip.to)
    }

    func resume() {
        active = true
        #if DEBUG
        if seeded { return }
        #endif
        guard loop == nil else { return }
        state.now = epochNow(); location.refreshPermission()
        if state.ready { settleFocus(); choosePrediction(); syncPersonal(); refresh(); refreshSharedData(); silentLocation() }
        loop = Task { [weak self] in
            var ticks = 0
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard let self else { return }
                self.state.now = epochNow(); ticks += 1
                self.settleFocus()
                if ticks % 30 == 0, self.state.ready { self.refreshSharedData(); self.refresh() }
            }
        }
    }
    func pause() {
        active = false; loop?.cancel(); loop = nil
        boardTask?.cancel(); focusTask?.cancel(); historyTask?.cancel(); realtimeTask?.cancel(); realtimeTask = nil
        generation += 1; sharedGeneration += 1; state.refreshing = false; state.distanceMetres = nil
        fix = nil; location.stop()
    }
    private func silentLocation() {
        guard data.useLocation, active, state.screen == .home || state.screen == .setup else { return }
        location.request(prompt: false)
    }
    private var canNetwork: Bool {
        #if DEBUG
        if networkDisabled || seeded { return false }
        #endif
        return true
    }

    func refresh() {
        #if DEBUG
        if seeded { return }
        #endif
        guard state.ready, active else { return }
        boardTask?.cancel(); generation += 1
        let request = generation; let modes = data.modes; let now = state.now
        guard let pair = ends(), !modes.isEmpty else { state.board = nil; state.refreshing = false; syncPersonal(); refreshFocus(); return }
        let id = state.selectedTripId; let reverse = state.reverse
        state.refreshing = true
        boardTask = Task {
            let cached = await store.cached(from: pair.0, to: pair.1, modes: modes)
            guard request == generation, !Task.isCancelled else { return }
            let previous = state.board.flatMap { board in
                board.from.id == pair.0.id && board.to.id == pair.1.id ? board : nil
            } ?? cached
            if state.board == nil, let cached { publish(retainedOfflineBoard(cached), request: request) }
            var local: BoardData?; var online: BoardData?
            await withTaskGroup(of: (Bool, BoardData?).self) { group in
                let planner = self.planner, api = self.api, bootstrap = self.bootstrap, network = self.canNetwork
                group.addTask { do { try await bootstrap?.value; return (false, try await planner.plan(from: pair.0, to: pair.1, at: now - 900_000, modes: modes, limit: 24)) } catch { return (false, nil) } }
                if network { group.addTask { (true, try? await api.departures(from: pair.0, to: pair.1, modes: modes)) } }
                for await (isOnline, result) in group {
                    guard request == generation, !Task.isCancelled else { group.cancelAll(); return }
                    if isOnline { online = result } else { local = result }
                    if result != nil,
                       let merged = mergeBoardResults(previous: previous, local: local, online: online, now: now) {
                        publish(merged, request: request)
                    }
                }
            }
            guard request == generation, !Task.isCancelled else { return }
            let result = mergeBoardResults(previous: previous, local: local, online: online, now: now)
                ?? BoardData(from: pair.0, to: pair.1, journeys: [], generatedAt: 0, offline: true, error: "No timetable available for this trip")
            publish(result, request: request); state.refreshing = false
            try? await store.cache(state.board ?? result, modes: modes)
            guard request == generation, !Task.isCancelled else { return }
            resolveRedirect(result)
            let liveEvidence = [online, local].compactMap { $0 }.first { $0.isLive(now) }
            if let lead = result.journeys.first(where: { !$0.cancelled && $0.effectiveDeparture >= now }), let id {
                if let index = data.trips.firstIndex(where: { $0.id == id }) { data.trips[index].lines = Array(Set(lead.legs.map(\.line))).sorted() }
                let freshlyObserved = liveEvidence?.journeys.contains { $0.key == lead.key && $0.retained != true } == true
                if data.focus == nil, state.screen == .home, lead.retained != true, freshlyObserved {
                    let here = stationHere(data: data, stations: state.stations, fix: fix, now: now)
                    let stationId = here.flatMap { station in fix.map { distanceMetres($0, station) <= 200 ? station.id : nil } ?? nil }
                    data.lastAnswer = LastAnswer(tripId: id, reverse: reverse, at: now, stationId: stationId, board: result, journey: lead)
                }
                persist(); syncPersonal()
            }
        }
        refreshFocus()
    }
    private func merge(_ older: [Journey], _ newer: [Journey]) -> [Journey] {
        var values = Dictionary(older.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
        newer.forEach { values[$0.key] = $0 }
        return values.values.sorted { $0.effectiveDeparture < $1.effectiveDeparture }
    }
    private func publish(_ board: BoardData?, request: Int) {
        guard request == generation else { return }
        var remembered = board
        if let board { remembered?.homeJourneyKey = nextHomeJourney(board, now: state.now)?.key }
        state.board = remembered
        if let detail = state.detail {
            if let new = remembered?.journeys.first(where: { $0.key == detail.key }) {
                state.detail = new
            } else {
                var retained = detail
                retained.retained = true
                state.detail = retained
            }
        }
        syncPersonal()
    }
    private func refreshSharedData() {
        guard canNetwork, realtimeTask == nil, state.now - lastRealtimeAttempt >= 25_000 else { return }
        lastRealtimeAttempt = state.now
        sharedGeneration += 1
        let sharedRequest = sharedGeneration
        realtimeTask = Task {
            defer { if sharedRequest == sharedGeneration { realtimeTask = nil } }
            do {
                try await bootstrap?.value
                try await planner.refreshRealtime(baseURL: api.baseURL)
                guard !Task.isCancelled, active, sharedRequest == sharedGeneration else { return }
                if let focus = data.focus, focus.journey.legs.allSatisfy({ $0.identity != nil }) {
                    let update = await planner.refreshFocused(focus.journey)
                    let alternatives = try? await planner.plan(from: focus.board.from, to: focus.board.to, at: state.now - 900_000, modes: allModes, limit: 24)
                    guard !Task.isCancelled, sharedRequest == sharedGeneration, active else { return }
                    if sameFocus(focus) {
                        var refreshed = focus; refreshed.journey = update.journey
                        refreshed.board.journeys = [update.journey]
                        refreshed.alternatives = alternatives
                        refreshed.board.generatedAt = update.observedAt ?? focus.board.generatedAt
                        refreshed.board.source = update.live ? "live" : "schedule"; refreshed.board.offline = !update.live; refreshed.board.serverStale = false
                        data.focus = update.live ? refreshed : focus.lastKnown(); settleFocus(); persist(); syncPersonal()
                    }
                }
                if state.board?.isLive(state.now) != true { refresh() }
                if state.now - lastTimetableCheck >= 21_600_000 {
                    lastTimetableCheck = state.now
                    try await planner.update(baseURL: api.baseURL)
                    state.timetableStatus = await planner.coverageDescription
                }
            } catch { }
        }
    }
    private func sameFocus(_ focus: FocusedJourney) -> Bool {
        data.focus.map { $0.tripId == focus.tripId && $0.reverse == focus.reverse && $0.journey.key == focus.journey.key } ?? false
    }
    private func refreshFocus() {
        guard let focus = data.focus, !focus.journey.legs.allSatisfy({ $0.identity != nil }), canNetwork else { return }
        focusTask?.cancel()
        focusTask = Task {
            guard let pair = ends(id: focus.tripId, reverse: focus.reverse) else { return }
            let at = focus.journey.departure < state.now ? max(state.now - 86_400_000, focus.journey.departure) : nil
            let result = try? await api.departures(from: pair.0, to: pair.1, modes: allModes, at: at)
            guard !Task.isCancelled, sameFocus(focus) else { return }
            if let result, let match = result.journeys.first(where: { $0.key == focus.journey.key }) {
                var updated = focus; updated.board = result; updated.alternatives = nil; updated.journey = match; data.focus = updated
            } else { data.focus = focus.lastKnown() }
            settleFocus(); persist(); syncPersonal()
        }
    }
    private func settleFocus() {
        guard var focus = data.focus else { return }
        var changed = false
        if !focus.board.isLive(state.now), focus.journey.retained != true, focus.journey.realtime || focus.journey.cancelled {
            focus = focus.lastKnown(); data.focus = focus; changed = true
        }
        if state.now >= focus.journey.effectiveArrival, !focus.journey.cancelled { completeRide(focus) }
        if state.now > focus.journey.effectiveArrival + 1_800_000 { data.focus = nil; changed = true }
        if changed { persist() }
        syncPersonal()
    }
    private func completeRide(_ focus: FocusedJourney) {
        guard !data.rides.contains(where: { $0.tripId == focus.tripId && $0.reverse == focus.reverse && $0.departure == focus.journey.departure }) else { return }
        data.rides.append(Ride(tripId: focus.tripId, reverse: focus.reverse, departure: focus.journey.departure, arrival: focus.journey.effectiveArrival, from: focus.journey.legs.first?.from, to: focus.journey.legs.last?.to))
        data.rides = Array(data.rides.suffix(100)); persist()
    }
    func receiveLocation(_ value: Fix) {
        #if DEBUG
        let current = seeded ? state.now : epochNow()
        #else
        let current = epochNow()
        #endif
        state.now = current
        guard data.useLocation, active, state.screen == .home || state.screen == .setup, (0...300_000).contains(current - value.at) else { return }
        fix = value
        let here = stationHere(data: data, stations: state.stations, fix: value, now: current)
        if state.screen == .home, let here {
            let format = DateFormatter(); format.timeZone = sydneyZone; format.dateFormat = "yyyy-MM-dd"
            let day = format.string(from: Date(timeIntervalSince1970: current / 1000))
            if !data.votes.contains(where: { $0.day == day }) { data.votes.append(HomeVote(day: day, station: here)); data.votes = Array(data.votes.suffix(7)); persist() }
        }
        if let inferred = inferredFocus(data: data, fix: value, now: current) { data.focus = inferred; persist() }
        if let focus = data.focus, let to = focus.journey.legs.last?.to, current >= focus.journey.effectiveArrival - 300_000, distanceMetres(value, to) <= 200 { completeRide(focus) }
        if state.screen == .setup, state.setupFrom == nil, !state.selectingHome { state.setupFrom = here }
        if !explicit, data.focus == nil, let here, let home = data.home ?? automaticHome(data: data), here.id != home.id,
           !data.trips.contains(where: { compatible($0, modes: data.modes) && ($0.from.id == here.id || $0.to.id == here.id) }), !home.modes.isDisjoint(with: data.modes) {
            addTrip(SavedTrip(id: UUID().uuidString, from: here, to: home, createdAt: current)); persist()
        }
        choosePrediction(); syncPersonal()
        if let origin = currentFocus()?.journey.legs.first?.from ?? ends()?.0 {
            let metres = distanceMetres(value, origin); state.distanceMetres = metres.isFinite ? Int(metres.rounded()) : nil
        }
        refresh()
    }

    func back() {
        historyTask?.cancel()
        switch state.screen {
        case .detail: state.screen = .board
        case .settings: state.screen = settingsBack; state.feedbackSucceeded = false
        case .setup: state.screen = state.selectingHome ? .settings : .home; redirect = nil; redirectTargetId = nil
        default: state.screen = .home
        }
        state.selectingHome = false
        if state.screen != .detail { state.detail = nil }
        if state.screen == .home { historyRecorded = false; choosePrediction(); syncPersonal(); silentLocation(); refresh() }
        if state.screen == .board { scheduleHistory() }
    }
    func openTrip(id: String, reverse: Bool = false) {
        guard let trip = data.trips.first(where: { $0.id == id }), compatible(trip, modes: data.modes) else { return }
        explicit = true; data.lastAnswer = nil; persist()
        let direction = id == state.selectedTripId && !reverse ? state.reverse : reverse
        if id != state.selectedTripId || state.reverse != direction { state.board = nil }
        state.selectedTripId = id; state.reverse = direction; state.screen = .board; state.detail = nil; state.receipt = nil
        syncPersonal(); historyRecorded = false; scheduleHistory(); refresh()
    }
    private func scheduleHistory() {
        historyTask?.cancel()
        historyTask = Task { do { try await Task.sleep(for: .seconds(5)) } catch { return }; if state.screen == .board { recordHistory() } }
    }
    private func recordHistory() {
        guard !historyRecorded, let id = state.selectedTripId else { return }
        data.history.append(ViewEvent(tripId: id, reverse: state.reverse, at: state.now)); data.history = Array(data.history.suffix(500))
        data.lastTripId = id; data.lastReverse = state.reverse
        if let index = data.trips.firstIndex(where: { $0.id == id }) { data.trips[index].lastViewed = state.now }
        historyRecorded = true; persist()
    }
    func reverseTrip() {
        data.lastAnswer = nil; persist(); state.reverse.toggle(); state.board = nil
        explicit = true; historyRecorded = false; scheduleHistory(); refresh()
    }
    func openJourney(_ journey: Journey) {
        if state.screen == .home {
            state.board = state.homeBoard ?? state.board
            if let focus = currentFocus() {
                if journey.key != focus.journey.key, let alternatives = focus.alternatives, alternatives.journeys.contains(where: { $0.key == journey.key }) { state.board = alternatives }
                state.selectedTripId = focus.tripId; state.reverse = focus.reverse
            }
        }
        recordHistory(); state.screen = .detail; state.detail = journey
    }
    func pinJourney(_ journey: Journey) {
        guard !journey.cancelled, let id = state.selectedTripId, var board = state.board, let pair = ends(), board.from.id == pair.0.id, board.to.id == pair.1.id else { return }
        board.journeys = merge(board.journeys, [journey])
        var focus = FocusedJourney(tripId: id, reverse: state.reverse, journey: journey, board: board)
        if !board.isLive(state.now), journey.realtime || journey.cancelled { focus = focus.lastKnown() }
        data.focus = focus; data.lastAnswer = nil; persist()
        state.screen = .home; state.detail = nil; historyRecorded = false; syncPersonal(); refresh()
    }
    func unpinJourney() {
        guard let focus = data.focus, focus.pinned else { return }
        data.focus = nil; data.lastAnswer = nil; persist(); state.selectedTripId = focus.tripId; state.reverse = focus.reverse
        explicit = true; state.screen = .home; state.detail = nil; syncPersonal(); refresh()
    }
    func showReturn() {
        guard let focus = data.focus else { return }
        data.focus = nil; data.lastAnswer = nil; persist(); explicit = true; historyRecorded = false
        state.selectedTripId = focus.tripId; state.reverse = !focus.reverse; state.screen = .home; state.board = nil; state.homeBoard = nil
        state.receipt = "You rode out at \(clockTime(focus.journey.effectiveDeparture)). Here’s the way back."
        syncPersonal(); refresh()
    }
    func newTrip() {
        redirect = currentFocus().flatMap { $0.pinned ? nil : $0 }
        redirectTargetId = nil
        state.screen = .setup; state.setupFrom = redirect?.journey.legs.first?.from; state.setupTo = nil; state.selectingHome = false
    }
    func chooseSetupFrom(_ station: Station) { state.setupFrom = station }
    func clearSetupFrom() { state.setupFrom = nil; state.setupTo = nil }
    func chooseSetupTo(_ station: Station) { state.setupTo = station }
    func clearSetupTo() { state.setupTo = nil }
    private func addTrip(_ trip: SavedTrip) {
        if data.trips.count >= 10, let evicted = data.trips.min(by: { ($0.lastViewed == 0 ? $0.createdAt : $0.lastViewed) < ($1.lastViewed == 0 ? $1.createdAt : $1.lastViewed) }) { removeTrip(evicted.id) }
        data.trips.append(trip)
    }
    func saveTrip(from: Station, to: Station) {
        guard from.id != to.id, !from.modes.isDisjoint(with: data.modes), !to.modes.isDisjoint(with: data.modes) else { return }
        let existing = data.trips.first { Set([$0.from.id, $0.to.id]) == Set([from.id, to.id]) }
        let trip = existing ?? SavedTrip(id: UUID().uuidString, from: from, to: to, createdAt: state.now)
        if existing == nil { addTrip(trip) }
        let reverse = existing?.to.id == from.id
        data.recentFrom = Array(([from] + data.recentFrom.filter { $0.id != from.id }).prefix(3))
        data.recentTo = Array(([to] + data.recentTo.filter { $0.id != to.id }).prefix(3))
        data.lastTripId = trip.id; data.lastReverse = reverse
        persist(); explicit = true; historyRecorded = false
        redirectTargetId = redirect == nil ? nil : trip.id
        state.screen = redirect == nil ? .home : .board; state.selectedTripId = trip.id; state.reverse = reverse
        state.setupFrom = nil; state.setupTo = nil; state.board = nil; state.receipt = nil
        syncPersonal(); refresh()
    }
    private func resolveRedirect(_ board: BoardData) {
        guard let old = redirect, let id = state.selectedTripId, id == redirectTargetId else { return }
        redirect = nil; redirectTargetId = nil
        if let lead = old.journey.legs.first, let match = board.journeys.first(where: { $0.legs.first?.line == lead.line && $0.legs.first?.departure == lead.departure }) {
            data.focus = FocusedJourney(tripId: id, reverse: state.reverse, journey: match, board: board, pinned: false); state.screen = .home
        }
    }
    private func removeTrip(_ id: String) {
        guard let trip = data.trips.first(where: { $0.id == id }) else { return }
        data.trips.removeAll { $0.id == id }; data.history.removeAll { $0.tripId == id }
        if data.focus?.tripId == id { data.focus = nil }
        if data.lastAnswer?.tripId == id { data.lastAnswer = nil }
        if data.lastTripId == id { data.lastTripId = nil }
        Task { try? await store.purgeCache(for: trip) }
    }
    func deleteTrip(id: String) {
        removeTrip(id); persist()
        if state.selectedTripId == id { explicit = false; state.board = nil }
        choosePrediction(); syncPersonal(); refresh()
    }
    func openSettings() { settingsBack = state.screen; state.screen = .settings; state.feedbackSucceeded = false }
    func setAppearance(_ value: Appearance) { data.appearance = value; persist(); syncPersonal() }
    func setMode(mode: String, enabled: Bool) {
        guard allModes.contains(mode) else { return }
        if enabled { data.modes.insert(mode) } else { data.modes.remove(mode) }
        persist(); state.board = nil; state.homeBoard = nil; choosePrediction(); syncPersonal(); refresh()
    }
    func setUseLocation(_ enabled: Bool) {
        data.useLocation = enabled
        if !enabled { fix = nil; state.distanceMetres = nil; location.stop() }
        persist(); syncPersonal()
        if enabled { requestLocation() } else { choosePrediction(); refresh() }
    }
    func requestLocation() { if data.useLocation { location.request(prompt: true) } }
    func chooseHome() { state.screen = .setup; state.selectingHome = true; state.setupFrom = nil; state.setupTo = nil }
    func setHome(_ station: Station?) { data.home = station; persist(); state.screen = .settings; state.selectingHome = false; syncPersonal() }
    func earlier() {
        guard let board = state.board else { return }
        let request = generation, modes = data.modes
        let earliest = board.journeys.map(\.departure).min() ?? state.now
        let at = max(earliest - 3_600_000, state.now - 86_400_000)
        guard earliest > state.now - 86_400_000 else { return }
        Task {
            guard let past = try? await planner.plan(from: board.from, to: board.to, at: at, modes: modes, limit: 30), request == generation, var current = state.board else { return }
            current.journeys = merge(past.journeys.filter { $0.departure >= state.now - 86_400_000 }.map { $0.scheduledOnly() }, current.journeys)
            publish(current, request: request)
        }
    }
    func updateTimetable() {
        guard !state.timetableUpdating else { return }
        state.timetableUpdating = true
        Task {
            defer { state.timetableUpdating = false }
            do {
                guard canNetwork else { throw TransitError.unavailable }
                try? await bootstrap?.value
                try await planner.update(baseURL: api.baseURL)
                bootstrap = Task { }; state.timetableStatus = await planner.coverageDescription; refresh()
            } catch { state.message = "Couldn’t update timetables. Your saved timetable is still available. Try again when you’re online." }
        }
    }
    func feedback(text: String, category: String = "problem") {
        guard !state.feedbackSubmitting else { return }
        state.feedbackSubmitting = true; state.feedbackSucceeded = false; state.message = nil
        Task {
            defer { state.feedbackSubmitting = false }
            do { try await api.feedback(text: text, category: category); state.feedbackSucceeded = true; feedbackDraft = ""; state.message = "Feedback sent. Thank you." }
            catch { state.message = "Couldn’t send feedback. Check your connection and try again." }
        }
    }
    func dismissMessage() { state.message = nil }
}

#if DEBUG
private extension TrainViewModel {
    func configureCalibration() -> Bool {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--calibration"), index + 1 < arguments.count else { return false }
        let name = arguments[index + 1]
        guard let url = Bundle.main.url(forResource: "calibration", withExtension: "json"),
              let bytes = try? Data(contentsOf: url), let catalogue = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return false }
        let key = name.contains("ferry") ? "ferry" : name.contains("two-change") ? "threeLeg" : name.contains("detail") || name.contains("active") || name.contains("inferred") || name.contains("pinned") ? "transfer" : "central"
        guard let entry = catalogue[key] as? [String: Any], let body = entry["body"] as? [String: Any],
              let bodyData = try? JSONSerialization.data(withJSONObject: body), var board = try? TransitWire.board(bodyData), let now = entry["now"] as? Double else { return false }
        state.now = now
        if name.contains("active") || name.contains("inferred") { state.now = entry["departedNow"] as? Double ?? now }
        board.generatedAt = state.now
        if name.contains("delayed"), !board.journeys.isEmpty {
            board.journeys[0].legs = board.journeys[0].legs.map { leg in var l = leg; l.estimatedDeparture = l.departure + 360_000; l.estimatedArrival = l.arrival + 360_000; return l }
        }
        if name.contains("cancelled"), !board.journeys.isEmpty { board.journeys[0].legs[0].cancelled = true }
        if name.contains("now"), let departure = board.journeys.first?.effectiveDeparture {
            state.now = departure
            board.generatedAt = departure
        }
        if name.contains("long"), !board.journeys.isEmpty {
            board.from.name = "North Wollongong Station"
            board.to.name = "Sydney Domestic Airport Station"
            board.journeys = board.journeys.map { journey in
                var copy = journey
                copy.legs[0].from = board.from
                copy.legs[copy.legs.count - 1].to = board.to
                if copy.legs.count > 1 {
                    let change = Station(id: copy.legs[0].to.id, name: "International Airport Station", modes: ["train"])
                    copy.legs[0].to = change
                    copy.legs[1].from = change
                }
                copy.legs[0].headsign = "Mount Victoria via Parramatta"
                return copy
            }
        }
        if name.contains("offline") { board = board.scheduledOnly() }
        if name.contains("retained") {
            state.now = entry["departedNow"] as? Double
                ?? board.journeys.first.map { $0.effectiveDeparture + 5 * 60_000 }
                ?? now
            board = retainedOfflineBoard(board)
            board.homeJourneyKey = board.journeys.first?.key
        }
        let trip = SavedTrip(id: "calibration-trip", from: board.from, to: board.to, createdAt: now, lines: Array(Set(board.journeys.first?.legs.map(\.line) ?? [])).sorted())
        data.trips = [trip]; data.appearance = name.contains("light") ? .light : .dark
        data.lastTripId = trip.id
        state.selectedTripId = trip.id; state.board = board; state.homeBoard = board
        if name.contains("pinned") || name.contains("active") || name.contains("inferred"), let journey = board.journeys.first {
            data.focus = FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board, pinned: !name.contains("inferred"))
        }
        if let stationsURL = Bundle.main.url(forResource: "stations", withExtension: "json"), let raw = try? Data(contentsOf: stationsURL), let stations = try? JSONSerialization.jsonObject(with: raw) as? [[String: Any]] {
            state.stations = stations.compactMap { try? TransitWire.station($0) }
        }
        if name.contains("detail") || name == "ferry" { state.screen = .detail; state.detail = board.journeys.first }
        else if name.contains("board") { state.screen = .board }
        else if name.contains("setup") { state.screen = .setup; state.setupFrom = board.from; data.recentTo = [board.to] }
        else if name.contains("settings") { state.screen = .settings }
        if name.contains("empty") { data.modes = []; state.board = nil }
        if name.contains("feedback-success") { state.message = "Feedback sent. Thank you." }
        state.ready = true; state.timetableStatus = "5 Sep – 4 Oct 2026"
        syncPersonal()
        return true
    }
}
#endif
