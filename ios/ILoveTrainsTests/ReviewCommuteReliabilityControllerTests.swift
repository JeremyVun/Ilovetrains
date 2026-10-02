import ActivityKit
import XCTest
@testable import ILoveTrains

/// Adversarial probes for commute-reliability rule 3 and inferred entry through the real controller, driven offline
/// the way the owner rides: every request fails and the bundled timetable answers. Each test states what design.md
/// and client-storage.md require; a failure is a defect (REVIEW.md).
@MainActor
final class ReviewCommuteReliabilityControllerTests: XCTestCase {
    private var models: [TrainViewModel] = []
    private let analytics = makeAnalytics(debug: true)
    private var origin: Station!
    private var destination: Station!

    override func setUp() async throws {
        try await super.setUp()
        ReviewTransport.reset()
        let stations = try await DeviceStore(directory: reviewTemporaryDirectory()).stations()
        origin = try XCTUnwrap(stations.first { $0.id == "200060" })
        destination = try XCTUnwrap(stations.first { $0.id == "215020" })
    }

    override func tearDown() async throws {
        for model in models { model.stopForTests() }
        models = []
        ReviewTransport.reset()
        try await super.tearDown()
    }

    /// Lead suspect 1 (build_plan.md Execution). Ruling 2: seen at the platform again after the shown train left means
    /// the rider did not board it. The hold rule replaces the stored record; the snapshot the visit began with must
    /// not enter that departed train when the rider boards the next one.
    func testAPlatformSightingAfterDepartureRetiresTheDepartedTrainFromTheSnapshotToo() async throws {
        let planner = OfflinePlanner()
        let boarded = try await firstDirect(planner, at: mondayMorning)
        let clock = ReviewClock(boarded.effectiveDeparture - 120_000)
        let location = ReviewLocation()
        let (store, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: location)
        model.resume()
        try await refreshWritten(model, store)

        model.receiveLocation(Fix(at: (origin.lat, origin.lon), time: clock.now, speed: 0))
        try await until { await store.load().lastAnswer?.stationId == self.origin.id }
        let afterSighting = await store.load()
        let seen = try XCTUnwrap(afterSighting.lastAnswer)
        let departure = seen.journey.effectiveDeparture

        // A quick app switch a minute before the train: the return (not a new open) snapshots the stored record.
        model.pause()
        clock.now = departure - 60_000
        model.resume()
        try await refreshWritten(model, store)
        let afterReturn = await store.load()
        XCTAssertEqual(afterReturn.lastAnswer?.journey.key, seen.journey.key, "the return's refresh keeps the platform record")

        // Seventy seconds after it left, the rider is still on the platform.
        clock.now = departure + 70_000
        model.tick()
        model.receiveLocation(Fix(at: (origin.lat, origin.lon), time: clock.now, speed: 0))
        try await until(seconds: 30) {
            let stored = await store.load().lastAnswer
            return stored?.journey.key != seen.journey.key && stored?.stationId == self.origin.id
        }
        let afterSecondSighting = await store.load()
        let next = try XCTUnwrap(afterSecondSighting.lastAnswer)
        XCTAssertGreaterThan(next.journey.effectiveDeparture, departure)
        try await until { !model.state.refreshing }

        // The rider boards that next train; a tick fix at train speed a minute after it leaves.
        clock.now = next.journey.effectiveDeparture + 60_000
        model.tick()
        model.receiveLocation(Fix(at: along(0.12), time: clock.now, speed: 14))

        let focus = try XCTUnwrap(model.state.focus, "the moving fix did not enter trip mode")
        XCTAssertNotEqual(focus.journey.key, seen.journey.key, "entered the train the rider was seen not to board")
        XCTAssertEqual(focus.journey.key, next.journey.key)
    }

    /// Inferred entry "is evaluated when a valid fix arrives on home"; a fix landing while the rider browses a board
    /// "cannot alter the current screen" (client-storage.md, Travel mode). Web and Android return before inferring.
    func testAFixArrivingOffHomeDoesNotEnterTripMode() async throws {
        let planner = OfflinePlanner()
        try await planner.initialize()
        let clock = ReviewClock(mondayMorning)
        let board = try await planner.plan(from: origin, to: destination, at: clock.now - 900_000, modes: allModes, limit: 24, maxTransfers: 2)
        let boarded = try XCTUnwrap(board.journeys.last { !$0.cancelled && $0.effectiveDeparture <= clock.now - 180_000 })
        let seen = LastAnswer(tripId: commute.id, reverse: false, at: boarded.effectiveDeparture - 120_000, stationId: origin.id,
                              board: BoardData(from: origin, to: destination, journeys: [boarded], generatedAt: 0, offline: true),
                              journey: boarded)
        let (store, model) = try await model(UserData(trips: [commute], lastAnswer: seen), planner: planner, clock: clock,
                                             location: ReviewLocation())
        model.resume()
        try await refreshWritten(model, store)
        model.openTrip(id: commute.id)
        XCTAssertEqual(model.state.screen, .board)

        model.receiveLocation(Fix(at: along(0.17), time: clock.now, speed: 14))

        XCTAssertNil(model.state.focus, "a fix that landed on the board entered trip mode: \(String(describing: model.state.focus?.journey.key))")
        XCTAssertEqual(model.state.screen, .board)
    }

