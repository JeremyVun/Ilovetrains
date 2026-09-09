import Foundation
import Combine

private enum BoardFetch: Sendable {
    case local(OfflinePlanResult?)
    case online(TransitAPI.DeparturePage?)
    case supplement(TransitAPI.DeparturePage)
}

@MainActor
final class TrainViewModel: ObservableObject {
    @Published var state = AppState()
    @Published var feedbackDraft = ""
    @Published var feedbackCategory = "problem"
    private let store: DeviceStore
    private let api: TransitAPI
    private let planner: OfflinePlanner
    private let tracker: TravelTrackerController
    private var data = UserData()
    private var fix: Fix?
    private var explicit = false
    private var generation = 0
    private var sharedGeneration = 0
    private var boardTask: Task<Void, Never>?
    private var supplementTask: Task<TransitAPI.DeparturePage, Never>?
    private var focusTask: Task<Void, Never>?
    private var focusRefreshGeneration = 0
    private var focusRefreshPending = false
    private var historyTask: Task<Void, Never>?
    private var earlierTask: Task<Void, Never>?
    private var realtimeTask: Task<Void, Never>?
    private var trackerTask: Task<Void, Never>?
    private var arrivalTask: Task<Void, Never>?
    private var loop: Task<Void, Never>?
    private var writeTask: Task<Void, Never>?
    private var bootstrap: Task<Void, Error>?
    private var historyRecorded = false
    private var settingsBack: Screen = .home
    private var lastTimetableCheck = 0.0
    private var lastRealtimeAttempt = 0.0
    private var recommendationPagingAt: [String: Millis] = [:]
    private var active = false
    private var setupOriginEdited = false
    private var setupLocationRequested = false
    private var setupLocationResolved = false
    private var suppressNextLastAnswer = false
    private var redirect: FocusedJourney?
    private var redirectTargetId: String?
    private var pendingDeletion: PendingDeletion?
    private var undoTask: Task<Void, Never>?
    private var pendingTrackerURL: URL?
    private var arrivalWindow: ArrivalWindow?
    private var arrivalPermissionPending = false
    private var arrivalResumeWaitUntil: Millis?
    private var arrivalGeneration = 0
    private let undoWindow: Duration
    let location: any LocationProviding
    #if DEBUG
    var seeded = false
    var networkDisabled = false
    private var trackerDebugCountdown: String?
    #endif

    init(
        store: DeviceStore = DeviceStore(),
        api: TransitAPI = TransitAPI(),
        planner: OfflinePlanner = OfflinePlanner(),
        tracker: TravelTrackerController? = nil,
        location: (any LocationProviding)? = nil,
        undoWindow: Duration = defaultUndoWindow
    ) {
        self.location = location ?? LocationService()
        self.api = api; self.planner = planner; self.undoWindow = undoWindow
        var trackerDirectory: URL?
        #if DEBUG
        if let domain = ProcessInfo.processInfo.environment["ILOVETRAINS_TEST_DOMAIN"], UUID(uuidString: domain) != nil {
            let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("UITests/" + domain)
            self.store = DeviceStore(directory: directory)
            trackerDirectory = directory
        } else { self.store = store }
        #else
        self.store = store
        #endif
        self.tracker = tracker ?? TravelTrackerController.live(directory: trackerDirectory)
        self.location.onPermission = { [weak self] granted, denied in
            guard let self else { return }
            self.state.locationGranted = granted
            self.state.locationDenied = denied
            if !granted, self.location.isMonitoring { self.clearArrivalMonitoring() }
        }
        self.location.onFix = { [weak self] in self?.receiveLocation($0) }
        self.location.onFailure = { [weak self] in self?.locationFailed($0) }
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--offline") { networkDisabled = true }
        if configureTrackerCase() { seeded = true; return }
        if configureCalibration() { seeded = true; return }
        #endif
        bootstrap = Task {
            try await planner.initialize()
            state.timetableStatus = await planner.coverageDescription
        }
        Task { await start() }
    }

    private func start() async {
        data = await store.load()
        #if DEBUG
        if configureTrackerDebugAfterLoad() { try? await store.save(data) }
        #endif
        if active, data.useLocation, data.focus != nil { arrivalPermissionPending = true; arrivalResumeWaitUntil = state.now + 15_000 }
        state.stations = (try? await store.stations()) ?? []
        if active {
            focusRefreshPending = canNetwork && data.focus != nil
            beginArrivalMonitoring()
        }
        choosePrediction(); syncPersonal()
        if let pair = ends(), let cached = await cachedBoard(from: pair.0, to: pair.1) {
            updateRecommendation(cached, local: nil, modes: data.modes, maxTransfers: data.requestTransferLimit)
            publish(retainedOfflineBoard(cached), request: generation)
        }
        state.ready = true; state.screen = data.trips.isEmpty ? .setup : .home
        if let url = pendingTrackerURL { pendingTrackerURL = nil; openTracker(url) }
        refresh(); refreshFlags()
        do { try await bootstrap?.value }
        catch { state.timetableStatus = "Offline timetable unavailable. Download it in Settings." }
        if active { refreshSharedData(refreshBoard: false); silentLocation() }
    }

