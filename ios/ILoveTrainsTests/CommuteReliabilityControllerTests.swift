import ActivityKit
import XCTest
@testable import ILoveTrains

/// The commute-reliability controller paths, driven offline the way the owner rides:
/// every request fails and the bundled timetable answers, at a clock it covers.
@MainActor
final class CommuteReliabilityControllerTests: XCTestCase {
    private var models: [TrainViewModel] = []
    private let analytics = makeAnalytics(debug: true)
    private var rhodes: Station!
    private var townHall: Station!

    override func setUp() async throws {
        try await super.setUp()
        OfflineTransport.reset()
        let stations = try await DeviceStore(directory: temporaryDirectory()).stations()
        rhodes = try XCTUnwrap(stations.first { $0.id == "213820" })
        townHall = try XCTUnwrap(stations.first { $0.id == "200070" })
    }

    override func tearDown() async throws {
        for model in models { model.stopForTests() }
        models = []
        OfflineTransport.reset()
        try await super.tearDown()
    }

    func testTheOpenRefreshCannotEraseThePlatformEvidenceBeforeTheFixLands() async throws {
        let planner = OfflinePlanner()
        let boarded = try await firstDirect(planner, at: mondayMorning)
        let clock = TestClock(boarded.effectiveDeparture + 180_000)
        let seen = LastAnswer(tripId: "rt", reverse: false, at: boarded.effectiveDeparture - 120_000, stationId: rhodes.id,
                              board: BoardData(from: rhodes, to: townHall, journeys: [boarded], generatedAt: 0, offline: true),
                              journey: boarded)
        let location = ScriptedLocation()
        let (store, model) = try await model(UserData(trips: [commute], lastAnswer: seen), planner: planner, clock: clock, location: location)

        model.resume()
        try await refreshWritten(model, store)
        XCTAssertNotEqual(model.state.recommendation?.journey.key, boarded.key, "the open's refresh answers with a later train")
        let stored = await store.load().lastAnswer
        XCTAssertEqual(stored?.journey.key, boarded.key, "an unsighted record cannot replace the held one")
        XCTAssertEqual(stored?.stationId, rhodes.id)
        XCTAssertFalse(location.requests.isEmpty)
        XCTAssertTrue(location.requests.allSatisfy { $0 }, "the open asks for a precise fix while the snapshot's train is under way")

        model.receiveLocation(Fix(at: along(0.17), time: clock.now, speed: 14))

        XCTAssertEqual(model.state.focus?.journey.key, boarded.key)
        XCTAssertEqual(model.state.focus?.pinned, false)
        XCTAssertEqual(analytics.ledger.filter { $0.t == "entered_inferred" }.count, 1)
    }

    func testHomeLeftOpenThroughTheShownDepartureEntersFromTheHeldRecord() async throws {
        let planner = OfflinePlanner()
        let next = try await firstDirect(planner, at: mondayMorning)
        let clock = TestClock(next.effectiveDeparture - 60_000)
        let location = ScriptedLocation()
        let (store, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: location)
        model.resume()
        try await refreshWritten(model, store)

        model.receiveLocation(Fix(at: (rhodes.lat, rhodes.lon), time: clock.now, speed: 0))
        try await until { await store.load().lastAnswer?.stationId == self.rhodes.id }
        let shown = try XCTUnwrap(model.state.recommendation?.journey)
        let sighted = await store.load().lastAnswer
        XCTAssertEqual(sighted?.journey.key, shown.key)

        clock.now = shown.effectiveDeparture + 70_000
        model.tick()
        model.refresh()
        try await refreshWritten(model, store)
        XCTAssertNotEqual(model.state.recommendation?.journey.key, shown.key)
        let held = await store.load().lastAnswer
        XCTAssertEqual(held?.journey.key, shown.key, "a sighting from a fix taken before the train left cannot replace it")

        clock.now = shown.effectiveDeparture + 90_000
        model.tick()
        let asked = location.requests.count
        model.refreshTick()
        XCTAssertEqual(location.requests.count, asked + 1, "the tick takes a fix while the held record's train is under way")
        XCTAssertEqual(location.requests.last, true)
        XCTAssertFalse(model.state.refreshing, "the fix's handling replaces the tick's own refresh")

        model.receiveLocation(Fix(at: along(0.12), time: clock.now, speed: 14))

        XCTAssertEqual(model.state.focus?.journey.key, shown.key)
        XCTAssertEqual(model.state.focus?.pinned, false)
    }

