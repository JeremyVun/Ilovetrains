import Foundation
import UIKit

let analyticsProductionEndpoint = URL(string: "https://analytics.jeremyvun.com/e")!
let analyticsURLEnvironmentKey = "ILOVETRAINS_ANALYTICS_URL"
let analyticsStoreName = "analytics-v1.json"
let analyticsQueueCap = 200
let analyticsCountCap = 1_000_000
let analyticsFlushDelay: TimeInterval = 10
let analyticsOpensCap = Int(Int32.max)
private let analyticsProject = "ilovetrains"
private let analyticsPlatform = "ios"

#if DEBUG
let analyticsDebugBuild = true
#else
let analyticsDebugBuild = false
#endif

enum HeaderKind: String, Codable, CaseIterable, Sendable {
    case predicted, focus, usual, home, pair, inferred
}

enum PinResult: String, CaseIterable, Sendable {
    case same, service, trip
}

private let usageBands: Set<String> = ["1", "2-5", "6-10", "11-15", "16-20", "21-25", "26-30", "31-35", "36-40", "41-45", "46-50", "51+"]
private let milestones = [1, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 250]
private let milestoneWords = Set(milestones.map(String.init))
private let pinWords = Set(PinResult.allCases.map(\.rawValue))
private let basisWords: Set<String> = ["location", "estimate"]

let analyticsEventNames: Set<String> = Set(HeaderKind.allCases.flatMap { kind in
    ["shown_", "hit_", "miss_", "pinned_"].map { $0 + kind.rawValue }
}).union(["opened", "rode_pin", "rode_auto"])

func usageBand(opens: Int) -> String {
    switch opens {
    case ...1: return "1"
    case ...5: return "2-5"
    case ...10: return "6-10"
    case ...50:
        let first = (opens - 1) / 5 * 5 + 1
        return "\(first)-\(first + 4)"
    default: return "51+"
    }
}

func openMilestone(opens: Int) -> String? {
    milestones.contains(opens) ? String(opens) : nil
}

struct AnalyticsEvent: Equatable, Sendable {
    var t: String
    var d: [String: String]
}

struct AnalyticsEntry: Equatable, Sendable {
    var t: String
    var d: [String: String]
    var n: Int
}

struct AnalyticsState: Equatable, Sendable {
    var opens = 0
    var queue: [AnalyticsEntry] = []
}

private func ownKeys(_ name: String) -> Set<String> {
    if name == "opened" { return ["m"] }
    if name.hasPrefix("pinned_") { return ["r", "pl.r"] }
    if name.hasPrefix("rode_") { return ["b", "pl.b"] }
    return []
}

private func composed(_ d: [String: String], _ key: String, _ words: Set<String>) -> Bool {
    guard let value = d[key], words.contains(value) else { return false }
    return d["pl." + key] == "\(analyticsPlatform).\(value)"
}

func validAnalyticsEvent(_ name: String, _ d: [String: String]) -> Bool {
    guard analyticsEventNames.contains(name), let band = d["u"], usageBands.contains(band),
          d["pl"] == analyticsPlatform, d["pl.u"] == "\(analyticsPlatform).\(band)" else { return false }
    let own: Bool
    if name == "opened" {
        own = d["m"].map(milestoneWords.contains) ?? false
    } else if name.hasPrefix("pinned_") {
        own = composed(d, "r", pinWords)
    } else if name.hasPrefix("rode_") {
        own = composed(d, "b", basisWords)
    } else {
        own = true
    }
    return own && Set(d.keys) == Set(["u", "pl", "pl.u"]).union(ownKeys(name))
}

private func wholeNumber(_ value: Any?, in range: ClosedRange<Int>) -> Int? {
    // JSON booleans also bridge to NSNumber, so they are refused by type.
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
    guard let whole = Int(exactly: number.doubleValue), range.contains(whole) else { return nil }
    return whole
}

