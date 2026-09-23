import XCTest
@testable import ILoveTrains

@MainActor
final class MetricsControllerTests: XCTestCase {
    private let analytics = makeAnalytics(debug: true)
    private var names: [String] { analytics.ledger.map(\.t) }

    func testForegroundEntriesCountOpensAndAnInactiveReturnKeepsTheOpen() async throws {
        var data = UserData(trips: [SavedTrip(id: "trip", from: Station(id: "m-a", name: "A"), to: Station(id: "m-b", name: "B"))])
        data.useLocation = false
        let model = try await model(data)
        model.resume()
        defer { model.pause() }
        try await until { self.names == ["opened", "shown_predicted"] }
        XCTAssertEqual(analytics.ledger[0].d, iosDims("1", ["m": "1"]))

        model.resume()
        try await Task.sleep(for: .milliseconds(1_200))
        XCTAssertEqual(names, ["opened", "shown_predicted"], "an inactive scene returning, and each tick, stay in the same open")

        model.pause()
        model.resume()
        try await until { self.names.count == 3 }
        XCTAssertEqual(analytics.ledger[2], AnalyticsEvent(t: "shown_predicted", d: iosDims("2-5")))
        model.openTrip(id: "trip")
        XCTAssertEqual(analytics.ledger.last, AnalyticsEvent(t: "hit_predicted", d: iosDims("2-5")))
        model.back()
        model.resume()
        model.openTrip(id: "trip")
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(names, ["opened", "shown_predicted", "shown_predicted", "hit_predicted"],
                       "browsing the tapped trip is no exposure and a second tap is not classified")
    }

    func testATripSavedHomeFromHereIsThePairAnswerForTheRestOfThatOpen() async throws {
        let central = Station(id: "200060", name: "Central Station", lat: -33.8832, lon: 151.2067, modes: ["train"])
        let parramatta = Station(id: "215020", name: "Parramatta Station", lat: -33.8173, lon: 151.0053, modes: ["train"])
        let townHall = Station(id: "200070", name: "Town Hall Station", lat: -33.8736, lon: 151.2069, modes: ["train"])
        let model = try await model(UserData(trips: [SavedTrip(id: "existing", from: central, to: parramatta)]))
        model.resume()
        defer { model.pause() }
        try await until { self.names == ["opened", "shown_predicted"] }

        model.receiveLocation(Fix(lat: townHall.lat, lon: townHall.lon, at: epochNow()))
        let added = try XCTUnwrap(model.state.justAddedTripId)
        XCTAssertEqual(model.state.selectedTripId, added)
        try await until { self.names.last == "shown_pair" }
        model.receiveLocation(Fix(lat: townHall.lat, lon: townHall.lon, at: epochNow()))
        try await Task.sleep(for: .milliseconds(100))
        XCTAssertEqual(names, ["opened", "shown_predicted", "shown_pair"], "the pair stays the answer for this open")

        model.pause()
        model.resume()
        model.receiveLocation(Fix(lat: townHall.lat, lon: townHall.lon, at: epochNow()))
        XCTAssertEqual(model.state.selectedTripId, added)
        try await until { self.names.last == "shown_home" }
        model.openTrip(id: added)
        XCTAssertEqual(names.last, "hit_home", "a new open counts the saved trip as an ordinary homeward answer")
    }