    func testATickTakesAFixForFiveMinutesAfterTheTrainHomeShowedLeaves() async throws {
        let planner = OfflinePlanner()
        let next = try await firstDirect(planner, at: mondayMorning)
        let clock = TestClock(next.effectiveDeparture - 60_000)
        let location = ScriptedLocation()
        let (store, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: location)
        model.resume()
        try await refreshWritten(model, store)
        let shown = try XCTUnwrap(displayedHomeLead(model.state))
        try await Task.sleep(for: .milliseconds(100))
        let unsighted = await store.load().lastAnswer
        XCTAssertNil(unsighted?.stationId, "no fix has seen the rider at the platform")

        clock.now = shown.effectiveDeparture + 60_000
        model.tick()
        let asked = location.requests.count
        model.refreshTick()
        XCTAssertEqual(location.requests.count, asked + 1)
        XCTAssertEqual(location.requests.last, true)
        XCTAssertFalse(model.state.refreshing)

        clock.now = shown.effectiveDeparture + shownDepartureFixWindow + 1_000
        model.tick()
        model.refreshTick()
        XCTAssertEqual(location.requests.count, asked + 1, "five minutes on, the train is clear of the platform")
    }

    func testOfflineOnBoardEntryMatchesTheRunningTimetableService() async throws {
        let planner = OfflinePlanner()
        let riding = try await firstDirect(planner, at: mondayMorning)
        let halfway = riding.effectiveDeparture + (riding.effectiveArrival - riding.effectiveDeparture) / 2
        let clock = TestClock(halfway - 30_000)
        let (store, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: ScriptedLocation())
        model.resume()
        try await refreshWritten(model, store)

        model.receiveLocation(Fix(at: along(0.46), time: clock.now, speed: 14))
        XCTAssertNil(model.state.focus, "one fix with no heading cannot tell the direction")
        clock.now = halfway
        model.receiveLocation(Fix(at: along(0.5), time: clock.now, speed: 14))
        try await until(seconds: 30) { model.state.focus != nil }

        XCTAssertEqual(model.state.focus?.journey.key, riding.key)
        XCTAssertEqual(model.state.focus?.pinned, false)
        XCTAssertEqual(model.state.focus?.board.from.id, rhodes.id)
        XCTAssertEqual(analytics.ledger.filter { $0.t == "entered_inferred" }.count, 1)
        let lookback = iso(halfway - onBoardDefaultRide - onBoardLookbackMargin)
        XCTAssertTrue(OfflineTransport.requests().contains { $0.query?.contains("at=\(lookback)") == true },
                      "the running services are asked for online too, and that request fails")
    }