private func storedEntry(_ value: Any) -> AnalyticsEntry? {
    guard let raw = value as? [String: Any], raw.count == 3,
          let name = raw["t"] as? String, let rawDims = raw["d"] as? [String: Any],
          let count = wholeNumber(raw["n"], in: 1...analyticsCountCap) else { return nil }
    var dims: [String: String] = [:]
    for (key, value) in rawDims {
        guard let text = value as? String else { return nil }
        dims[key] = text
    }
    return validAnalyticsEvent(name, dims) ? AnalyticsEntry(t: name, d: dims, n: count) : nil
}

/// Nil means malformed and the caller drops the whole store; no data is a fresh store.
func parseAnalyticsStore(_ data: Data?) -> AnalyticsState? {
    guard let data else { return AnalyticsState() }
    guard let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          Set(root.keys) == ["opens", "queue"],
          let opens = wholeNumber(root["opens"], in: 0...analyticsOpensCap),
          let raw = root["queue"] as? [Any] else { return nil }
    var queue: [AnalyticsEntry] = []
    for item in raw {
        guard let entry = storedEntry(item) else { return nil }
        queue.append(entry)
    }
    return AnalyticsState(opens: opens, queue: Array(queue.suffix(analyticsQueueCap)))
}

func analyticsStoreData(_ state: AnalyticsState) -> Data {
    let queue: [[String: Any]] = state.queue.map { ["t": $0.t, "d": $0.d, "n": $0.n] }
    return (try? JSONSerialization.data(withJSONObject: ["opens": state.opens, "queue": queue], options: [.sortedKeys])) ?? Data()
}

func analyticsBody(_ queue: [AnalyticsEntry]) -> Data {
    let events: [[String: Any]] = queue.map { ["p": analyticsProject, "t": $0.t, "d": $0.d, "n": $0.n] }
    return (try? JSONSerialization.data(withJSONObject: events, options: [.sortedKeys])) ?? Data("[]".utf8)
}

/// Only release builds send; a debug build sends only to an explicit capture URL.
func analyticsEndpoint(debug: Bool, capture: String? = nil) -> URL? {
    debug ? capture.flatMap(analyticsCaptureURL) : analyticsProductionEndpoint
}

func analyticsCaptureURL(_ raw: String) -> URL? {
    guard let url = URL(string: raw.trimmingCharacters(in: .whitespacesAndNewlines)),
          let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
          let host = url.host, !host.isEmpty else { return nil }
    return url
}

protocol AnalyticsStore: AnyObject {
    func read() throws -> Data?
    func write(_ data: Data) throws
}

final class FileAnalyticsStore: AnalyticsStore {
    let url: URL

    init(url: URL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent(analyticsStoreName)) {
        self.url = url
    }

    func read() throws -> Data? {
        FileManager.default.fileExists(atPath: url.path) ? try Data(contentsOf: url) : nil
    }

    func write(_ data: Data) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var target = url
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try target.setResourceValues(values)
    }
}

let analyticsSession: URLSession = {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.httpCookieAcceptPolicy = .never
    configuration.urlCredentialStorage = nil
    configuration.urlCache = nil
    configuration.timeoutIntervalForRequest = 10
    configuration.timeoutIntervalForResource = 15
    return URLSession(configuration: configuration)
}()

func postAnalytics(_ body: Data, to url: URL, session: URLSession = analyticsSession) async -> Bool {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 10)
    request.httpMethod = "POST"; request.httpBody = body
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpShouldHandleCookies = false
    guard let (_, response) = try? await session.data(for: request) else { return false }
    return (response as? HTTPURLResponse).map { (200...299).contains($0.statusCode) } ?? false
}

/// Anonymous counters with a closed vocabulary (analytics.md). Every call returns at once:
/// state lives on one serial worker, and a slow POST never delays a count.
final class Analytics: @unchecked Sendable {
    typealias Post = (URL, Data, @escaping (Bool) -> Void) -> Void

    static let shared = Analytics.live()

