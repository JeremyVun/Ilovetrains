import ActivityKit
import Foundation
import UIKit

enum TravelTrackerSuppression: String, Codable, Equatable, Sendable {
    case dismissed, completed
}

struct TravelTrackerSession: Codable, Equatable, Sendable {
    struct Active: Codable, Equatable, Sendable {
        var identity: TravelTrackerIdentity
        var generation: Int
        var sessionId: UUID
        var activityId: String?
    }

    var active: Active? = nil
    var generation = 0
    var suppressedIdentity: TravelTrackerIdentity? = nil
    var suppression: TravelTrackerSuppression? = nil
    var failedSessionId: UUID? = nil
}

protocol TravelTrackerSessionStoring: Sendable {
    func load() async -> TravelTrackerSession
    func save(_ session: TravelTrackerSession) async
}

actor TravelTrackerSessionFileStore: TravelTrackerSessionStoring {
    private struct Document: Codable {
        var schemaVersion: Int
        var session: TravelTrackerSession
    }

    private let directory: URL
    private let url: URL
    private let fileManager = FileManager.default

    init(directory: URL? = nil) {
        let base = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ILoveTrains", isDirectory: true)
        self.directory = base
        url = base.appendingPathComponent("tracker-v1.json")
    }

    func load() -> TravelTrackerSession {
        guard let bytes = try? Data(contentsOf: url),
              let document = try? JSONDecoder().decode(Document.self, from: bytes),
              document.schemaVersion == 1 else { return TravelTrackerSession() }
        return document.session
    }

    func save(_ session: TravelTrackerSession) {
        guard let bytes = try? JSONEncoder().encode(Document(schemaVersion: 1, session: session)) else { return }
        do {
            try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
            try bytes.write(to: url, options: .atomic)
            protect(directory)
            protect(url)
        } catch {}
    }

    private func protect(_ source: URL) {
        var source = source
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? source.setResourceValues(values)
        try? fileManager.setAttributes(
            [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication],
            ofItemAtPath: source.path
        )
    }
}

struct TravelTrackerActivityRecord: Equatable, Sendable {
    var id: String
    var attributes: TravelTrackerActivityAttributes
    var state: TravelTrackerSystemActivityState = .active
    var contentState: TravelTrackerActivityAttributes.ContentState? = nil
}

enum TravelTrackerSystemActivityState: Equatable, Sendable {
    case active, stale, dismissed, ended
}

struct TravelTrackerAlert: Equatable, Sendable {
    var title: String
    var body: String
}

struct TravelTrackerCue: Equatable, Sendable {
    enum Kind: String, Equatable, Sendable {
        case getOff, change, missedConnection, cancellation, tightChange, delayed
    }

    var kind: Kind
    var legIndex: Int?
    var alert: TravelTrackerAlert
}

/// What the previous live observation saw, so a cue fires on a change rather than on a state.
struct TravelTrackerCueBaseline: Equatable, Sendable {
    var arrivalDelay: Int
    var changeStates: [ConnectionState]
}

protocol TravelTrackerHapticPerforming: Sendable {
    func impact()
}

struct UIKitTravelTrackerHaptics: TravelTrackerHapticPerforming {
    // The buzz must not hold up the publication that carries the same moment to the tracker surface.
    func impact() {
        Task { @MainActor in
            let generator = UIImpactFeedbackGenerator(style: .medium)
            generator.prepare()
            generator.impactOccurred()
        }
    }
}

protocol TravelTrackerActivityDriving: Sendable {
    var activitiesEnabled: Bool { get }
    func activities() async -> [TravelTrackerActivityRecord]
    func request(
        attributes: TravelTrackerActivityAttributes,
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>
    ) async throws -> String
    func update(
        id: String,
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>,
        alert: TravelTrackerAlert?
    ) async
    func end(id: String) async
    func stateUpdates(id: String) -> AsyncStream<TravelTrackerSystemActivityState>
}

struct ActivityKitTravelTrackerDriver: TravelTrackerActivityDriving {
    var activitiesEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    func activities() async -> [TravelTrackerActivityRecord] {
        Activity<TravelTrackerActivityAttributes>.activities.map {
            TravelTrackerActivityRecord(
                id: $0.id,
                attributes: $0.attributes,
                state: .init($0.activityState),
                contentState: $0.content.state
            )
        }
    }