    func testTheEvidenceWaitHoldsOnceAVisitAndARestartCannotExtendIt() async throws {
        let now = mondayMorning
        let clock = TestClock(now)
        let journey = Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Town Hall", from: rhodes, to: townHall,
                                         departure: now - 2_400_000, arrival: now - 600_000)])
        let focus = FocusedJourney(tripId: "rt", reverse: false, journey: journey,
                                   board: BoardData(from: rhodes, to: townHall, journeys: [journey], generatedAt: now - 2_400_000),
                                   pinned: false, arrivalGuard: ArrivalGuard(armed: true, retainedAt: now - 300_000))
        let location = ScriptedLocation()
        let (store, model) = try await model(UserData(trips: [commute], focus: focus), clock: clock, location: location, network: false)

        model.resume()
        try await until { location.isMonitoring }
        model.tick()
        XCTAssertEqual(model.state.arrival?.state, .checkingArrival)

        clock.now = now + 44_000
        location.onPermission?(false, true)
        XCTAssertFalse(location.isMonitoring)
        model.tick()
        try await until { location.isMonitoring }
        XCTAssertEqual(model.state.arrival?.state, .checkingArrival)

        clock.now = now + 46_000
        model.tick()
        XCTAssertEqual(model.state.arrival?.state, .arrived, "a restart within the visit does not extend the wait")
        XCTAssertEqual(model.state.arrival?.basis, .estimate)
        try await until { await store.load().rides.count == 1 }
    }

    func testTheFirstPastPageAsksFromHalfAnHourAgoAndMergesTheTimetable() async throws {
        let planner = OfflinePlanner()
        let clock = TestClock(mondayMorning + 600_000)
        try await planner.initialize()
        let anchor = clock.now - firstPastPageLookback
        let planned = try await planner.plan(from: rhodes, to: townHall, at: anchor, modes: allModes, limit: timetablePageLimit, maxTransfers: 2)
            .journeys.filter { $0.effectiveDeparture < clock.now - 900_000 }
        XCTAssertGreaterThanOrEqual(planned.count, 2)
        var online = planned[0]
        online.legs[0].estimatedDeparture = online.legs[0].departure + 120_000
        online.legs[0].fromPlatform = "9"
        let onlineOnly = Journey(legs: [Leg(line: "T9X", mode: "train", headsign: "Town Hall", from: rhodes, to: townHall,
                                            departure: anchor + 60_000, arrival: anchor + 1_500_000)])
        OfflineTransport.setPast(departures([online, onlineOnly], generatedAt: clock.now))
        let (_, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: ScriptedLocation())
        model.resume()
        model.openTrip(id: commute.id)
        try await until { model.state.board != nil && !model.state.refreshing }

        model.earlier()
        try await until { !model.state.earlierLoading }
        let first = try XCTUnwrap(OfflineTransport.requests().last { $0.query?.contains("at=") == true })
        XCTAssertTrue(first.query?.contains("at=\(iso(anchor))") == true, first.absoluteString)
        XCTAssertTrue(first.query?.contains("limit=\(firstPastPageLimit)") == true, first.absoluteString)
        let rows = try XCTUnwrap(model.state.board?.journeys)
        XCTAssertEqual(rows.first { $0.key == online.key }?.legs[0].estimatedDeparture, online.legs[0].estimatedDeparture,
                       "the online row wins by journey key")
        XCTAssertTrue(rows.contains { $0.key == onlineOnly.key })
        XCTAssertTrue(rows.contains { $0.key == planned[1].key }, "a timetable-only past row joins the page")

        let earliest = try XCTUnwrap(rows.map(\.departure).min())
        model.earlier()
        try await until { !model.state.earlierLoading }
        let later = try XCTUnwrap(OfflineTransport.requests().last { $0.query?.contains("at=") == true })
        XCTAssertNotEqual(later, first)
        XCTAssertTrue(later.query?.contains("at=\(iso(earliest - pastPageStep))") == true, later.absoluteString)
    }

    func testAPastPageFallsBackToWhicheverSourceAnswered() {
        let leg = { (line: String, minutes: Double) in
            Leg(line: line, mode: "train", headsign: "B", from: Station(id: "a", name: "A"), to: Station(id: "b", name: "B"),
                departure: minutes * 60_000, arrival: minutes * 60_000 + 600_000)
        }
        let shared = Journey(legs: [leg("T1", 10)])
        var live = shared
        live.legs[0].estimatedDeparture = 11 * 60_000
        let timetable = BoardData(from: Station(id: "a", name: "A"), to: Station(id: "b", name: "B"),
                                  journeys: [Journey(legs: [leg("T1", 20)]), shared], generatedAt: 1, offline: true)
        var online = timetable
        online.journeys = [live]
        online.offline = false
        let merged = mergedPage(online: online, timetable: timetable)
        XCTAssertEqual(merged?.journeys.map(\.key), [shared.key, Journey(legs: [leg("T1", 20)]).key])
        XCTAssertEqual(merged?.journeys.first?.legs[0].estimatedDeparture, 11 * 60_000)
        XCTAssertEqual(merged?.offline, false)
        XCTAssertEqual(mergedPage(online: nil, timetable: timetable)?.journeys.count, 2)
        XCTAssertEqual(mergedPage(online: online, timetable: nil)?.journeys, [live])
        XCTAssertNil(mergedPage(online: nil, timetable: nil))
    }

    private var commute: SavedTrip { SavedTrip(id: "rt", from: rhodes, to: townHall) }

    /// A weekday morning inside the bundled timetable's coverage.
    private var mondayMorning: Millis {
        ISO8601DateFormatter().date(from: "2026-09-07T08:00:00+10:00")!.timeIntervalSince1970 * 1_000
    }

    private func along(_ fraction: Double) -> (Double, Double) {
        (rhodes.lat + (townHall.lat - rhodes.lat) * fraction, rhodes.lon + (townHall.lon - rhodes.lon) * fraction)
    }

    private func firstDirect(_ planner: OfflinePlanner, at: Millis) async throws -> Journey {
        try await planner.initialize()
        let board = try await planner.plan(from: rhodes, to: townHall, at: at, modes: ["train"], limit: timetablePageLimit, maxTransfers: 2)
        return try XCTUnwrap(board.journeys.first { $0.legs.count == 1 && !$0.cancelled && $0.effectiveDeparture >= at })
    }

    private func model(
        _ data: UserData,
        planner: OfflinePlanner = OfflinePlanner(),
        clock: TestClock,
        location: ScriptedLocation,
        network: Bool = true
    ) async throws -> (DeviceStore, TrainViewModel) {
        let store = DeviceStore(directory: temporaryDirectory())
        try await store.save(data)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OfflineTransport.self]
        var api = TransitAPI()
        api.baseURL = "http://offline.invalid"
        api.session = URLSession(configuration: configuration)
        let tracker = TravelTrackerController(store: TravelTrackerSessionFileStore(directory: temporaryDirectory()), driver: QuietActivities())
        let model = TrainViewModel(store: store, api: api, planner: planner, tracker: tracker, location: location,
                                   keepalive: StoppedKeepalive(), analytics: analytics, clock: { clock.now })
        models.append(model)
        model.networkDisabled = !network
        try await until { model.state.ready }
        return (store, model)
    }

    /// The refresh writes `lastAnswer` after it caches its board; an unchanged record is never saved, so wait past both.
    private func refreshWritten(_ model: TrainViewModel, _ store: DeviceStore) async throws {
        try await until { !model.state.refreshing && model.state.recommendation != nil }
        try await until { await store.cached(from: self.rhodes, to: self.townHall, modes: allModes) != nil }
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

    private func iso(_ time: Millis) -> String {
        ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: time / 1_000))
            .addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed.subtracting(CharacterSet(charactersIn: "+"))) ?? ""
    }

    private func departures(_ journeys: [Journey], generatedAt: Millis) -> Data {
        let format = ISO8601DateFormatter()
        let time: (Millis) -> String = { format.string(from: Date(timeIntervalSince1970: $0 / 1_000)) }
        let stop: (Station) -> [String: Any] = { ["id": $0.id, "name": $0.name] }
        let rows = journeys.map { journey -> [String: Any] in
            ["legDetail": journey.legs.map { leg -> [String: Any] in
                var departure: [String: Any] = ["scheduled": time(leg.departure)]
                var arrival: [String: Any] = ["scheduled": time(leg.arrival)]
                if let estimate = leg.estimatedDeparture { departure["estimated"] = time(estimate) }
                if let estimate = leg.estimatedArrival { arrival["estimated"] = time(estimate) }
                var from = stop(leg.from)
                from["platform"] = leg.fromPlatform
                return ["line": ["name": leg.line, "mode": leg.mode], "headsign": leg.headsign, "from": from,
                        "to": stop(leg.to), "departure": departure, "arrival": arrival, "cancelled": leg.cancelled]
            }]
        }
        return try! JSONSerialization.data(withJSONObject: [
            "from": stop(rhodes), "to": stop(townHall), "generatedAt": time(generatedAt), "journeys": rows
        ])
    }
}