    private let debug: Bool
    private let store: AnalyticsStore
    private let post: Post
    private let worker: (@escaping () -> Void) -> Void
    private let later: (TimeInterval, @escaping () -> Void) -> Void
    private let lock = NSLock()
    private var target: URL?
    private var events: [AnalyticsEvent] = []
    private var state: AnalyticsState?
    private var inFlight = false
    private var flushScheduled = false
    private var waiting: [() -> Void] = []

    init(
        debug: Bool,
        endpoint: URL?,
        store: AnalyticsStore,
        post: @escaping Post,
        worker: @escaping (@escaping () -> Void) -> Void,
        later: @escaping (TimeInterval, @escaping () -> Void) -> Void
    ) {
        self.debug = debug; self.target = endpoint; self.store = store
        self.post = post; self.worker = worker; self.later = later
    }

    static func live(debug: Bool = analyticsDebugBuild, store: AnalyticsStore = FileAnalyticsStore(), post: Post? = nil) -> Analytics {
        let queue = DispatchQueue(label: "com.ilovetrains.analytics", qos: .utility)
        return Analytics(
            debug: debug,
            endpoint: analyticsEndpoint(debug: debug),
            store: store,
            post: post ?? { url, body, done in Task.detached(priority: .utility) { done(await postAnalytics(body, to: url)) } },
            worker: { queue.async(execute: $0) },
            later: { delay, task in queue.asyncAfter(deadline: .now() + delay, execute: task) }
        )
    }

    var enabled: Bool { lock.withLock { target != nil } }
    var ledger: [AnalyticsEvent] { lock.withLock { events } }
    private var endpoint: URL? { lock.withLock { target } }

    func recordOpen() {
        worker { [self] in
            let current = loaded()
            let opens = min(current.opens + 1, analyticsOpensCap)
            save(AnalyticsState(opens: opens, queue: current.queue))
            if let mark = openMilestone(opens: opens) { record("opened", ["m": mark]) }
        }
    }

    func shown(_ kind: HeaderKind) { track("shown_" + kind.rawValue) }
    func hit(_ kind: HeaderKind) { track("hit_" + kind.rawValue) }
    func miss(_ kind: HeaderKind) { track("miss_" + kind.rawValue) }
    func pinned(_ kind: HeaderKind, _ result: PinResult) {
        track("pinned_" + kind.rawValue, ["r": result.rawValue, "pl.r": "\(analyticsPlatform).\(result.rawValue)"])
    }
    func rode(pinned: Bool, basis: ArrivalBasis) {
        track(pinned ? "rode_pin" : "rode_auto", ["b": basis.rawValue, "pl.b": "\(analyticsPlatform).\(basis.rawValue)"])
    }

    /// A new foreground session: its first event schedules a flush again, and leftovers are sent now.
    func foreground() {
        worker { [self] in
            flushScheduled = false
            if endpoint != nil, !loaded().queue.isEmpty { send(nil) }
        }
    }

    /// `completion` runs once nothing this call started is still in flight.
    func flush(completion: (() -> Void)? = nil) {
        worker { [self] in send(completion) }
    }

    func capture(to raw: String) {
        guard debug, let url = analyticsCaptureURL(raw) else { return }
        worker { [self] in
            lock.withLock { target = url }
            state = nil; flushScheduled = false
        }
    }

    private func track(_ name: String, _ own: [String: String] = [:]) {
        worker { [self] in record(name, own) }
    }

    private func record(_ name: String, _ own: [String: String]) {
        let current = loaded()
        let band = usageBand(opens: current.opens)
        let dims = ["u": band, "pl": analyticsPlatform, "pl.u": "\(analyticsPlatform).\(band)"].merging(own) { derived, _ in derived }
        guard validAnalyticsEvent(name, dims) else { return }
        if debug { lock.withLock { events.append(AnalyticsEvent(t: name, d: dims)) } }
        guard endpoint != nil else { return }
        var queue = current.queue
        if let index = queue.firstIndex(where: { $0.t == name && $0.d == dims }) {
            queue[index].n = min(queue[index].n + 1, analyticsCountCap)
        } else {
            queue.append(AnalyticsEntry(t: name, d: dims, n: 1))
        }
        save(AnalyticsState(opens: current.opens, queue: Array(queue.suffix(analyticsQueueCap))))
        if !flushScheduled {
            flushScheduled = true
            later(analyticsFlushDelay) { [weak self] in self?.flush() }
        }
    }