    private var commute: SavedTrip { SavedTrip(id: "rt", from: origin, to: destination) }

    /// A weekday morning inside the bundled timetable's coverage.
    private var mondayMorning: Millis {
        ISO8601DateFormatter().date(from: "2026-09-07T08:00:00+10:00")!.timeIntervalSince1970 * 1_000
    }

    private func along(_ fraction: Double) -> (Double, Double) {
        (origin.lat + (destination.lat - origin.lat) * fraction, origin.lon + (destination.lon - origin.lon) * fraction)
    }

    private func firstDirect(_ planner: OfflinePlanner, at: Millis) async throws -> Journey {
        try await planner.initialize()
        let board = try await planner.plan(from: origin, to: destination, at: at, modes: ["train"], limit: timetablePageLimit, maxTransfers: 2)
        return try XCTUnwrap(board.journeys.first { $0.legs.count == 1 && !$0.cancelled && $0.effectiveDeparture >= at })
    }

    private func model(
        _ data: UserData,
        planner: OfflinePlanner = OfflinePlanner(),
        clock: ReviewClock,
        location: ReviewLocation
    ) async throws -> (DeviceStore, TrainViewModel) {
        let store = DeviceStore(directory: reviewTemporaryDirectory())
        try await store.save(data)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReviewTransport.self]
        var api = TransitAPI()
        api.baseURL = "http://offline.invalid"
        api.session = URLSession(configuration: configuration)
        let tracker = TravelTrackerController(store: TravelTrackerSessionFileStore(directory: reviewTemporaryDirectory()), driver: ReviewActivities())
        let model = TrainViewModel(store: store, api: api, planner: planner, tracker: tracker, location: location,
                                   keepalive: ReviewKeepalive(), analytics: analytics, clock: { clock.now })
        models.append(model)
        try await until { model.state.ready }
        return (store, model)
    }

    /// The refresh writes `lastAnswer` after it caches its board; wait past both.
    private func refreshWritten(_ model: TrainViewModel, _ store: DeviceStore) async throws {
        try await until { !model.state.refreshing && model.state.recommendation != nil }
        try await until { await store.cached(from: self.origin, to: self.destination, modes: allModes) != nil }
        try await Task.sleep(for: .milliseconds(300))
    }

    private func until(seconds: Double = 10, _ condition: @escaping () async -> Bool,
                       file: StaticString = #filePath, line: UInt = #line) async throws {
        let deadline = Date().addingTimeInterval(seconds)
        while Date() < deadline {
            if await condition() { return }
            try await Task.sleep(for: .milliseconds(20))
        }
        XCTFail("The controller never reached the expected state", file: file, line: line)
        throw CancellationError()
    }
}

private extension Fix {
    init(at point: (Double, Double), time: Millis, speed: Double) {
        self.init(lat: point.0, lon: point.1, at: time, speed: speed, accuracyMetres: 10)
    }
}

private final class ReviewClock {
    var now: Millis
    init(_ now: Millis) { self.now = now }
}

private final class ReviewLocation: LocationProviding {
    var onPermission: ((Bool, Bool) -> Void)?
    var onFix: ((Fix) -> Void)?
    var onFailure: ((SetupLocationStatus) -> Void)?
    var isMonitoring = false
    var requests: [Bool] = []
    func refreshPermission() { onPermission?(true, false) }
    func openSettings() {}
    func request(prompt: Bool, precise: Bool) { requests.append(precise) }
    func monitoringPermitted() async -> Bool { true }
    func startMonitoring() -> Bool { isMonitoring = true; return true }
    func stop() { isMonitoring = false }
}

@MainActor
private final class ReviewKeepalive: TrackerKeepaliveDriving {
    var isRunning: Bool { false }
    func start() -> Bool { false }
    func stop() {}
}

private struct ReviewActivities: TravelTrackerActivityDriving {
    let activitiesEnabled = true
    func activities() async -> [TravelTrackerActivityRecord] { [] }
    func request(
        attributes: TravelTrackerActivityAttributes,
        content: ActivityContent<TravelTrackerActivityAttributes.ContentState>
    ) async throws -> String { UUID().uuidString }
    func update(id: String, content: ActivityContent<TravelTrackerActivityAttributes.ContentState>, alert: TravelTrackerAlert?) async {}
    func end(id: String) async {}
    func stateUpdates(id: String) -> AsyncStream<TravelTrackerSystemActivityState> { AsyncStream { $0.finish() } }
}

/// No connection: every request fails.
private final class ReviewTransport: URLProtocol {
    private static let lock = NSLock()
    private static var seen: [URL] = []

    static func reset() { lock.withLock { seen = [] } }
    static func requests() -> [URL] { lock.withLock { seen } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.lock.withLock { Self.seen.append(request.url!) }
        client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
    }
    override func stopLoading() {}
}

private func reviewTemporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
}