private extension Fix {
    init(at point: (Double, Double), time: Millis, speed: Double) {
        self.init(lat: point.0, lon: point.1, at: time, speed: speed, accuracyMetres: 10)
    }
}

private final class TestClock {
    var now: Millis
    init(_ now: Millis) { self.now = now }
}

private final class ScriptedLocation: LocationProviding {
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
private final class StoppedKeepalive: TrackerKeepaliveDriving {
    var isRunning: Bool { false }
    func start() -> Bool { false }
    func stop() {}
}

private struct QuietActivities: TravelTrackerActivityDriving {
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

/// No connection: every request fails, except a past page when a test supplies one.
private final class OfflineTransport: URLProtocol {
    private static let lock = NSLock()
    private static var seen: [URL] = []
    private static var past: Data?

    static func reset() { lock.withLock { seen = []; past = nil } }
    static func setPast(_ body: Data) { lock.withLock { past = body } }
    static func requests() -> [URL] { lock.withLock { seen } }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let url = request.url!
        let body: Data? = Self.lock.withLock {
            Self.seen.append(url)
            return url.path.contains("departures") && url.query?.contains("at=") == true ? Self.past : nil
        }
        guard let body else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: url, statusCode: 200, httpVersion: nil, headerFields: nil)!,
                            cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
}