    private func send(_ completion: (() -> Void)?) {
        if let completion { waiting.append(completion) }
        guard !inFlight else { return }
        guard let url = endpoint else { return finish() }
        let sent = loaded().queue
        guard !sent.isEmpty else { return finish() }
        inFlight = true
        post(url, analyticsBody(sent)) { [weak self] accepted in
            self?.worker { [weak self] in
                guard let self else { return }
                inFlight = false
                if accepted { settle(sent) }
                finish()
            }
        }
    }

    private func finish() {
        let done = waiting
        waiting = []
        done.forEach { $0() }
    }

    // Subtract rather than clear: counts recorded while the request was in flight survive it.
    private func settle(_ sent: [AnalyticsEntry]) {
        let current = loaded()
        let kept = current.queue.compactMap { entry -> AnalyticsEntry? in
            let left = entry.n - (sent.first { $0.t == entry.t && $0.d == entry.d }?.n ?? 0)
            return left > 0 ? AnalyticsEntry(t: entry.t, d: entry.d, n: left) : nil
        }
        save(AnalyticsState(opens: current.opens, queue: kept))
    }

    private func loaded() -> AnalyticsState {
        if let state { return state }
        guard endpoint != nil else {
            state = AnalyticsState()
            return AnalyticsState()
        }
        let text = (try? store.read()) ?? nil
        if let parsed = parseAnalyticsStore(text) {
            state = parsed
            return parsed
        }
        save(AnalyticsState())
        return AnalyticsState()
    }

    private func save(_ next: AnalyticsState) {
        state = next
        guard endpoint != nil else { return }
        try? store.write(analyticsStoreData(next))
    }
}

extension Analytics {
    /// Holds a background task assertion until the queued counts are sent or refused.
    @MainActor
    func flushInBackground(_ application: UIApplication = .shared) {
        let allowance = BackgroundAllowance(application)
        allowance.begin()
        flush { Task { @MainActor in allowance.end() } }
    }
}

@MainActor
private final class BackgroundAllowance {
    private let application: UIApplication
    private var identifier = UIBackgroundTaskIdentifier.invalid

    init(_ application: UIApplication) { self.application = application }

    func begin() {
        identifier = application.beginBackgroundTask(withName: "analytics") { [self] in end() }
    }

    func end() {
        guard identifier != .invalid else { return }
        application.endBackgroundTask(identifier)
        identifier = .invalid
    }
}

/// How home's answer came about (design: "Header kind on native"). Nil is browsing an explicit choice.
func homeAnswerKind(focus: FocusedJourney?, predicted: Selection?, tripId: String, reverse: Bool, autoSavedTripId: String?) -> HeaderKind? {
    if let focus { return focus.pinned ? .focus : .inferred }
    guard let predicted, predicted.tripId == tripId, predicted.reverse == reverse else { return nil }
    return tripId == autoSavedTripId ? .pair : predicted.kind
}

/// The lead journey Home shows for a trip answer, derived as HomeView derives it.
func displayedHomeLead(_ state: AppState) -> Journey? {
    guard let board = state.homeBoard ?? state.board,
          let trip = state.trips.first(where: { $0.id == state.selectedTripId }) else { return nil }
    let from = state.reverse ? trip.to : trip.from
    let to = state.reverse ? trip.from : trip.to
    guard board.from.id == from.id, board.to.id == to.id else { return nil }
    let now = state.now
    let retained = retainedHomeJourney(board, now: now)
    let recommendation = state.recommendation.flatMap { value in
        value.board.from.id == board.from.id && value.board.to.id == board.to.id ? value : nil
    }
    let firstFuture = retained ?? recommendation?.journey
        ?? board.journeys.first { $0.effectiveDeparture >= now }
    let firstRunning = retained.flatMap { $0.cancelled ? nil : $0 } ?? recommendation?.journey
        ?? board.journeys.first { !$0.cancelled && $0.effectiveDeparture >= now }
    return firstRunning ?? firstFuture
}