    func testAPinComparesWithTheAnswerHomeLastShowedNotWhatHomeWouldShowNow() async throws {
        let a = Station(id: "m-a", name: "A"), b = Station(id: "m-b", name: "B")
        let now = epochNow()
        let first = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: a, to: b, departure: now + 600_000, arrival: now + 1_800_000)])
        let second = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: a, to: b, departure: now + 1_200_000, arrival: now + 2_400_000)])
        let board = BoardData(from: a, to: b, journeys: [first, second], generatedAt: now, source: "live")
        var data = UserData(trips: [SavedTrip(id: "trip", from: a, to: b)])
        data.useLocation = false
        let model = try await model(data, cached: [board])
        model.resume()
        defer { model.pause() }
        try await until { self.names == ["opened", "shown_predicted"] }
        try await quiet(model)
        XCTAssertEqual(displayedHomeLead(model.state)?.key, first.key)

        model.openTrip(id: "trip")
        let shown = try XCTUnwrap(model.state.board)
        model.state.recommendation = JourneyRecommendation(journey: second, board: shown)
        XCTAssertEqual(displayedHomeLead(model.state)?.key, second.key, "Home would now lead with the later service")
        model.openJourney(second)
        model.pinJourney(second)
        XCTAssertEqual(Array(analytics.ledger.suffix(3)), [
            AnalyticsEvent(t: "hit_predicted", d: iosDims("1")),
            AnalyticsEvent(t: "hit_predicted", d: iosDims("1")),
            AnalyticsEvent(t: "pinned_predicted", d: iosDims("1", ["r": "service", "pl.r": "ios.service"]))
        ])

        try await until { self.names.last == "shown_focus" }
        model.unpinJourney()
        try await until { self.names.last == "shown_predicted" }
        try await quiet(model)
        let lead = try XCTUnwrap(displayedHomeLead(model.state))
        model.openJourney(lead)
        model.pinJourney(lead)
        XCTAssertEqual(Array(analytics.ledger.suffix(2)), [
            AnalyticsEvent(t: "hit_predicted", d: iosDims("1")),
            AnalyticsEvent(t: "pinned_predicted", d: iosDims("1", ["r": "same", "pl.r": "ios.same"]))
        ])
        model.unpinJourney()
        XCTAssertEqual(names.filter { $0.hasPrefix("pinned_") }.count, 2, "unpinning emits nothing")
    }

    func testArrivalCountsANewRideOnceByHowTravelStarted() async throws {
        let pinned = try await model(departed(pinned: true))
        pinned.resume()
        try await until { self.names.contains("rode_pin") }
        try await Task.sleep(for: .milliseconds(2_200))
        pinned.pause()
        XCTAssertEqual(analytics.ledger.filter { $0.t.hasPrefix("rode_") },
                       [AnalyticsEvent(t: "rode_pin", d: iosDims("1", ["b": "estimate", "pl.b": "ios.estimate"]))],
                       "later settlements correct the ride without counting it again")

        let inferred = try await model(departed(pinned: false))
        inferred.resume()
        try await until { self.names.contains("rode_auto") }
        inferred.pause()
        XCTAssertEqual(analytics.ledger.filter { $0.t == "rode_auto" }.map { $0.d["b"] }, ["estimate"])
    }

    func testCorrectingAnExistingRideCountsNothing() async throws {
        var data = departed(pinned: true)
        let focus = try XCTUnwrap(data.focus)
        data.rides = [Ride(tripId: focus.tripId, reverse: false, departure: focus.journey.departure, arrival: focus.journey.arrival - 60_000)]
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = DeviceStore(directory: directory)
        let model = try await model(data, store: store)
        model.resume()
        defer { model.pause() }
        var corrected = await store.load().rides
        for _ in 0..<300 where corrected.first?.arrival != focus.journey.arrival {
            try await Task.sleep(for: .milliseconds(10))
            corrected = await store.load().rides
        }
        XCTAssertEqual(corrected.map(\.arrival), [focus.journey.arrival], "the settlement corrected the ride")
        try await Task.sleep(for: .milliseconds(1_200))
        XCTAssertFalse(names.contains { $0.hasPrefix("rode_") })
    }

    private func departed(pinned: Bool) -> UserData {
        let now = (epochNow() / 1_000).rounded() * 1_000
        let a = Station(id: "m-a", name: "A"), b = Station(id: "m-b", name: "B")
        let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: a, to: b, departure: now - 1_500_000, arrival: now - 120_000)])
        let trip = SavedTrip(id: "trip", from: a, to: b, createdAt: now - 1_500_000)
        let focus = FocusedJourney(tripId: trip.id, reverse: false, journey: journey,
                                   board: BoardData(from: a, to: b, journeys: [journey], generatedAt: now - 1_500_000, source: "live"),
                                   pinned: pinned)
        var data = UserData(trips: [trip], focus: focus)
        data.useLocation = false
        return data
    }

    private func model(_ data: UserData, cached: [BoardData] = [], store: DeviceStore? = nil) async throws -> TrainViewModel {
        let store = store ?? DeviceStore(directory: FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString))
        for board in cached { try await store.cache(board, modes: data.modes) }
        try await store.save(data)
        let model = TrainViewModel(store: store, location: QuietLocation(), keepalive: IdleKeepalive(), analytics: analytics)
        model.networkDisabled = true
        try await until { model.state.ready }
        return model
    }

    private func until(_ condition: () -> Bool, seconds: Int = 5, file: StaticString = #filePath, line: UInt = #line) async throws {
        for _ in 0..<(seconds * 100) where !condition() { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertTrue(condition(), "never reached; ledger \(names)", file: file, line: line)
    }

    /// Lets the board request finish and Home settle, so the answer Home last showed is the one read here.
    private func quiet(_ model: TrainViewModel) async throws {
        try await until({ !model.state.refreshing }, seconds: 60)
        try await Task.sleep(for: .milliseconds(200))
    }
}

private final class QuietLocation: LocationProviding {
    var onPermission: ((Bool, Bool) -> Void)?
    var onFix: ((Fix) -> Void)?
    var onFailure: ((SetupLocationStatus) -> Void)?
    var isMonitoring = false
    func refreshPermission() { onPermission?(true, false) }
    func openSettings() {}
    func request(prompt: Bool) {}
    func monitoringPermitted() async -> Bool { false }
    func startMonitoring() -> Bool { false }
    func stop() {}
}

private final class IdleKeepalive: TrackerKeepaliveDriving {
    var isRunning: Bool { false }
    func start() -> Bool { false }
    func stop() {}
}