    private func persist() {
        #if DEBUG
        if seeded { return }
        #endif
        let snapshot = data; let previous = writeTask
        writeTask = Task {
            await previous?.value
            do { try await store.save(snapshot) }
            catch { show("Couldn’t save changes on this phone. Free some storage and try again.") }
        }
    }
    private func currentFocus() -> FocusedJourney? {
        guard let focus = visibleFocus(data: data, now: state.now), data.withinTransferLimit(focus.journey) else { return nil }
        return focus
    }
    private func cachedBoard(from: Station, to: Station) async -> BoardData? {
        guard let cached = await store.cached(from: from, to: to, modes: data.modes) else { return nil }
        return cached
    }
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
        state.focusComplete = state.arrival?.state == .arrived
            || focus.map { f in data.rides.contains { $0.tripId == f.tripId && $0.reverse == f.reverse && $0.departure == f.journey.departure } } ?? false
        if data.focus == nil { state.arrival = nil }
        state.appearance = data.appearance; state.enabledModes = data.modes; state.useLocation = data.useLocation
        state.transferLimit = data.transferLimit; state.flags = data.flags
        state.automaticHome = automaticHome(data: data); state.home = data.home ?? state.automaticHome; state.homeIsManual = data.home != nil
        state.recentFrom = data.recentFrom; state.recentTo = data.recentTo
        state.tripMetadata = savedTripMetadata(data: data, fix: fix, selectedTripId: state.selectedTripId, selectedReverse: state.reverse, now: state.now)
        state.homeBoard = focus?.board ?? state.board
        reconcileTracker(storedFocus: data.focus, visibleFocus: focus)
    }
    private func reconcileTracker(storedFocus: FocusedJourney?, visibleFocus: FocusedJourney?) {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if seeded && !arguments.contains("--tracker-case") && !arguments.contains("--tracker-debug") { return }
        #endif
        if !active, storedFocus != nil, state.arrival == nil {
            #if DEBUG
            if !seeded { return }
            #else
            return
            #endif
        }
        let now = state.now
        let arrivalState = state.arrival?.state
        let arrivalMoving = state.arrival?.moving ?? false
        let complete = storedFocus.map { focus in
            data.rides.contains { $0.tripId == focus.tripId && $0.reverse == focus.reverse && $0.departure == focus.journey.departure }
        } ?? false
        #if DEBUG
        let debugCountdown = trackerDebugCountdown
        #else
        let debugCountdown: String? = nil
        #endif
        let previous = trackerTask
        let tracker = tracker
        #if DEBUG
        if trackerDebugCommand == "inspect" {
            trackerTask = Task {
                await previous?.value
                let status = await tracker.debugInspect(focus: storedFocus)
                publishTrackerDebugStatus(status)
            }
            return
        }
        #endif
        trackerTask = Task {
            await previous?.value
            await tracker.reconcile(
                focus: storedFocus,
                visibleFocus: visibleFocus,
                now: now,
                recordedComplete: complete,
                arrivalState: arrivalState,
                arrivalMoving: arrivalMoving,
                debugStaticCountdown: debugCountdown
            )
            #if DEBUG
            await tracker.awaitPublications()
            publishTrackerDebugStatus(await tracker.debugStatus())
            #endif
        }
    }
    private func choosePrediction() {
        if explicit, data.trips.contains(where: { $0.id == state.selectedTripId && compatible($0, modes: data.modes) }) {
            state.selectionPredicted = false
            return
        }
        let focus = currentFocus()
        let selected = focus.map { Selection(tripId: $0.tripId, reverse: $0.reverse) } ?? predict(data: data, stations: state.stations, fix: fix, now: state.now)
        let changed = state.selectedTripId != selected?.tripId || state.reverse != (selected?.reverse ?? false)
        state.selectedTripId = selected?.tripId; state.reverse = selected?.reverse ?? false; state.receipt = selected?.receipt
        state.selectionPredicted = focus == nil && selected != nil
        if changed { state.board = nil; state.recommendation = nil }
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
        state.justAddedTripId = nil
        state.now = epochNow(); location.refreshPermission()
        if state.ready {
            focusRefreshPending = canNetwork && data.focus != nil
            beginArrivalMonitoring()
            choosePrediction(); syncPersonal(); refresh(); refreshSharedData(refreshBoard: false); refreshFlags(); silentLocation()
        }
        loop = Task { [weak self] in
            var ticks = 0
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(1)) } catch { return }
                guard let self else { return }
                self.state.now = epochNow(); ticks += 1
                if self.data.focus != nil, self.arrivalWindow == nil { self.beginArrivalMonitoring() }
                self.settleFocus()
                if ticks % 30 == 0, self.state.ready {
                    self.refreshFlags()
                    if !self.refreshSharedData(), self.realtimeTask == nil { self.refresh() }
                }
            }
        }
    }
    func pause() {
        active = false; loop?.cancel(); loop = nil
        boardTask?.cancel(); supplementTask?.cancel(); supplementTask = nil; focusTask?.cancel(); historyTask?.cancel(); earlierTask?.cancel(); earlierTask = nil
        realtimeTask?.cancel(); realtimeTask = nil
        clearArrivalMonitoring()
        generation += 1; sharedGeneration += 1; state.refreshing = false; state.distanceMetres = nil
        state.earlierLoading = false
        state.nearestStation = nil; fix = nil; location.stop()
    }
    private func silentLocation() {
        guard data.useLocation, active else { return }
        if data.focus != nil {
            beginArrivalMonitoring()
            return
        }
        guard state.screen == .home || state.screen == .setup else { return }
        // A user-requested lookup may have reached Settings before iOS could ask permission.
        let resumePermission = setupLocationRequested && !state.locationGranted && !state.locationDenied
        if setupLocationRequested && (state.locationGranted || resumePermission) { state.setupLocationStatus = .locating }
        location.request(prompt: resumePermission)
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
        earlierTask?.cancel(); earlierTask = nil; state.earlierLoading = false
        boardTask?.cancel(); supplementTask?.cancel(); supplementTask = nil; generation += 1
        let request = generation; let modes = data.modes; let now = state.now
        let transferLimit = data.requestTransferLimit; let bound = data.offlineTransferBound
        guard let pair = ends(), !modes.isEmpty else {
            state.board = nil; state.recommendation = nil; state.refreshing = false
            syncPersonal(); refreshFocus(); return
        }
        let id = state.selectedTripId; let reverse = state.reverse
        let recordLastAnswer = !suppressNextLastAnswer
        suppressNextLastAnswer = false
        state.refreshing = true
        boardTask = Task {
            let cached = await cachedBoard(from: pair.0, to: pair.1)
            guard request == generation, !Task.isCancelled else { return }
            let previous = state.board.flatMap { board in
                board.from.id == pair.0.id && board.to.id == pair.1.id ? board : nil
            } ?? cached
            if state.board == nil, let cached { publish(retainedOfflineBoard(cached), request: request) }
            var localPlan: OfflinePlanResult?
            var onlinePage: TransitAPI.DeparturePage?
            await withTaskGroup(of: BoardFetch.self) { group in
                let planner = self.planner, api = self.api, bootstrap = self.bootstrap, network = self.canNetwork
                group.addTask {
                    do {
                        try await bootstrap?.value
                        return .local(try await planner.planResult(
                            from: pair.0, to: pair.1, at: now - 900_000,
                            modes: modes, limit: 24, maxTransfers: bound, recommendationAt: now
                        ))
                    } catch { return .local(nil) }
                }
                if network {
                    group.addTask {
                        .online(try? await api.departurePage(
                            from: pair.0, to: pair.1, modes: modes, transferLimit: transferLimit
                        ))
                    }
                }
                for await fetch in group {
                    guard request == generation, !Task.isCancelled else { group.cancelAll(); return }
                    switch fetch {
                    case let .local(value):
                        if var value {
                            value.board.requestMaxTransfers = transferLimit
                            value.recommendation?.board.requestMaxTransfers = transferLimit
                            localPlan = value
                        }
                    case let .online(value):
                        onlinePage = value
                        let completedAt = epochNow()
                        if let value, state.screen == .home, data.focus == nil,
                           shouldPageRecommendations(from: pair.0, to: pair.1, modes: modes, maxTransfers: transferLimit, now: completedAt) {
                            let task = Task {
                                var page = value
                                page.board = await self.supplementRecommendations(
                                    value.board, pair: pair, modes: modes, maxTransfers: transferLimit,
                                    local: nil, request: request, completedAt: completedAt
                                )
                                return page
                            }
                            supplementTask = task
                            group.addTask { .supplement(await task.value) }
                        }
                    case let .supplement(value):
                        onlinePage = value
                    }
                    if let merged = mergeBoardResults(
                        previous: previous,
                        local: localPlan?.board,
                        online: onlinePage?.board,
                        now: now
                    ) {
                        updateRecommendation(
                            merged,
                            local: onlinePage == nil ? localPlan?.recommendation : nil,
                            modes: modes,
                            maxTransfers: transferLimit
                        )
                        publish(merged, request: request)
                    }
                }
            }
            guard request == generation, !Task.isCancelled else { return }
            let online = onlinePage?.board
            let local = localPlan?.board
            var result = mergeBoardResults(previous: previous, local: local, online: online, now: now)
                ?? BoardData(from: pair.0, to: pair.1, journeys: [], generatedAt: 0, offline: true, error: "No timetable available for this trip")
            let chosen = updateRecommendation(
                result,
                local: online == nil ? localPlan?.recommendation : nil,
                modes: modes,
                maxTransfers: transferLimit
            )
            result.recommendation = chosen.map {
                recommendationPage(for: $0, in: result, firstBody: onlinePage?.body ?? Data())
            }
            publish(result, request: request); state.refreshing = false
            try? await store.cache(result, modes: modes)
            guard request == generation, !Task.isCancelled else { return }
            resolveRedirect(result)
            if let recommendation = state.recommendation, let id {
                let lead = recommendation.journey
                let freshlyObserved = recommendationIsFresh(recommendation, now: now, maxTransfers: transferLimit)
                if recordLastAnswer, data.focus == nil, state.screen == .home, lead.retained != true, freshlyObserved {
                    let here = stationHere(data: data, stations: state.stations, fix: fix, now: now)
                    let stationId = here.flatMap { station in fix.map { distanceMetres($0, station) <= 200 ? station.id : nil } ?? nil }
                    data.lastAnswer = LastAnswer(
                        tripId: id,
                        reverse: reverse,
                        at: now,
                        stationId: stationId,
                        board: recommendation.board,
                        journey: lead
                    )
                }
                persist(); syncPersonal()
            }
        }
        refreshFocus()
    }

    @discardableResult
    private func updateRecommendation(
        _ board: BoardData,
        local: JourneyRecommendation?,
        modes: Set<String>,
        maxTransfers: Int?
    ) -> JourneyRecommendation? {
        var candidates = recommendationCandidates(board)
        if let local { candidates.append(local) }
        let fresh = selectRecommendation(
            candidates.filter { recommendationIsFresh($0, now: state.now, maxTransfers: maxTransfers) },
            now: state.now,
            modes: modes,
            maxTransfers: maxTransfers
        )
        let retained = board.recommendation.flatMap { page in
            page.journeys.first.map {
                JourneyRecommendation(journey: $0, board: page.board(from: board.from, to: board.to))
            }
        }.flatMap { value in
            value.journey.retained == true
                ? selectRecommendation([value], now: state.now, modes: modes, maxTransfers: maxTransfers)
                : nil
        }
        let selected = fresh ?? retained ?? selectRecommendation(
            candidates, now: state.now, modes: modes, maxTransfers: maxTransfers
        )
        state.recommendation = selected
        return selected
    }

    private func recommendationPage(
        for recommendation: JourneyRecommendation,
        in board: BoardData,
        firstBody: Data
    ) -> RecommendationPage {
        let matchingPage = board.recommendationPages?.first {
            $0.generatedAt == recommendation.board.generatedAt
                && $0.journeys.contains { $0.key == recommendation.journey.key }
        }
        let body = matchingPage?.rawBody
            ?? (recommendation.board.generatedAt == board.generatedAt ? firstBody : Data())
        return RecommendationPage(
            at: matchingPage?.at ?? state.now,
            rawBody: body,
            board: recommendation.board,
            maxTransfers: recommendation.board.requestMaxTransfers
        )
    }

    private func recommendationPagingKey(
        from: Station,
        to: Station,
        modes: Set<String>,
        maxTransfers: Int?
    ) -> String {
        "\(from.id)|\(to.id)|\(modes.sorted().joined(separator: ","))|\(maxTransfers.map(String.init) ?? "null")"
    }

    private func shouldPageRecommendations(
        from: Station,
        to: Station,
        modes: Set<String>,
        maxTransfers: Int?,
        now: Millis
    ) -> Bool {
        let key = recommendationPagingKey(from: from, to: to, modes: modes, maxTransfers: maxTransfers)
        guard now - (recommendationPagingAt[key] ?? -.infinity) >= 60_000 else { return false }
        recommendationPagingAt[key] = now
        return true
    }

    private func supplementRecommendations(
        _ first: BoardData,
        pair: (Station, Station),
        modes: Set<String>,
        maxTransfers: Int?,
        local: JourneyRecommendation?,
        request: Int,
        completedAt: Millis
    ) async -> BoardData {
        var result = first
        result.recommendationPages = []
        var current = first
        var previousAt = state.now
        var identities = Set(first.journeys.map(\.key))
        let deadline = completedAt + 12_000
        for _ in 0..<2 {
            var candidates = recommendationCandidates(result)
            if let local { candidates.append(local) }
            let best = selectRecommendation(candidates, now: state.now, modes: modes, maxTransfers: maxTransfers)?.journey
            guard let cursor = nextRecommendationCursor(
                page: current,
                previousAt: previousAt,
                now: state.now,
                best: best
            ) else { break }
            let remaining = deadline - epochNow()
            guard remaining > 0, request == generation, !Task.isCancelled,
                  state.screen == .home, data.focus == nil else { break }
            guard let page = try? await api.departurePage(
                from: pair.0,
                to: pair.1,
                modes: modes,
                at: cursor,
                transferLimit: maxTransfers,
                timeout: max(0.1, remaining / 1_000)
            ) else { break }
            guard request == generation, !Task.isCancelled, state.screen == .home, data.focus == nil,
                  epochNow() <= deadline, !page.board.journeys.isEmpty else { break }
            let newIdentities = page.board.journeys.map(\.key).filter { identities.insert($0).inserted }
            guard !newIdentities.isEmpty else { break }
            result.recommendationPages?.append(RecommendationPage(
                at: cursor,
                rawBody: page.body,
                board: page.board,
                maxTransfers: maxTransfers
            ))
            current = page.board
            previousAt = cursor
            updateRecommendation(result, local: local, modes: modes, maxTransfers: maxTransfers)
        }
        return result
    }

    private func merge(_ older: [Journey], _ newer: [Journey]) -> [Journey] {
        var values = Dictionary(older.map { ($0.key, $0) }, uniquingKeysWith: { _, last in last })
        newer.forEach { values[$0.key] = $0 }
        return values.values.sorted { $0.effectiveDeparture < $1.effectiveDeparture }
    }
    private func publish(_ board: BoardData?, request: Int) {
        guard request == generation else { return }
        // Publish route colours with the first cached/local board, without waiting for the network.
        if let board, let lead = state.recommendation?.journey ?? nextHomeJourney(board, now: state.now),
           let index = data.trips.firstIndex(where: { $0.id == state.selectedTripId }) {
            let lines = orderedLineCodes(lead)
            if data.trips[index].lines != lines {
                data.trips[index].lines = lines
                persist()
            }
        }
        var remembered = board.map { data.withinTransferLimit($0) }
        if let board { remembered?.homeJourneyKey = state.recommendation?.journey.key ?? nextHomeJourney(board, now: state.now)?.key }
        state.board = remembered
        if let detail = state.detail {
            if let source = remembered.flatMap({ recommendationCandidates($0).first { $0.journey.key == detail.key } }) {
                state.detail = source.journey
                if state.screen == .detail { state.board = source.board }
            } else {
                var retained = detail
                retained.retained = true
                state.detail = retained
            }
        }
        syncPersonal()
    }
    @discardableResult
    private func refreshSharedData(refreshBoard: Bool = true) -> Bool {
        guard canNetwork, realtimeTask == nil, state.now - lastRealtimeAttempt >= 25_000 else { return false }
        lastRealtimeAttempt = state.now
        sharedGeneration += 1
        let sharedRequest = sharedGeneration
        realtimeTask = Task {
            var fetched = false
            defer {
                if sharedRequest == sharedGeneration {
                    realtimeTask = nil
                    // Restarting the board on a failed fetch would cancel the followed journey's request every tick.
                    if refreshBoard, fetched, active { refresh() }
                }
            }
            try? await bootstrap?.value
            fetched = (try? await planner.refreshRealtime(baseURL: api.baseURL)) != nil
            guard !Task.isCancelled, active, sharedRequest == sharedGeneration else { return }
            if let focus = data.focus, focus.journey.legs.allSatisfy({ $0.identity != nil }) {
                let update = await planner.refreshFocused(focus.journey)
                guard !Task.isCancelled, sharedRequest == sharedGeneration, active else { return }
                if sameFocus(focus), let subject = data.focus {
                    data.focus = focusAfterRefresh(subject, update: update, alternatives: nil)
                    settleFocus(matchingRefresh: update.live); persist(); syncPersonal()
                }
                let alternatives = try? await planner.plan(from: focus.board.from, to: focus.board.to, at: state.now - 900_000, modes: allModes, limit: 24, maxTransfers: data.offlineTransferBound)
                guard !Task.isCancelled, sharedRequest == sharedGeneration, active else { return }
                if sameFocus(focus) {
                    if let subject = data.focus {
                        data.focus = focusAfterRefresh(subject, update: update, alternatives: alternatives)
                    }
                    settleFocus(matchingRefresh: update.live); persist(); syncPersonal()
                }
            }
            guard fetched, state.now - lastTimetableCheck >= 21_600_000 else { return }
            lastTimetableCheck = state.now
            try? await planner.update(baseURL: api.baseURL)
            state.timetableStatus = await planner.coverageDescription
        }
        return true
    }
    private func sameFocus(_ focus: FocusedJourney) -> Bool {
        data.focus.map { $0.tripId == focus.tripId && $0.reverse == focus.reverse && $0.journey.key == focus.journey.key } ?? false
    }
    private func refreshFocus() {
        guard let focus = data.focus else { return }
        // A phone that cannot ask has no refresh to wait for.
        guard canNetwork else { settleFocus(); return }
        focusTask?.cancel()
        focusRefreshGeneration += 1
        let refreshRequest = focusRefreshGeneration
        focusRefreshPending = true
        focusTask = Task {
            defer {
                if refreshRequest == focusRefreshGeneration { focusRefreshPending = false }
            }
            guard let pair = ends(id: focus.tripId, reverse: focus.reverse) else { return }
            let at = focus.journey.departure < state.now ? max(state.now - 86_400_000, focus.journey.departure) : nil
            let result = try? await api.departures(from: pair.0, to: pair.1, modes: allModes, at: at)
            guard !Task.isCancelled, sameFocus(focus) else { return }
            guard var current = data.focus else { return }
            var matched = false
            if let result, let match = result.journeys.first(where: { $0.key == focus.journey.key }) {
                matched = true
                current.board = result; current.alternatives = nil; current.journey = match; data.focus = current
            } else if let demoted = current.demotedForUnmatchedBoard() { data.focus = demoted }
            settleFocus(matchingRefresh: matched); persist(); syncPersonal()
        }
    }
    private func settleFocus(
        sample: ArrivalSample? = nil,
        monitoring: Bool? = nil,
        matchingRefresh: Bool = false
    ) {
        guard var focus = data.focus else { return }
        var changed = false
        if !focus.board.isLive(state.now), focus.journey.retained != true, focus.journey.realtime || focus.journey.cancelled {
            focus = focus.lastKnown(); data.focus = focus; changed = true
        }
        let legacyCompleted = data.rides.contains {
            $0.tripId == focus.tripId && $0.reverse == focus.reverse && $0.departure == focus.journey.departure
        }
        let result = reduceArrival(ArrivalInput(
            identity: arrivalIdentity(focus),
            departureMs: focus.journey.effectiveDeparture,
            arrivalMs: focus.journey.effectiveArrival,
            nowMs: state.now,
            destination: ends(id: focus.tripId, reverse: focus.reverse)?.1,
            guard: focus.arrivalGuard,
            window: arrivalWindow,
            sample: sample,
            monitoring: monitoring ?? location.isMonitoring,
            permissionPending: arrivalPermissionPending
                || (focusRefreshPending && !matchingRefresh && focus.arrivalGuard?.armed != true),
            legacyCompleted: legacyCompleted,
            cancelled: focus.journey.cancelled,
            matchingRefresh: matchingRefresh,
            resumeWaitUntilMs: arrivalResumeWaitUntil
        ))
        arrivalWindow = result.window
        state.arrival = result
        if focus.arrivalGuard != result.guard {
            focus.arrivalGuard = result.guard
            data.focus = focus
            changed = true
        }
        let rides = switch result.action {
        case .record, .correct: settledRides(data.rides, focus: focus, arrived: true, ends: ends(id: focus.tripId, reverse: focus.reverse))
        case .withdraw: settledRides(data.rides, focus: focus, arrived: false, ends: ends(id: focus.tripId, reverse: focus.reverse))
        case .none, .expire: data.rides
        }
        if rides != data.rides { data.rides = rides; changed = true }
        if result.action == .expire {
            data.focus = nil
            if data.lastAnswer?.tripId == focus.tripId, data.lastAnswer?.reverse == focus.reverse {
                data.lastAnswer = nil
            }
            clearArrivalMonitoring()
            changed = true
        }
        if result.state == .arrived { clearArrivalMonitoring() }
        if changed { persist() }
        syncPersonal()
    }

    private func arrivalIdentity(_ focus: FocusedJourney) -> String {
        "\(focus.tripId)|\(focus.reverse)|\(focus.journey.key)"
    }

    private func beginArrivalMonitoring() {
        guard active, data.useLocation, let focus = data.focus else {
            settleFocus()
            return
        }
        guard state.now >= focus.journey.effectiveDeparture,
              focus.arrivalGuard?.basis != .location,
              !data.rides.contains(where: {
                  $0.tripId == focus.tripId && $0.reverse == focus.reverse && $0.departure == focus.journey.departure
              }) else { settleFocus(); return }
        let identity = arrivalIdentity(focus)
        if (arrivalTask != nil || location.isMonitoring), arrivalWindow?.identity == identity { return }
        clearArrivalMonitoring()
        arrivalGeneration += 1
        let request = arrivalGeneration
        arrivalWindow = ArrivalWindow(identity: identity, samples: [])
        arrivalResumeWaitUntil = state.now + 15_000
        arrivalPermissionPending = true
        settleFocus()
        arrivalTask = Task { [weak self] in
            guard let self else { return }
            let permitted = await self.location.monitoringPermitted()
            guard request == self.arrivalGeneration,
                  self.active,
                  self.data.useLocation,
                  self.data.focus.map({ self.arrivalIdentity($0) }) == identity else { return }
            self.arrivalPermissionPending = false
            if permitted {
                self.settleFocus(monitoring: true)
                guard request == self.arrivalGeneration,
                      self.data.focus.map({ self.arrivalIdentity($0) }) == identity else { return }
                if !self.location.startMonitoring() { self.settleFocus(monitoring: false) }
            } else {
                self.arrivalResumeWaitUntil = nil
                self.settleFocus(monitoring: false)
            }
            if request == self.arrivalGeneration { self.arrivalTask = nil }
        }
    }

    private func clearArrivalMonitoring() {
        arrivalGeneration += 1
        arrivalTask?.cancel(); arrivalTask = nil
        arrivalWindow = nil
        arrivalPermissionPending = false
        arrivalResumeWaitUntil = nil
        location.stop()
    }
    func receiveLocation(_ value: Fix) {
        #if DEBUG
        let current = seeded ? state.now : epochNow()
        #else
        let current = epochNow()
        #endif
        state.now = current
        guard data.useLocation, active else { return }
        guard (0...300_000).contains(current - value.at) else { locationFailed(.unavailable); return }
        fix = value
        let here = stationHere(data: data, stations: state.stations, fix: value, now: current)
        let choice = setupLocationChoice(stations: state.stations, modes: data.modes, fix: value)
        state.nearestStation = choice.stations.first
        if state.screen == .setup {
            guard !state.selectingHome else { return }
            state.nearbyStations = choice.stations
            if state.setupFrom == nil && !setupOriginEdited && (setupLocationRequested || (data.trips.isEmpty && !setupLocationResolved)) {
                state.setupFrom = choice.automatic
                state.setupLocationStatus = choice.automatic != nil ? .idle : choice.stations.isEmpty ? .noNearby : .chooseStation
            }
            setupLocationRequested = false; setupLocationResolved = true
            return
        }
        if state.screen == .home, let here {
            let format = DateFormatter(); format.timeZone = sydneyZone; format.dateFormat = "yyyy-MM-dd"
            let day = format.string(from: Date(timeIntervalSince1970: current / 1000))
            if !data.votes.contains(where: { $0.day == day }) { data.votes.append(HomeVote(day: day, station: here)); data.votes = Array(data.votes.suffix(7)); persist() }
        }
        if data.focus != nil {
            settleFocus(sample: ArrivalSample(
                lat: value.lat,
                lon: value.lon,
                at: value.at,
                accuracy: value.accuracyMetres ?? 0,
                speed: value.speed
            ))
        }
        if let inferred = inferredFocus(data: data, fix: value, now: current) {
            data.focus = inferred
            persist()
            beginArrivalMonitoring()
        }
        if !explicit, data.focus == nil, let here, let home = data.home ?? automaticHome(data: data), here.id != home.id,
           !data.trips.contains(where: { compatible($0, modes: data.modes) && ($0.from.id == here.id || $0.to.id == here.id) }), !home.modes.isDisjoint(with: data.modes) {
            let trip = SavedTrip(id: UUID().uuidString, from: here, to: home, createdAt: current)
            addTrip(trip); state.justAddedTripId = trip.id; persist()
        }
        choosePrediction(); syncPersonal()
        if let origin = currentFocus()?.journey.legs.first?.from ?? ends()?.0 {
            let metres = distanceMetres(value, origin); state.distanceMetres = metres.isFinite ? Int(metres.rounded()) : nil
        }
        refresh()
    }

    func back() {
        if state.screen == .setup { cancelSetupLocation() }
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
        explicit = true
        let direction = id == state.selectedTripId && !reverse ? state.reverse : reverse
        if id != state.selectedTripId || state.reverse != direction { state.board = nil; state.recommendation = nil }
        state.selectedTripId = id; state.reverse = direction; state.screen = .board; state.detail = nil; state.receipt = nil
        state.selectionPredicted = false
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
    func openJourney(_ journey: Journey) {
        guard data.withinTransferLimit(journey), journeyAllowed(journey, modes: data.modes) else { return }
        if state.screen == .home {
            let source = state.homeBoard.flatMap { board in
                recommendationCandidates(board).first { $0.journey.key == journey.key }?.board
            }
            state.board = state.recommendation?.journey.key == journey.key
                ? state.recommendation?.board
                : source ?? state.homeBoard ?? state.board
            if let focus = currentFocus() {
                if journey.key != focus.journey.key, let alternatives = focus.alternatives, alternatives.journeys.contains(where: { $0.key == journey.key }) { state.board = alternatives }
                state.selectedTripId = focus.tripId; state.reverse = focus.reverse
            }
        }
        supplementTask?.cancel(); supplementTask = nil
        recordHistory(); state.screen = .detail; state.detail = journey
    }
    func openTracker(_ url: URL) {
        guard state.ready else { pendingTrackerURL = url; return }
        Task {
            guard let identity = await tracker.focusIdentity(for: url),
                  let focus = data.focus, focus.trackerIdentity == identity else { return }
            state.selectedTripId = focus.tripId
            state.reverse = focus.reverse
            state.board = focus.board
            state.homeBoard = focus.board
            state.detail = focus.journey
            state.screen = .detail
            state.receipt = nil
            state.selectionPredicted = false
            recordHistory()
            #if DEBUG
            publishTrackerDebugStatus(await tracker.debugStatus())
            #endif
        }
    }
    func pinJourney(_ journey: Journey) {
        guard !journey.cancelled, data.withinTransferLimit(journey), journeyAllowed(journey, modes: data.modes), let id = state.selectedTripId, var board = state.board, let pair = ends(), board.from.id == pair.0.id, board.to.id == pair.1.id else { return }
        board.journeys = merge(board.journeys, [journey])
        var focus = FocusedJourney(tripId: id, reverse: state.reverse, journey: journey, board: board)
        if !board.isLive(state.now), journey.realtime || journey.cancelled { focus = focus.lastKnown() }
        clearArrivalMonitoring(); state.arrival = nil
        data.focus = focus; data.lastAnswer = nil; persist()
        state.screen = .home; state.detail = nil; historyRecorded = false; syncPersonal(); beginArrivalMonitoring(); refresh()
    }
    func unpinJourney() {
        guard let focus = data.focus, focus.pinned else { return }
        clearArrivalMonitoring()
        data.focus = nil; data.lastAnswer = nil; persist(); state.selectedTripId = focus.tripId; state.reverse = focus.reverse
        explicit = true; state.screen = .home; state.detail = nil; syncPersonal(); refresh()
    }
    func showReturn() {
        guard let focus = data.focus else { return }
        clearArrivalMonitoring()
        data.focus = nil; data.lastAnswer = nil; persist(); explicit = true; historyRecorded = false
        state.selectedTripId = focus.tripId; state.reverse = !focus.reverse; state.screen = .home; state.board = nil; state.homeBoard = nil
        state.receipt = "You rode out at \(clockTime(focus.journey.effectiveDeparture)). Here’s the way back."
        syncPersonal(); refresh()
    }
    func newTrip() {
        supplementTask?.cancel(); supplementTask = nil
        cancelSetupLocation(); setupLocationResolved = false
        redirect = currentFocus().flatMap { $0.pinned ? nil : $0 }
        redirectTargetId = nil
        setupOriginEdited = false
        state.screen = .setup
        state.setupFrom = redirect.flatMap { ends(id: $0.tripId, reverse: $0.reverse)?.0 }
        state.setupTo = nil; state.selectingHome = false
    }
    func chooseSetupFrom(_ station: Station) { setupOriginQueryChanged(); state.setupFrom = station }
    func clearSetupFrom() { setupOriginQueryChanged(); state.setupFrom = nil; state.setupTo = nil }
    func chooseSetupTo(_ station: Station) { state.setupTo = station }
    func clearSetupTo() { state.setupTo = nil }
    private func addTrip(_ trip: SavedTrip) {
        data.trips.append(trip); enforceTripCap()
    }
    func saveTrip(from: Station, to: Station) {
        guard from.id != to.id else { return }
        let existing = data.trips.first { Set([$0.from.id, $0.to.id]) == Set([from.id, to.id]) }
        let trip = existing ?? SavedTrip(id: UUID().uuidString, from: from, to: to, createdAt: state.now)
        if existing == nil { addTrip(trip) }
        let reverse = existing?.to.id == from.id
        data.recentFrom = Array(([from] + data.recentFrom.filter { $0.id != from.id }).prefix(3))
        data.recentTo = Array(([to] + data.recentTo.filter { $0.id != to.id }).prefix(3))
        data.lastTripId = trip.id; data.lastReverse = reverse
        persist(); historyRecorded = false
        let visible = compatible(trip, modes: data.modes)
        explicit = visible
        state.selectionPredicted = false
        redirectTargetId = visible && redirect != nil ? trip.id : nil
        if visible {
            state.screen = redirect == nil ? .home : .board; state.selectedTripId = trip.id; state.reverse = reverse
        } else {
            redirect = nil; state.screen = .home; state.selectedTripId = nil; state.reverse = false
        }
        state.setupFrom = nil; state.setupTo = nil; state.board = nil; state.receipt = nil
        setupOriginEdited = false
        if !visible { choosePrediction() }
        syncPersonal(); refresh()
    }
    private func resolveRedirect(_ board: BoardData) {
        guard let old = redirect, let id = state.selectedTripId, id == redirectTargetId else { return }
        redirect = nil; redirectTargetId = nil
        if let match = redirectMatch(for: old.journey, in: board.journeys) {
            clearArrivalMonitoring(); state.arrival = nil
            data.focus = FocusedJourney(tripId: id, reverse: state.reverse, journey: match, board: board, pinned: false)
            state.screen = .home; persist(); syncPersonal(); beginArrivalMonitoring()
        }
    }
    private func removeTrip(_ id: String) {
        guard let (remaining, pending) = data.beginningDeletion(of: id) else { return }
        data = remaining
        let store = store
        Task { try? await store.purgeCache(for: pending.trip) }
    }
    private func enforceTripCap() {
        while data.trips.count > 10, let evicted = data.leastRecentlyUsedTrip() {
            removeTrip(evicted.id)
        }
    }
    func deleteTrip(id: String) {
        guard let (remaining, pending) = data.beginningDeletion(of: id) else { return }
        if data.focus?.tripId == id { clearArrivalMonitoring() }
        undoTask?.cancel(); expireDeletion()
        data = remaining; pendingDeletion = pending; persist()
        if state.selectedTripId == id { explicit = false; state.board = nil }
        choosePrediction(); syncPersonal(); refresh()
        state.message = deletionMessage(pending.trip); state.messageAutoDismiss = false; state.undoAvailable = true
        let window = undoWindow
        undoTask = Task { [weak self] in
            try? await Task.sleep(for: window)
            guard !Task.isCancelled else { return }
            self?.expireDeletion()
        }
    }
    func undoDelete() {
        guard let pending = pendingDeletion else { return }
        undoTask?.cancel(); undoTask = nil; pendingDeletion = nil
        data = data.restoring(pending); enforceTripCap(); persist()
        show(nil)
        choosePrediction(); syncPersonal(); refresh()
    }
    private func expireDeletion() {
        guard let pending = pendingDeletion else { return }
        pendingDeletion = nil
        let store = store
        Task { try? await store.purgeCache(for: pending.trip) }
        if state.message == deletionMessage(pending.trip) { show(nil) }
    }
    private func show(_ message: String?, autoDismiss: Bool = false) {
        state.message = message; state.messageAutoDismiss = message != nil && autoDismiss; state.undoAvailable = false
    }
    func openSettings() { supplementTask?.cancel(); supplementTask = nil; settingsBack = state.screen; state.screen = .settings; state.feedbackSucceeded = false }
    func setAppearance(_ value: Appearance) { data.appearance = value; persist(); syncPersonal() }
    func setMode(mode: String, enabled: Bool) {
        guard allModes.contains(mode) else { return }
        if enabled { data.modes.insert(mode) } else { data.modes.remove(mode) }
        applyPreferenceChange()
    }
    func setTransferLimit(_ value: TransferLimit) {
        guard data.transferLimit != value else { return }
        data.transferLimit = value
        applyPreferenceChange()
    }
    private func applyPreferenceChange() {
        suppressNextLastAnswer = true
        clearArrivalMonitoring()
        persist(); state.board = nil; state.homeBoard = nil; state.recommendation = nil
        beginArrivalMonitoring()
        choosePrediction(); syncPersonal(); refresh()
    }
    private func refreshFlags() {
        guard canNetwork else { return }
        Task {
            let flags = try? await api.flags()
            state.tinyTrain = flags?[tinyTrainFlagKey] == true
            guard let flags, flags != data.flags else { return }
            let previousRequestLimit = data.requestTransferLimit
            let previousOfflineBound = data.offlineTransferBound
            data.flags = flags
            if data.requestTransferLimit == previousRequestLimit && data.offlineTransferBound == previousOfflineBound {
                persist(); syncPersonal()
            } else {
                applyPreferenceChange()
            }
        }
    }
    func setUseLocation(_ enabled: Bool) {
        data.useLocation = enabled
        if !enabled {
            cancelSetupLocation(); clearArrivalMonitoring()
            fix = nil; state.distanceMetres = nil; state.nearestStation = nil
        }
        persist(); syncPersonal()
        if enabled { requestLocation() } else { choosePrediction(); refresh() }
    }
    func requestLocation() {
        if state.screen == .setup && state.setupLocationStatus == .servicesDisabled {
            setupLocationRequested = true
            #if DEBUG
            if seeded { state.setupLocationStatus = .locating; return }
            #endif
            location.openSettings(); return
        }
        if state.screen == .setup && !state.selectingHome && state.setupFrom == nil {
            guard state.setupLocationStatus != .locating else { return }
            setupOriginEdited = false; setupLocationRequested = true
            state.setupLocationStatus = .locating; state.nearbyStations = []
            if !data.useLocation { data.useLocation = true; persist(); syncPersonal() }
        }
        guard data.useLocation else { return }
        #if DEBUG
        if seeded { return }
        #endif
        if data.focus != nil { beginArrivalMonitoring(); return }
        location.request(prompt: true)
    }
    func locationFailed(_ status: SetupLocationStatus) {
        guard setupLocationRequested, state.screen == .setup, !state.selectingHome, state.setupFrom == nil else { return }
        state.setupLocationStatus = status
        if status == .unavailable { setupLocationRequested = false; setupLocationResolved = true }
    }
    func setupOriginQueryChanged() {
        setupOriginEdited = true
        cancelSetupLocation()
    }
    private func cancelSetupLocation() {
        setupLocationRequested = false
        state.setupLocationStatus = .idle; state.nearbyStations = []
        location.stop()
    }
    func chooseHome() { setupOriginEdited = false; state.screen = .setup; state.selectingHome = true; state.setupFrom = nil; state.setupTo = nil }
    func setHome(_ station: Station?) { data.home = station; persist(); state.screen = .settings; state.selectingHome = false; syncPersonal() }
    func earlier() {
        guard earlierTask == nil, let board = state.board else { return }
        let request = generation, modes = data.modes
        let bound = data.offlineTransferBound, transferLimit = data.requestTransferLimit
        let earliest = board.journeys.map(\.departure).min() ?? state.now
        let at = max(earliest - 3_600_000, state.now - 86_400_000)
        guard earliest > state.now - 86_400_000 else { return }
        state.earlierLoading = true
        earlierTask = Task {
            defer {
                if request == generation { earlierTask = nil; state.earlierLoading = false }
            }
            async let local: BoardData? = try? planner.plan(from: board.from, to: board.to, at: at, modes: modes, limit: 30, maxTransfers: bound)
            let online: BoardData?
            if canNetwork {
                online = try? await api.departures(from: board.from, to: board.to, modes: modes, at: at, transferLimit: transferLimit)
            } else {
                online = nil
            }
            let localResult = await local
            let past = online ?? localResult
            guard !Task.isCancelled, request == generation, let past, var current = state.board else { return }
            current.journeys = mergeEarlierJourneys(past.journeys, current: current.journeys, cutoff: state.now - 86_400_000)
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
            } catch { show("Couldn’t update timetables. Your saved timetable is still available. Try again when you’re online.") }
        }
    }
    func feedback(text: String, category: String = "problem") {
        guard !state.feedbackSubmitting else { return }
        state.feedbackSubmitting = true; state.feedbackSucceeded = false; show(nil)
        Task {
            defer { state.feedbackSubmitting = false }
            do { try await api.feedback(text: text, category: category); state.feedbackSucceeded = true; feedbackDraft = ""; show("Feedback sent. Thank you.", autoDismiss: true) }
            catch { show("Couldn’t send feedback. Check your connection and try again.") }
        }
    }
    func dismissMessage() { show(nil) }
}