    func request(
        attributes: TravelTrackerActivityAttributes,
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>
    ) async throws -> String {
        try Activity.request(attributes: attributes, content: content, pushType: nil).id
    }

    func update(
        id: String,
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>,
        alert: TravelTrackerAlert?
    ) async {
        guard let activity = activity(id) else { return }
        await activity.update(content, alertConfiguration: alert.map {
            AlertConfiguration(title: "\($0.title)", body: "\($0.body)", sound: .default)
        })
    }

    func end(id: String) async {
        guard let activity = activity(id) else { return }
        await activity.end(nil, dismissalPolicy: .immediate)
    }

    func stateUpdates(id: String) -> AsyncStream<TravelTrackerSystemActivityState> {
        guard let activity = activity(id) else {
            return AsyncStream { continuation in
                continuation.yield(.dismissed)
                continuation.finish()
            }
        }
        return AsyncStream { continuation in
            let task = Task {
                for await state in activity.activityStateUpdates {
                    switch state {
                    case .pending: continuation.yield(.active)
                    case .active: continuation.yield(.active)
                    case .stale: continuation.yield(.stale)
                    case .dismissed: continuation.yield(.dismissed)
                    case .ended: continuation.yield(.ended)
                    @unknown default: break
                    }
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    private func activity(_ id: String) -> Activity<TravelTrackerActivityAttributes>? {
        Activity<TravelTrackerActivityAttributes>.activities.first { $0.id == id }
    }
}

actor TravelTrackerController {
    private struct DesiredPublication: Sendable {
        var active: TravelTrackerSession.Active
        var attributes: TravelTrackerActivityAttributes
        var content: ActivityContent<TravelTrackerActivityAttributes.ContentState>
        var cues: [TravelTrackerCue]
        var baseline: TravelTrackerCueBaseline
    }

    private struct CueSession: Equatable {
        var generation: Int
        var sessionId: UUID
    }

    private struct CueKey: Hashable {
        var kind: TravelTrackerCue.Kind
        var legIndex: Int?
    }

    private let store: TravelTrackerSessionStoring
    private let driver: TravelTrackerActivityDriving
    private let haptics: TravelTrackerHapticPerforming
    private let clock: @Sendable () -> Date
    private var session = TravelTrackerSession()
    private var loaded = false
    private var loadingTask: Task<TravelTrackerSession, Never>?
    private var recovered = false
    private var publicationSequence = 0
    private var publicationTask: Task<Void, Never>?
    private var observationTask: Task<Void, Never>?
    private var currentActivityId: String?
    private var currentActivitySessionId: UUID?
    private var retryCount = 0
    private var retryAfter: Date?
    private var lastPublishedStage: TravelTrackerActivityAttributes.Stage?
    private var lastPublishedContent: TravelTrackerActivityAttributes.ContentState?
    private var cueSession: CueSession?
    private var cuedKeys: Set<CueKey> = []
    private var cueBaseline: TravelTrackerCueBaseline?
    private var lastObservation: Date?
    private var alertsEnabled = true
    private var inBackground = false
    private var lastDeliveredAlert: TravelTrackerAlert?
    private var deliveredHaptics = 0

    init(
        store: TravelTrackerSessionStoring,
        driver: TravelTrackerActivityDriving,
        haptics: TravelTrackerHapticPerforming = UIKitTravelTrackerHaptics(),
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.store = store
        self.driver = driver
        self.haptics = haptics
        self.clock = clock
    }

    nonisolated static func live(directory: URL? = nil) -> TravelTrackerController {
        TravelTrackerController(
            store: TravelTrackerSessionFileStore(directory: directory),
            driver: ActivityKitTravelTrackerDriver()
        )
    }

    @discardableResult
    func reconcile(
        focus: FocusedJourney?,
        visibleFocus: FocusedJourney?,
        now: Millis,
        recordedComplete: Bool,
        arrivalState: ArrivalState? = nil,
        arrivalMoving: Bool = false,
        journeyAlerts: Bool = true,
        background: Bool = false,
        debugStaticCountdown: String? = nil
    ) async -> TravelTrackerState? {
        alertsEnabled = journeyAlerts
        inBackground = background
        await prepare(focus: focus)
        guard let focus else {
            if session.active != nil {
                session.active = nil
                await store.save(session)
            }
            schedule(nil)
            return nil
        }

        let identity = focus.trackerIdentity
        if let active = session.active, active.identity != identity {
            session.generation += 1
            session.active = TravelTrackerSession.Active(
                identity: identity,
                generation: session.generation,
                sessionId: UUID(),
                activityId: nil
            )
            session.failedSessionId = nil
            if session.suppressedIdentity == identity {
                session.suppressedIdentity = nil
                session.suppression = nil
            }
            await store.save(session)
        } else if session.active == nil {
            let completedCanResume = session.suppressedIdentity == identity
                && session.suppression == .completed
                && !recordedComplete
                && TravelTrackerState.derive(
                    focus: focus,
                    now: now,
                    generation: 0,
                    arrivalState: arrivalState,
                    arrivalMoving: arrivalMoving
                ) != nil
            let newFocus = !(session.suppressedIdentity == identity && session.suppression == .dismissed)
            if completedCanResume || newFocus {
                session.generation += 1
                session.active = TravelTrackerSession.Active(
                    identity: identity,
                    generation: session.generation,
                    sessionId: UUID(),
                    activityId: nil
                )
                session.failedSessionId = nil
                if session.suppressedIdentity == identity {
                    session.suppressedIdentity = nil
                    session.suppression = nil
                }
                await store.save(session)
            }
        }

        guard var active = session.active, active.identity == identity else {
            schedule(nil)
            return nil
        }
        if recordedComplete {
            await suppress(.completed, identity: identity)
            return nil
        }
        guard let state = TravelTrackerState.derive(
            focus: focus,
            now: now,
            generation: active.generation,
            arrivalState: arrivalState,
            arrivalMoving: arrivalMoving
        ) else {
            await suppress(.completed, identity: identity)
            return nil
        }
        guard visibleFocus?.trackerIdentity == identity else {
            if active.activityId != nil {
                active.activityId = nil
                session.active = active
                await store.save(session)
            }
            schedule(nil)
            return state
        }

        let attributes = TravelTrackerActivityContentMapper.attributes(active: active)
        let contentState = TravelTrackerActivityContentMapper.contentState(
            state: state,
            focus: focus,
            now: now,
            debugStaticCountdown: debugStaticCountdown
        )
        let plan = recoveryPlan(focus)
        schedule(DesiredPublication(
            active: active,
            attributes: attributes,
            content: ActivityContent(state: contentState, staleDate: contentState.staleDate),
            cues: TravelTrackerCue.pending(state: state, focus: focus, now: now, previous: cueBaseline),
            baseline: trackerCueBaseline(plan)
        ))
        return state
    }

    func focusIdentity(for url: URL) async -> TravelTrackerIdentity? {
        await load()
        guard url.scheme == "ilovetrains", url.host == "tracker",
              let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?
                .queryItems?.first(where: { $0.name == "session" })?.value,
              let requested = UUID(uuidString: raw),
              let active = session.active, active.sessionId == requested,
              session.suppressedIdentity != active.identity || session.suppression == nil else { return nil }
        return active.identity
    }

    func awaitPublications() async {
        await publicationTask?.value
    }

    func snapshot() async -> TravelTrackerSession {
        await load()
        return session
    }

    #if DEBUG
    func debugStatus() async -> String {
        await load()
        let activities = await driver.activities()
        let active = session.active
        return [
            "activity=\(active?.activityId ?? "none")",
            "session=\(active?.sessionId.uuidString ?? "none")",
            "activeFocus=\(active?.identity.tripId ?? "none")",
            "suppressed=\(session.suppression?.rawValue ?? "none")",
            "activities=\(activities.count)",
            "stage=\(lastPublishedStage?.rawValue ?? activities.first?.contentState?.stage.rawValue ?? "none")",
            "alert=\(lastDeliveredAlert?.title ?? "none")",
            "haptics=\(deliveredHaptics)",
            "state=\(activities.first(where: { $0.id == active?.activityId })?.state.debugName ?? "none")",
        ].joined(separator: "|")
    }

    func debugInspect(focus: FocusedJourney?) async -> String {
        await prepare(focus: focus)
        return await debugStatus()
    }
    #endif

    private func prepare(focus: FocusedJourney?) async {
        await load()
        guard !recovered else { return }
        recovered = true
        let records = await driver.activities()
        let matching = records.first { record in
            guard let active = session.active else { return false }
            return record.attributes.sessionId == active.sessionId
                && record.attributes.focus == active.identity.activityIdentity
                && focus?.trackerIdentity == active.identity
        }
        if let matching, var active = session.active {
            active.activityId = matching.id
            session.active = active
            currentActivityId = matching.id
            currentActivitySessionId = active.sessionId
            lastPublishedContent = matching.contentState
            observe(id: matching.id, active: active)
            await store.save(session)
        } else if let active = session.active, active.activityId != nil,
                  focus?.trackerIdentity == active.identity {
            session.active = nil
            session.suppressedIdentity = active.identity
            session.suppression = .dismissed
            await store.save(session)
        }
        for record in records where record.id != matching?.id {
            await driver.end(id: record.id)
        }
    }

    private func load() async {
        guard !loaded else { return }
        if loadingTask == nil {
            let store = store
            loadingTask = Task { await store.load() }
        }
        let task = loadingTask!
        let loadedSession = await task.value
        guard !loaded else { return }
        session = loadedSession
        session.generation = max(session.generation, session.active?.generation ?? 0)
        loaded = true
        loadingTask = nil
    }

    private func suppress(_ reason: TravelTrackerSuppression, identity: TravelTrackerIdentity) async {
        guard session.active?.identity == identity else { return }
        session.active = nil
        session.suppressedIdentity = identity
        session.suppression = reason
        await store.save(session)
        schedule(nil)
    }

    private func schedule(_ desired: DesiredPublication?) {
        publicationSequence += 1
        let sequence = publicationSequence
        let previous = publicationTask
        publicationTask = Task { [weak self] in
            await previous?.value
            await self?.publish(desired, sequence: sequence)
        }
    }

    private func publish(_ desired: DesiredPublication?, sequence: Int) async {
        guard sequence == publicationSequence else { return }
        guard let desired else {
            observationTask?.cancel()
            observationTask = nil
            forgetCues()
            guard let id = currentActivityId else { return }
            currentActivityId = nil
            currentActivitySessionId = nil
            lastPublishedContent = nil
            session.active?.activityId = nil
            await store.save(session)
            await driver.end(id: id)
            return
        }
        guard var active = session.active,
              active.identity == desired.active.identity,
              active.generation == desired.active.generation,
              active.sessionId == desired.active.sessionId else { return }

        // On screen the cue belongs to the moment, not to the surface, so decide it before the activity guards.
        let observed = cueing(desired)
        let cue = alertsEnabled ? observed : nil
        if cue != nil, !inBackground {
            deliveredHaptics += 1
            haptics.impact()
        }

        if let id = currentActivityId, currentActivitySessionId == active.sessionId {
            let alert = inBackground ? cue?.alert : nil
            guard alert != nil || !samePublishedContent(lastPublishedContent, desired.content.state) else { return }
            await driver.update(id: id, content: desired.content, alert: alert)
            lastDeliveredAlert = alert ?? lastDeliveredAlert
            lastPublishedStage = desired.content.state.stage
            lastPublishedContent = desired.content.state
            return
        }
        if let id = currentActivityId {
            observationTask?.cancel()
            observationTask = nil
            currentActivityId = nil
            currentActivitySessionId = nil
            lastPublishedContent = nil
            await driver.end(id: id)
            guard sequence == publicationSequence else { return }
        }
        guard driver.activitiesEnabled, session.failedSessionId != active.sessionId else { return }
        if let retryAfter, retryAfter > Date() { return }
        do {
            let id = try await driver.request(attributes: desired.attributes, content: desired.content)
            guard sequence == publicationSequence,
                  session.active?.identity == desired.active.identity,
                  session.active?.generation == desired.active.generation,
                  session.active?.sessionId == desired.active.sessionId else {
                await driver.end(id: id)
                return
            }
            active.activityId = id
            session.active = active
            session.failedSessionId = nil
            retryCount = 0
            retryAfter = nil
            currentActivityId = id
            currentActivitySessionId = active.sessionId
            lastPublishedStage = desired.content.state.stage
            lastPublishedContent = desired.content.state
            await store.save(session)
            observe(id: id, active: active)
        } catch {
            if terminalAuthorizationError(error) {
                session.failedSessionId = active.sessionId
                await store.save(session)
            } else {
                retryCount += 1
                retryAfter = Date().addingTimeInterval(min(30, pow(2, Double(min(retryCount, 5)))))
            }
        }
    }

    private func cueing(_ desired: DesiredPublication) -> TravelTrackerCue? {
        let session = CueSession(
            generation: desired.content.state.generation,
            sessionId: desired.active.sessionId
        )
        let observedAt = clock()
        // A gap means the app was not observing, so what it now sees is a starting point rather than a moment.
        let gap = lastObservation.map { observedAt.timeIntervalSince($0) >= trackerObservationGap } ?? true
        let newSession = cueSession != session
        if newSession {
            cueSession = session
            cuedKeys = []
        }
        lastObservation = observedAt
        // A delay crossing five minutes is its own once-per-crossing rule, so it never joins the fired keys.
        let fresh = desired.cues.filter {
            $0.kind == .delayed || cuedKeys.insert(CueKey(kind: $0.kind, legIndex: $0.legIndex)).inserted
        }
        cueBaseline = desired.baseline
        guard !newSession, !gap else { return nil }
        return fresh.min { $0.kind.priority < $1.kind.priority }
    }

    private func forgetCues() {
        cueSession = nil
        cuedKeys = []
        cueBaseline = nil
        lastObservation = nil
    }

    private func observe(id: String, active: TravelTrackerSession.Active) {
        observationTask?.cancel()
        let updates = driver.stateUpdates(id: id)
        observationTask = Task { [weak self] in
            for await state in updates {
                guard state == .dismissed || state == .ended else { continue }
                await self?.activityEnded(id: id, active: active)
            }
        }
    }

    private func activityEnded(id: String, active: TravelTrackerSession.Active) async {
        guard session.active == active, session.active?.activityId == id else { return }
        observationTask?.cancel()
        observationTask = nil
        currentActivityId = nil
        currentActivitySessionId = nil
        lastPublishedContent = nil
        forgetCues()
        session.active = nil
        session.suppressedIdentity = active.identity
        session.suppression = .dismissed
        await store.save(session)
    }
}

private func terminalAuthorizationError(_ error: Error) -> Bool {
    guard let error = error as? ActivityAuthorizationError else { return false }
    return switch error {
    case .attributesTooLarge, .unsupported, .denied, .unsupportedTarget, .unentitled:
        true
    default:
        false
    }
}

private func samePublishedContent(
    _ lhs: TravelTrackerActivityAttributes.ContentState?,
    _ rhs: TravelTrackerActivityAttributes.ContentState
) -> Bool {
    guard var lhs else { return false }
    var rhs = rhs
    lhs.progress = 0
    rhs.progress = 0
    if lhs.eventDeadline != nil {
        lhs.timerStart = .distantPast
        lhs.headline.emphasis = nil
    }
    if rhs.eventDeadline != nil {
        rhs.timerStart = .distantPast
        rhs.headline.emphasis = nil
    }
    #if DEBUG
    lhs.debugStaticCountdown = nil
    rhs.debugStaticCountdown = nil
    #endif
    return lhs == rhs
}

private extension TravelTrackerSystemActivityState {
    init(_ value: ActivityState) {
        switch value {
        case .pending: self = .active
        case .active: self = .active
        case .stale: self = .stale
        case .dismissed: self = .dismissed
        case .ended: self = .ended
        @unknown default: self = .ended
        }
    }

    var debugName: String {
        switch self {
        case .active: "active"
        case .stale: "stale"
        case .dismissed: "dismissed"
        case .ended: "ended"
        }
    }
}

let trackerObservationGap: TimeInterval = 30

let trackerDelayCueMinutes = 5

extension TravelTrackerCue.Kind {
    var priority: Int {
        switch self {
        case .cancellation: 0
        case .missedConnection: 1
        case .getOff, .change: 2
        case .tightChange: 3
        case .delayed: 4
        }
    }
}

func trackerArrivalDelay(_ journey: Journey) -> Int {
    guard let last = journey.legs.last, last.estimatedArrival != nil else { return 0 }
    return minutesBetween(last.arrival, last.effectiveArrival)
}

func trackerCueBaseline(_ plan: RecoveryPlan) -> TravelTrackerCueBaseline {
    TravelTrackerCueBaseline(arrivalDelay: trackerArrivalDelay(plan.composed), changeStates: plan.composedStates)
}

private func trackerService(_ leg: Leg) -> String {
    "the " + (leg.line.isEmpty ? trackerVehicle(leg.mode).lowercased() : leg.line)
}

extension TravelTrackerCue {
    static func pending(
        state: TravelTrackerState,
        focus: FocusedJourney,
        now: Millis,
        previous: TravelTrackerCueBaseline? = nil
    ) -> [TravelTrackerCue] {
        let plan = recoveryPlan(focus)
        var cues: [TravelTrackerCue] = []
        if state.event.kind == .cancellation {
            cues.append(TravelTrackerCue(
                kind: .cancellation,
                legIndex: nil,
                alert: TravelTrackerAlert(title: "Service cancelled", body: "The planned service has been cancelled.")
            ))
        }
        if let missed = missedConnectionCue(state: state, plan: plan, previous: previous) { cues.append(missed) }
        if let tight = tightChangeCue(state: state, plan: plan, previous: previous) { cues.append(tight) }
        if let delayed = delayedCue(plan: plan, previous: previous) { cues.append(delayed) }
        let legs = plan.composed.legs
        guard let lead = state.alertLead, now >= lead, legs.indices.contains(state.activeLegIndex) else { return cues }
        let station = legs[state.activeLegIndex].to.shortName
        switch state.stage {
        case .final:
            cues.append(TravelTrackerCue(
                kind: .getOff,
                legIndex: state.activeLegIndex,
                alert: TravelTrackerAlert(
                    title: "Get off soon",
                    body: "Get off at \(station) in about 2 minutes."
                )
            ))
        case .ride:
            guard state.missedConnection?.fromLegIndex != state.activeLegIndex,
                  legs.indices.contains(state.activeLegIndex + 1) else { break }
            let next = legs[state.activeLegIndex + 1]
            let service = next.line.isEmpty ? trackerVehicle(next.mode) : next.line
            cues.append(TravelTrackerCue(
                kind: .change,
                legIndex: state.activeLegIndex,
                alert: TravelTrackerAlert(
                    title: "Change services soon",
                    body: "Get off at \(station) in about 2 minutes to change to \(service)."
                )
            ))
        default:
            break
        }
        return cues
    }

    private static func missedConnectionCue(
        state: TravelTrackerState,
        plan: RecoveryPlan,
        previous: TravelTrackerCueBaseline?
    ) -> TravelTrackerCue? {
        let observed = plan.followedStates.firstIndex(of: .lost).flatMap { index -> Int? in
            guard let previous else { return nil }
            let wasLost = previous.changeStates.indices.contains(index) && previous.changeStates[index] == .lost
            return wasLost ? nil : index
        }
        guard let index = state.stage == .missedTransfer ? state.activeLegIndex : observed else { return nil }
        let legs = plan.composed.legs
        let candidate = plan.recoveryChangeIndex == index && legs.indices.contains(index + 1) ? legs[index + 1] : nil
        let body = candidate.map {
            "The planned trains no longer connect. Another option is \(trackerService($0)) at "
                + "\(clockTime($0.effectiveDeparture)) from \($0.from.shortName)."
        } ?? "The planned connection has been missed."
        return TravelTrackerCue(
            kind: .missedConnection,
            legIndex: index,
            alert: TravelTrackerAlert(title: "Connection missed", body: body)
        )
    }

    private static func tightChangeCue(
        state: TravelTrackerState,
        plan: RecoveryPlan,
        previous: TravelTrackerCueBaseline?
    ) -> TravelTrackerCue? {
        let index = state.activeLegIndex
        guard state.stage == .ride, let previous,
              plan.composedStates.indices.contains(index), plan.composedStates[index] == .tight,
              !(previous.changeStates.indices.contains(index) && previous.changeStates[index] == .tight)
        else { return nil }
        let legs = plan.composed.legs
        let next = legs[index + 1]
        return TravelTrackerCue(
            kind: .tightChange,
            legIndex: index,
            alert: TravelTrackerAlert(
                title: "Tight change",
                body: "The train is expected at \(legs[index].to.shortName) about "
                    + "\(connectionWindow(legs[index], next)) minutes before \(trackerService(next)) leaves."
            )
        )
    }

    private static func delayedCue(
        plan: RecoveryPlan,
        previous: TravelTrackerCueBaseline?
    ) -> TravelTrackerCue? {
        guard let previous, let last = plan.composed.legs.last,
              trackerArrivalDelay(plan.composed) >= trackerDelayCueMinutes,
              previous.arrivalDelay < trackerDelayCueMinutes else { return nil }
        return TravelTrackerCue(
            kind: .delayed,
            legIndex: nil,
            alert: TravelTrackerAlert(
                title: "Running late",
                body: "The train is now due at \(last.to.shortName) at \(clockTime(last.effectiveArrival))."
            )
        )
    }
}

enum TravelTrackerActivityContentMapper {
    static func attributes(active: TravelTrackerSession.Active) -> TravelTrackerActivityAttributes {
        var components = URLComponents()
        components.scheme = "ilovetrains"
        components.host = "tracker"
        components.queryItems = [URLQueryItem(name: "session", value: active.sessionId.uuidString)]
        return TravelTrackerActivityAttributes(
            sessionId: active.sessionId,
            focus: active.identity.activityIdentity,
            deepLinkURL: components.url!
        )
    }

    static func contentState(
        state: TravelTrackerState,
        focus: FocusedJourney,
        now: Millis,
        debugStaticCountdown: String? = nil
    ) -> TravelTrackerActivityAttributes.ContentState {
        let legs = focus.composedJourney.legs
        let freshBoundary = state.freshUntil ?? 0
        let staleAt = min(state.nextBoundary, freshBoundary)
        var content = TravelTrackerActivityAttributes.ContentState(
            generation: state.revision.generation,
            stage: .init(state.stage),
            eventKind: .init(state.event.kind),
            headline: .init(lead: state.headline.lead, emphasis: state.headline.emphasis, tail: state.headline.tail),
            instruction: state.instruction,
            instructionRuns: instructionRuns(state.instruction, platforms: state.platforms),
            platforms: state.platforms.map {
                .init(role: .init($0.role), legIndex: $0.legIndex, mode: $0.mode,
                      stationName: $0.stationName, label: $0.label)
            },
            connection: state.connection,
            tightConnection: state.tightConnection,
            destination: state.destination,
            eta: date(state.eta),
            etaText: state.etaText,
            timerStart: date(min(now, state.event.deadline)),
            eventDeadline: state.event.countdownMinutes == nil ? nil : date(state.event.deadline),
            journeyStart: date(legs.first?.effectiveDeparture ?? now),
            journeyEnd: date(legs.last?.effectiveArrival ?? now),
            segments: state.segments.map {
                .init(kind: .init($0.kind), legIndex: $0.legIndex, line: $0.line, mode: $0.mode,
                      colorHex: $0.kind == .ride ? lineColorHex(line: $0.line, mode: $0.mode) : nil,
                      startFraction: $0.startFraction, endFraction: $0.endFraction)
            },
            progress: min(1, max(0, state.progress)),
            provenance: state.provenance,
            staleProvenance: staleProvenance(focus: focus, state: state),
            nextBoundary: date(state.nextBoundary),
            staleDate: date(staleAt),
            cancelled: state.cancelled,
            arrivalCancelled: state.arrivalCancelled
        )
        #if DEBUG
        content.debugStaticCountdown = debugStaticCountdown
        if debugStaticCountdown != nil {
            // Static captures keep the host visible; the wall-clock lane tests OS staleness.
            content.staleDate = Date().addingTimeInterval(3_600)
        }
        #endif
        return content
    }

    private static func instructionRuns(
        _ instruction: String,
        platforms: [TravelTrackerPlatform]
    ) -> [TravelTrackerActivityAttributes.TextRun] {
        var marked: [(Range<String.Index>, Range<String.Index>)] = []
        var searchStart = instruction.startIndex
        for platform in platforms {
            guard let labelRange = instruction.range(of: platform.label, range: searchStart..<instruction.endIndex) else { continue }
            let prefix = platform.label.range(of: " ").map { platform.label[..<$0.upperBound] }
            let emphasis = prefix.map { String(platform.label.dropFirst($0.count)) } ?? platform.label
            guard let emphasisRange = instruction.range(of: emphasis, range: labelRange) else { continue }
            marked.append((labelRange, emphasisRange))
            searchStart = labelRange.upperBound
        }
        guard !marked.isEmpty else { return [.init(text: instruction, role: .plain)] }
        var runs: [TravelTrackerActivityAttributes.TextRun] = []
        var cursor = instruction.startIndex
        for (label, emphasis) in marked {
            if cursor < emphasis.lowerBound {
                runs.append(.init(text: String(instruction[cursor..<emphasis.lowerBound]), role: .plain))
            }
            runs.append(.init(text: String(instruction[emphasis]), role: .platform))
            cursor = label.upperBound
        }
        if cursor < instruction.endIndex {
            runs.append(.init(text: String(instruction[cursor...]), role: .plain))
        }
        return runs
    }

    private static func staleProvenance(focus: FocusedJourney, state: TravelTrackerState) -> String {
        switch state.freshness {
        case .live, .stale: "Last updated \(trackerActivityClock(focus.board.generatedAt))"
        default: state.provenance
        }
    }

    private static func lineColorHex(line: String?, mode: String?) -> UInt32 {
        if mode?.lowercased() == "ferry" { return 0x5AB031 }
        return [
            "T1": 0xF99D1C, "T2": 0x0098CD, "T3": 0xF37021, "T4": 0x005AA3,
            "T5": 0xC4258F, "T7": 0x6F818E, "T8": 0x00954C, "T9": 0xD11F2F,
            "M1": 0x168388, "BMT": 0xF99D1C, "CCN": 0xD11F2F, "SCO": 0x0098CD,
            "SHL": 0x00954C, "HUN": 0x833134,
        ][line?.uppercased() ?? ""] ?? 0x6F818E
    }

    private static func date(_ milliseconds: Millis) -> Date {
        Date(timeIntervalSince1970: milliseconds / 1_000)
    }
}

extension FocusedJourney {
    var trackerIdentity: TravelTrackerIdentity {
        TravelTrackerIdentity(tripId: tripId, reverse: reverse, serviceKey: journey.key)
    }
}

private extension TravelTrackerIdentity {
    var activityIdentity: TravelTrackerActivityAttributes.FocusIdentity {
        .init(tripId: tripId, reverse: reverse, serviceKey: serviceKey)
    }
}

private extension TravelTrackerActivityAttributes.Stage {
    init(_ value: TravelTrackerStage) { self = Self(rawValue: value.rawValue)! }
}

private extension TravelTrackerActivityAttributes.EventKind {
    init(_ value: TravelTrackerEventKind) { self = Self(rawValue: value.rawValue)! }
}

private extension TravelTrackerActivityAttributes.PlatformRole {
    init(_ value: TravelTrackerPlatformRole) { self = Self(rawValue: value.rawValue)! }
}

private extension TravelTrackerActivityAttributes.SegmentKind {
    init(_ value: TravelTrackerSegmentKind) { self = Self(rawValue: value.rawValue)! }
}

private func trackerActivityClock(_ time: Millis) -> String {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Australia/Sydney")!
    let parts = calendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: time / 1_000))
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
}