private struct RideIdentity: Hashable {
    var tripId: String
    var reverse: Bool
    var departure: Millis

    init(_ ride: Ride) { tripId = ride.tripId; reverse = ride.reverse; departure = ride.departure }
}

/// A settlement newly recorded a ride: an identity absent before the write is present after it.
func rideAppended(before: [Ride], after: [Ride]) -> Bool {
    let known = Set(before.map(RideIdentity.init))
    return after.contains { !known.contains(RideIdentity($0)) }
}

/// The per-open attribution rules of analytics.md, "Event vocabulary and ordering", kept as the
/// web keeps them in main.js. An open is a foreground entry, so `.inactive` keeps its guards.
@MainActor
final class HeaderMetrics {
    private enum Entry { case cold, foreground, background }

    private struct Answer {
        var kind: HeaderKind
        var tripId: String
        var reverse: Bool
        var lead: String?
    }

    private let analytics: Analytics
    private var entry = Entry.cold
    private var opened = false
    private var tapped = false
    private var lastShown: String?
    private var answer: Answer?
    private var lastAnswer: Answer?
    private var setup = false
    private var setupWasSaved = false

    init(analytics: Analytics) { self.analytics = analytics }

    /// True when a cold or backgrounded app reaches the foreground: a new open begins.
    @discardableResult
    func resumed() -> Bool {
        guard entry != .foreground else { return false }
        entry = .foreground
        opened = false; tapped = false; lastShown = nil
        answer = nil; lastAnswer = nil; setup = false; setupWasSaved = false
        analytics.foreground()
        return true
    }

    func backgrounded() { entry = .background }

    func setupShown(newVisit: Bool) {
        guard open() else { return }
        if newVisit { setupWasSaved = false }
        setup = true; answer = nil
    }

    func setupSaved() { setupWasSaved = true }

    /// `kind` is nil while Home shows an explicit choice: that counts the open but is no exposure.
    func homeShown(kind: HeaderKind?, tripId: String, reverse: Bool, lead: String?) {
        guard open() else { return }
        guard let kind else {
            // Leaving setup unsaved hands attribution back to the answer it interrupted.
            if setup, !setupWasSaved, let last = lastAnswer, last.tripId == tripId, last.reverse == reverse {
                setup = false; answer = last
            }
            return
        }
        setup = false
        let shown = Answer(kind: kind, tripId: tripId, reverse: reverse, lead: lead)
        answer = shown; lastAnswer = shown
        let key = "\(kind.rawValue):\(tripId):\(reverse)"
        guard key != lastShown else { return }
        lastShown = key
        analytics.shown(kind)
    }

    func tripTapped(tripId: String, reverse: Bool) {
        guard entry == .foreground, !tapped else { return }
        tapped = true
        guard let shown = answer else { return }
        if shown.tripId == tripId && shown.reverse == reverse { analytics.hit(shown.kind) } else { analytics.miss(shown.kind) }
    }

    func pinned(tripId: String, reverse: Bool, journeyKey: String) {
        let shown = answer
        released()
        guard entry == .foreground, let shown else { return }
        let sameTrip = shown.tripId == tripId && shown.reverse == reverse
        if sameTrip { analytics.hit(shown.kind) }
        let result: PinResult
        if !sameTrip {
            result = .trip
        } else if let lead = shown.lead {
            result = lead == journeyKey ? .same : .service
        } else {
            return
        }
        analytics.pinned(shown.kind, result)
    }

    /// Pinning, unpinning and the way back end the attribution, as the web clears its header kind.
    func released() { answer = nil; setup = false }

    func rode(pinned: Bool, basis: ArrivalBasis) { analytics.rode(pinned: pinned, basis: basis) }

    private func open() -> Bool {
        guard entry == .foreground else { return false }
        if !opened { opened = true; analytics.recordOpen() }
        return true
    }
}