func settledRides(_ rides: [Ride], focus: FocusedJourney, arrived: Bool, ends: (Station, Station)? = nil) -> [Ride] {
    let arrival = focus.journey.effectiveArrival
    guard let index = rides.firstIndex(where: { $0.tripId == focus.tripId && $0.reverse == focus.reverse && $0.departure == focus.journey.departure }) else {
        guard arrived else { return rides }
        // A refreshed journey carries wire stations, so the endpoints come from the saved trip.
        return Array((rides + [Ride(tripId: focus.tripId, reverse: focus.reverse, departure: focus.journey.departure, arrival: arrival,
                                    from: ends?.0 ?? focus.journey.legs.first?.from, to: ends?.1 ?? focus.journey.legs.last?.to)]).suffix(100))
    }
    guard !arrived || arrival != rides[index].arrival else { return rides }
    var settled = rides
    if arrived { settled[index].arrival = arrival } else { settled.remove(at: index) }
    return settled
}

func redirectMatch(for original: Journey, in candidates: [Journey]) -> Journey? {
    guard let lead = original.legs.first else { return nil }
    return candidates.first { $0.legs.first?.line == lead.line && $0.legs.first?.departure == lead.departure }
}

#if DEBUG
private extension TrainViewModel {
    var trackerDebugCommand: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--tracker-debug"), index + 1 < arguments.count else { return nil }
        return arguments[index + 1]
    }

    func publishTrackerDebugStatus(_ controllerStatus: String) {
        state.trackerDriverStatus = controllerStatus
            + "|focus=\(data.focus?.tripId ?? "none")"
            + "|arrival=\(state.arrival?.state.rawValue ?? "none")"
            + "|guard=\(data.focus?.arrivalGuard?.armed == true)"
            + "|rides=\(data.rides.count)"
            + "|monitoring=\(location.isMonitoring)"
            + "|screen=\(state.screen.rawValue)"
            + "|selected=\(state.selectedTripId ?? "none")"
            + "|pinned=\(data.focus?.pinned.description ?? "none")"
            + "|by=\(data.focus?.pinned == false ? "inferred" : data.focus == nil ? "none" : "pin")"
    }

    func configureTrackerDebugAfterLoad() -> Bool {
        guard let command = trackerDebugCommand else { return false }
        let now = epochNow()
        switch command {
        case "wall-start":
            data = debugTrackerData(id: "wall-clock", now: now, boundarySeconds: 60)
        case "guarded-overdue":
            data = debugTrackerData(id: "guarded-overdue", now: now)
            var journey = data.focus!.journey
            journey.legs = [journey.legs.last!]
            journey.legs[0].from = data.trips[0].from
            journey.legs[0].departure = now - 3_600_000
            journey.legs[0].estimatedDeparture = nil
            journey.legs[0].arrival = now - 300_000
            journey.legs[0].estimatedArrival = nil
            data.focus!.journey = journey
            data.focus!.board.journeys = [journey]
            data.focus!.arrivalGuard = ArrivalGuard(armed: true, retainedAt: now - 600_000)
        case "dismiss-start":
            data = debugTrackerData(id: "dismiss-original", now: now)
        case "permission-start":
            data = debugTrackerData(id: "permission-focus", now: now)
        case "replacement":
            data = debugTrackerData(id: "replacement", now: now, destination: "Rouse Hill Station")
        case "foreground-end":
            data.focus = nil
        case "production-inference":
            var seeded = debugTrackerData(id: "inferred", now: now)
            let focus = seeded.focus!
            seeded.focus = nil
            seeded.lastAnswer = LastAnswer(
                tripId: focus.tripId,
                reverse: focus.reverse,
                at: focus.journey.effectiveDeparture - 60_000,
                stationId: focus.board.from.id,
                board: focus.board,
                journey: focus.journey
            )
            data = seeded
        case "inspect", "foreground-transfer":
            return false
        default:
            return false
        }
        state.now = now
        return true
    }

    func debugTrackerData(
        id: String,
        now: Millis,
        boundarySeconds: Double = 600,
        destination: String = "Kellyville Station"
    ) -> UserData {
        let mascot = Station(id: "202010", name: "Mascot Station", lat: -33.9258, lon: 151.1934, modes: ["train"])
        let central = Station(id: "200060", name: "Central Station", lat: -33.8840, lon: 151.2062, modes: ["train", "metro"])
        let end = Station(id: "215500", name: destination, lat: -33.7120, lon: 150.9350, modes: ["metro"])
        let first = Leg(
            line: "T8", mode: "train", headsign: "City Circle via Airport", from: mascot, to: central,
            departure: now - 300_000, arrival: now + boundarySeconds * 1_000,
            estimatedDeparture: now - 300_000, estimatedArrival: now + boundarySeconds * 1_000,
            fromPlatform: "1", toPlatform: "21"
        )
        let last = Leg(
            line: "M1", mode: "metro", headsign: "Tallawong", from: central, to: end,
            departure: now + 240_000, arrival: now + 3_600_000,
            estimatedDeparture: now + 240_000, estimatedArrival: now + 3_600_000,
            fromPlatform: "26", toPlatform: "2"
        )
        let journey = Journey(legs: [first, last])
        let board = BoardData(from: mascot, to: end, journeys: [journey], generatedAt: now, source: "live")
        let trip = SavedTrip(id: id, from: mascot, to: end, createdAt: now, lines: ["T8", "M1"])
        return UserData(
            trips: [trip],
            lastTripId: trip.id,
            focus: FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board, pinned: false)
        )
    }

    func configureTrackerCase() -> Bool {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--tracker-case"), index + 1 < arguments.count else { return false }
        let name = arguments[index + 1]
        var central = Station(id: "200060", name: "Central Station", modes: ["train", "metro"])
        let mascot = Station(id: "202010", name: "Mascot Station", modes: ["train"])
        var kellyville = Station(id: "215500", name: "Kellyville Station", modes: ["metro"])
        let departure = trackerFixtureTime(hour: 4, minute: 38)
        let changeArrival = trackerFixtureTime(hour: 4, minute: 49)
        var onwardDeparture = trackerFixtureTime(hour: 4, minute: 56)
        let arrival = trackerFixtureTime(hour: 5, minute: 46)
        var now = trackerFixtureTime(hour: 4, minute: 44)
        if name == "transfer" { now = trackerFixtureTime(hour: 4, minute: 52) }
        if name == "final" { now = trackerFixtureTime(hour: 5, minute: 39) }
        if name == "tight-transfer" { onwardDeparture = trackerFixtureTime(hour: 4, minute: 53) }
        if name == "missed-connection" { onwardDeparture = trackerFixtureTime(hour: 4, minute: 48) }
        if name == "long-content" {
            central.name = "International Airport Station"
            kellyville.name = "Bondi Junction Station"
        }
        var first = Leg(
            line: "T8", mode: "train", headsign: "City Circle via Airport",
            from: mascot, to: central, departure: departure, arrival: changeArrival,
            estimatedDeparture: departure, estimatedArrival: changeArrival,
            fromPlatform: "1", toPlatform: name == "unknown-platform" ? nil : "21"
        )
        var last = Leg(
            line: "M1", mode: "metro", headsign: "Tallawong",
            from: central, to: kellyville, departure: onwardDeparture, arrival: arrival,
            estimatedDeparture: onwardDeparture, estimatedArrival: arrival,
            fromPlatform: "26", toPlatform: "2"
        )
        if name == "first-leg-cancelled" { first.cancelled = true }
        if name == "final-leg-cancelled" { last.cancelled = true }
        var journey = Journey(legs: [first, last])
        let offline = name == "offline-stale"
        if offline { journey.retained = true }
        let generatedAt = offline ? trackerFixtureTime(hour: 4, minute: 42) : now
        let board = BoardData(
            from: mascot, to: kellyville, journeys: [journey], generatedAt: generatedAt,
            source: "live", offline: offline
        )
        let trip = SavedTrip(id: "tracker-mascot", from: mascot, to: kellyville, createdAt: now, lines: ["T8", "M1"])
        data = UserData(trips: [trip], lastTripId: trip.id,
                        focus: FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board, pinned: false))
        state.now = now
        state.trips = [trip]
        state.selectedTripId = trip.id
        state.board = board
        state.homeBoard = board
        state.screen = .home
        state.ready = true
        trackerDebugCountdown = TravelTrackerState.derive(focus: data.focus!, now: now, generation: 1)?.headline.emphasis ?? ""
        seeded = true
        syncPersonal()
        return true
    }

    func trackerFixtureTime(hour: Int, minute: Int) -> Millis {
        var components = DateComponents()
        components.calendar = sydneyCalendar
        components.timeZone = sydneyZone
        components.year = 2026
        components.month = 9
        components.day = 1
        components.hour = hour
        components.minute = minute
        return components.date!.timeIntervalSince1970 * 1_000
    }

    func configureCalibration() -> Bool {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--calibration"), index + 1 < arguments.count else { return false }
        let name = arguments[index + 1]
        guard let url = Bundle.main.url(forResource: "calibration", withExtension: "json"),
              let bytes = try? Data(contentsOf: url), let catalogue = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { return false }
        let key = name.contains("ferry") ? "ferry" : name.contains("two-change") ? "threeLeg" : name.contains("commute") || name.contains("detail") || name.contains("active") || name.contains("inferred") || name.contains("pinned") ? "transfer" : "central"
        guard let entry = catalogue[key] as? [String: Any], let body = entry["body"] as? [String: Any],
              let bodyData = try? JSONSerialization.data(withJSONObject: body), var board = try? TransitWire.board(bodyData), let now = entry["now"] as? Double else { return false }
        state.now = now
        if name.contains("active") || name.contains("inferred") { state.now = entry["departedNow"] as? Double ?? now }
        board.generatedAt = state.now
        if name.contains("server-stale") { board.serverStale = true }
        if name.contains("delayed"), !board.journeys.isEmpty {
            board.journeys[0].legs = board.journeys[0].legs.map { leg in var l = leg; l.estimatedDeparture = l.departure + 360_000; l.estimatedArrival = l.arrival + 360_000; return l }
        }
        if name.contains("cancelled"), !board.journeys.isEmpty { board.journeys[0].legs[0].cancelled = true }
        if name.contains("now"), let departure = board.journeys.first?.effectiveDeparture {
            state.now = departure
            board.generatedAt = departure
        }
        if name.contains("hours"), let departure = board.journeys.first?.effectiveDeparture {
            state.now = departure - 187 * 60_000
            board.generatedAt = state.now
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
        let trip = SavedTrip(id: "calibration-trip", from: board.from, to: board.to, createdAt: now,
                            lines: board.journeys.first.map(orderedLineCodes) ?? [])
        data.trips = [trip]; data.appearance = name.contains("light") ? .light : .dark
        if name.contains("transfer-limit") || name.contains("direct-only") { data.flags = [transferLimitFlagKey: true] }
        if name.contains("no-limit") { data.transferLimit = .any }
        if name.contains("direct-only") { data.transferLimit = .direct }
        if name.contains("unknown-line") { data.trips[0].lines = [] }
        data.lastTripId = trip.id
        if ["settings-off", "settings-off-light"].contains(name) { data.useLocation = false }
        if ["settings-on", "settings-on-light"].contains(name) { state.locationGranted = true }
        if ["settings-blocked", "settings-blocked-light"].contains(name) { state.locationDenied = true }
        if name.contains("two-trips") || name.contains("deleted") {
            let second = SavedTrip(id: "second-trip", from: Station(id: "213820", name: "Rhodes Station", modes: ["train"]),
                                   to: Station(id: "201040", name: "Bondi Junction Station", modes: ["train"]), createdAt: now, lines: ["T4", "T9"])
            data.trips.append(second)
            if name.contains("deleted"), let (remaining, pending) = data.beginningDeletion(of: second.id) {
                data = remaining; pendingDeletion = pending
                state.message = deletionMessage(second); state.undoAvailable = true
            }
        }
        state.selectedTripId = trip.id; state.board = board; state.homeBoard = board
        if name.contains("recommendation-outside-prefix"), let journey = board.journeys.first {
            state.recommendation = JourneyRecommendation(journey: journey, board: board)
            state.board?.journeys = Array(board.journeys.dropFirst())
            state.homeBoard = state.board
        }
        if name.contains("just-added") {
            state.justAddedTripId = trip.id
            state.selectionPredicted = true
        }
        if name.contains("pinned") || name.contains("active") || name.contains("inferred"), let journey = board.journeys.first {
            data.focus = FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board, pinned: !name.contains("inferred"))
        }
        if name.contains("commute"), let journey = board.journeys.first {
            if name.contains("before") { state.now = journey.legs[0].effectiveArrival - 60_000 }
            else if name.contains("during") { state.now = journey.legs[0].effectiveArrival + 60_000 }
            else if name.contains("after") { state.now = journey.legs[1].effectiveDeparture + 60_000 }
            else { state.now = journey.effectiveArrival + 300_000 }
            let metadata = ArrivalGuard(armed: true, retainedAt: state.now)
            data.focus = FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board, arrivalGuard: metadata)
            state.arrival = reduceArrival(ArrivalInput(
                identity: arrivalIdentity(data.focus!), departureMs: journey.effectiveDeparture,
                arrivalMs: journey.effectiveArrival, nowMs: state.now, guard: metadata
            ))
        }
        if let stationsURL = Bundle.main.url(forResource: "stations", withExtension: "json"), let raw = try? Data(contentsOf: stationsURL), let stations = try? JSONSerialization.jsonObject(with: raw) as? [[String: Any]] {
            state.stations = stations.compactMap { try? TransitWire.station($0) }
        }
        if name.contains("detail") || name == "ferry" { state.screen = .detail; state.detail = board.journeys.first }
        else if name.contains("board") { state.screen = .board }
        else if name.contains("setup") {
            state.screen = .setup; state.setupFrom = board.from; data.recentTo = [board.to]
            if name.contains("location") {
                state.setupFrom = nil; data.trips = []
                if let url = Bundle.main.url(forResource: "stations", withExtension: "json"),
                   let bytes = try? Data(contentsOf: url), let rows = try? JSONSerialization.jsonObject(with: bytes) as? [[String: Any]] {
                    state.stations = rows.compactMap { try? TransitWire.station($0) }
                }
                if name.contains("loading") { state.setupLocationStatus = .locating }
                else if name.contains("denied") { state.setupLocationStatus = .denied; state.locationDenied = true }
                else if name.contains("failed") { state.setupLocationStatus = .unavailable }
                else if name.contains("disabled") { state.setupLocationStatus = .servicesDisabled }
                else if name.contains("empty") { state.setupLocationStatus = .noNearby }
                else if name.contains("approximate") {
                    state.setupLocationStatus = .chooseStation
                    state.nearbyStations = setupLocationChoice(stations: state.stations, modes: allModes,
                        fix: Fix(lat: -33.873596, lon: 151.206899, at: now, accuracyMetres: 1_000)).stations
                }
            }
        }
        else if name.contains("settings") { state.screen = .settings }
        if name.contains("nearest") {
            state.setupFrom = nil
            state.nearestStation = board.from
            state.locationGranted = true
        }
        if name.contains("feedback") {
            feedbackDraft = "The platform changed after I opened the app."
        }
        if name.contains("empty") { data.modes = []; state.board = nil }
        if name.contains("feedback-success") {
            state.message = "Feedback sent. Thank you."
            state.messageAutoDismiss = true
        }
        state.ready = true; state.timetableStatus = "5 Sep – 4 Oct 2026"
        syncPersonal()
        if name.contains("just-added") { state.tripMetadata[trip.id] = "Never ridden · 480 m away" }
        return true
    }
}
#endif
