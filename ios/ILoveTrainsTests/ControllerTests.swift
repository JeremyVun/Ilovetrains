import XCTest
@testable import ILoveTrains

@MainActor
final class ControllerTests: XCTestCase {
    func testSettingsLocationPresentationCoversEachPermissionAction() {
        assertLocationPresentation(useLocation: false, granted: false, denied: false,
                                   subtitle: "Location is not used", mark: "TURN ON",
                                   action: .turnOn, warning: false, selected: false)
        assertLocationPresentation(useLocation: true, granted: false, denied: false,
                                   subtitle: "Location needs permission", mark: "ALLOW",
                                   action: .allow, warning: false, selected: nil)
        assertLocationPresentation(useLocation: true, granted: false, denied: true,
                                   subtitle: "Location is blocked", mark: "OPEN SETTINGS ›",
                                   action: .openSettings, warning: true, selected: nil)
        assertLocationPresentation(useLocation: true, granted: true, denied: false,
                                   subtitle: "Nearby trips use location", mark: "TURN OFF",
                                   action: .turnOff, warning: false, selected: true)
    }

    func testSettingsTransferLimitPresentationOffersTheOtherValue() {
        let capped = SettingsTransferLimitPresentation(limit: .two)
        XCTAssertEqual(capped.subtitle, "Up to 2")
        XCTAssertEqual(capped.mark, "NO LIMIT")
        XCTAssertEqual(capped.next, .any)

        let uncapped = SettingsTransferLimitPresentation(limit: .any)
        XCTAssertEqual(uncapped.subtitle, "No limit")
        XCTAssertEqual(uncapped.mark, "UP TO 2")
        XCTAssertEqual(uncapped.next, .two)
    }

    func testCappedBoardHidesCachedThreeChangeRowsUntilTheLimitIsLifted() async throws {
        let now = epochNow()
        let from = Station(id: "a", name: "A")
        let to = Station(id: "b", name: "B")
        let direct = Journey(legs: [leg("T1", from: from, to: to, departure: now + 600_000, arrival: now + 1_800_000)])
        let changes = (1...3).map { Station(id: "c\($0)", name: "Change \($0)") }
        let stops: [(Station, Station)] = [(from, changes[0]), (changes[0], changes[1]), (changes[1], changes[2]), (changes[2], to)]
        let threeChange = Journey(legs: stops.enumerated().map { index, pair in
            let departure: Millis = now + 300_000 * Double(index + 1)
            return leg("T\(index + 2)", from: pair.0, to: pair.1, departure: departure, arrival: departure + 240_000)
        })
        let board = BoardData(from: from, to: to, journeys: [direct, threeChange], generatedAt: now, source: "schedule", offline: true)
        let data = UserData(trips: [SavedTrip(id: "trip", from: from, to: to, createdAt: now)], lastTripId: "trip",
                            transferLimit: .two, flags: ["transferLimit": true])
        let (_, model) = try await model(data: data, undoWindow: defaultUndoWindow, cached: board)
        model.resume()

        try await settledBoard(model) { Set($0.map(\.key)) == [direct.key] }

        model.setTransferLimit(.any)
        try await settledBoard(model) { Set($0.map(\.key)) == [direct.key, threeChange.key] }

        model.setTransferLimit(.two)
        try await settledBoard(model) { Set($0.map(\.key)) == [direct.key] }
        model.pause()
    }

    func testOpeningAlternativeKeepsItsOwnSourceAndTheOriginalPin() async throws {
        let fixture = makeFocus()
        let (_, model) = try await model(data: fixture.0)
        XCTAssertEqual(model.state.screen, .home)
        XCTAssertEqual(model.state.focus?.alternatives?.source, "schedule", "Alternative source survived storage")
        XCTAssertEqual(model.state.focus?.alternatives?.journeys.first?.key, fixture.1.key, "Alternative identity survived storage")
        model.openJourney(fixture.1)
        XCTAssertEqual(model.state.screen, .detail)
        XCTAssertEqual(model.state.board?.source, "schedule")
        XCTAssertEqual(model.state.board?.generatedAt, 100)
        XCTAssertEqual(model.state.detail?.key, fixture.1.key)
        XCTAssertEqual(model.state.focus?.journey.key, fixture.0.focus?.journey.key)
        model.pause()
    }

    func testHidingThenRestoringModesRetainsFocusedJourney() async throws {
        let fixture = makeFocus()
        let (_, model) = try await model(data: fixture.0)
        model.setMode(mode: "train", enabled: false)
        model.setMode(mode: "metro", enabled: false)
        model.setMode(mode: "ferry", enabled: false)
        XCTAssertNil(model.state.focus)
        XCTAssertTrue(model.state.trips.isEmpty)
        XCTAssertEqual(model.state.totalTrips, 1)
        model.setMode(mode: "train", enabled: true)
        XCTAssertEqual(model.state.focus?.journey.key, fixture.0.focus?.journey.key)
        XCTAssertEqual(model.state.trips.count, 1)
        model.pause()
    }

    func testTenTripLRUEvictsUnviewedOldestAndPreservesRides() async throws {
        let a = Station(id: "a", name: "A")
        let trips = (0..<10).map { SavedTrip(id: "trip-\($0)", from: a, to: Station(id: "stop-\($0)", name: "Stop \($0)"), createdAt: Double($0 + 1), lastViewed: $0 == 0 ? epochNow() : 0) }
        let (_, model) = try await model(data: UserData(trips: trips))
        model.saveTrip(from: a, to: Station(id: "new", name: "New"))
        XCTAssertEqual(model.state.totalTrips, 10)
        XCTAssertTrue(model.state.trips.contains { $0.id == "trip-0" })
        XCTAssertFalse(model.state.trips.contains { $0.id == "trip-1" })
        XCTAssertTrue(model.state.trips.contains { $0.to.id == "new" })
        model.pause()
    }

    func testFreshLocationNewerThanLastRenderTickIsAccepted() async throws {
        let (_, model) = try await model(data: UserData())
        let townHall = try XCTUnwrap(model.state.stations.first { $0.id == "200070" })
        model.resume()
        let renderTick = model.state.now
        try await Task.sleep(for: .milliseconds(20))
        let observedAt = epochNow()
        XCTAssertGreaterThan(observedAt, renderTick)

        model.receiveLocation(Fix(lat: townHall.lat, lon: townHall.lon, at: observedAt))

        XCTAssertEqual(model.state.setupFrom?.id, townHall.id)
        XCTAssertGreaterThanOrEqual(model.state.now, observedAt)
        model.pause()
    }

    func testSwipeDeleteThenUndoRestoresTripHistoryAndFocus() async throws {
        let fixture = makeFocus()
        let a = Station(id: "200060", name: "Central Station"), c = Station(id: "213820", name: "Rhodes Station")
        var data = fixture.0
        data.trips.append(SavedTrip(id: "other", from: a, to: c, createdAt: epochNow() - 1))
        data.history = [ViewEvent(tripId: "trip", reverse: false, at: epochNow() - 60_000), ViewEvent(tripId: "other", reverse: true, at: epochNow() - 30_000)]
        data.lastTripId = "trip"
        let (store, model) = try await model(data: data)

        model.deleteTrip(id: "trip")
        XCTAssertEqual(model.state.trips.map(\.id), ["other"])
        XCTAssertNil(model.state.focus)
        XCTAssertEqual(model.state.message, "Central → Parramatta deleted")
        XCTAssertTrue(model.state.undoAvailable)
        try await settled(store) { $0.trips.map(\.id) == ["other"] && $0.history.map(\.tripId) == ["other"] && $0.focus == nil && $0.lastTripId == nil }

        model.undoDelete()
        XCTAssertEqual(model.state.trips.first?.id, "trip")
        XCTAssertEqual(model.state.focus?.tripId, "trip")
        XCTAssertNil(model.state.message)
        XCTAssertFalse(model.state.undoAvailable)
        try await settled(store) { $0.trips.map(\.id) == ["trip", "other"] && $0.history.map(\.tripId) == ["other", "trip"] && $0.focus?.tripId == "trip" && $0.lastTripId == "trip" }
        model.pause()
    }

    func testUndoWindowExpiryPurgesCacheAndClearsBar() async throws {
        let fixture = makeFocus()
        let trip = fixture.0.trips[0]
        let (store, model) = try await model(data: fixture.0, undoWindow: .milliseconds(50))
        try await store.cache(fixture.0.focus!.board, modes: allModes)
        let cached = { await store.cached(from: trip.from, to: trip.to, modes: allModes) != nil }
        var present = await cached()
        XCTAssertTrue(present)

        model.deleteTrip(id: trip.id)
        XCTAssertTrue(model.state.undoAvailable)
        present = await cached()
        XCTAssertTrue(present, "Purge waits for the window")
        for _ in 0..<100 where model.state.message != nil { try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertNil(model.state.message)
        XCTAssertFalse(model.state.undoAvailable)
        for _ in 0..<100 { present = await cached(); if !present { break }; try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertFalse(present)
        model.undoDelete()
        XCTAssertTrue(model.state.trips.isEmpty, "Nothing to undo after expiry")
        model.pause()
    }

    func testSecondDeletionCommitsTheFirst() async throws {
        let a = Station(id: "200060", name: "Central Station"), b = Station(id: "215020", name: "Parramatta Station"), c = Station(id: "213820", name: "Rhodes Station")
        let first = SavedTrip(id: "first", from: a, to: b, createdAt: 1), second = SavedTrip(id: "second", from: a, to: c, createdAt: 2)
        let (store, model) = try await model(data: UserData(trips: [first, second]))
        try await store.cache(BoardData(from: a, to: b, journeys: [], generatedAt: 1), modes: allModes)
        try await store.cache(BoardData(from: a, to: c, journeys: [], generatedAt: 1), modes: allModes)

        model.deleteTrip(id: "first")
        model.deleteTrip(id: "second")
        XCTAssertEqual(model.state.message, "Central → Rhodes deleted")
        var firstCached = true
        for _ in 0..<100 { firstCached = await store.cached(from: a, to: b, modes: allModes) != nil; if !firstCached { break }; try await Task.sleep(for: .milliseconds(10)) }
        XCTAssertFalse(firstCached, "The first deletion is committed at once")
        let secondCached = await store.cached(from: a, to: c, modes: allModes) != nil
        XCTAssertTrue(secondCached)

        model.undoDelete()
        XCTAssertEqual(model.state.trips.map(\.id), ["second"])
        XCTAssertNil(model.state.message)
        model.pause()
    }

    private func settledBoard(_ model: TrainViewModel, _ check: ([Journey]) -> Bool) async throws {
        for _ in 0..<500 {
            if check(model.state.board?.journeys ?? []) { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Board did not settle, showing \(model.state.board?.journeys.map(\.key) ?? [])")
    }

    private func leg(_ line: String, from: Station, to: Station, departure: Millis, arrival: Millis) -> Leg {
        Leg(line: line, mode: "train", headsign: to.name, from: from, to: to, departure: departure, arrival: arrival)
    }

    private func settled(_ store: DeviceStore, _ check: @escaping (UserData) -> Bool) async throws {
        for _ in 0..<200 {
            if check(await store.load()) { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Persisted state did not settle")
    }

    private func assertLocationPresentation(useLocation: Bool, granted: Bool, denied: Bool,
                                            subtitle: String, mark: String, action: SettingsLocationAction,
                                            warning: Bool, selected: Bool?) {
        let presentation = SettingsLocationPresentation(useLocation: useLocation, granted: granted, denied: denied)
        XCTAssertEqual(presentation.subtitle, subtitle)
        XCTAssertEqual(presentation.mark, mark)
        XCTAssertEqual(presentation.action, action)
        XCTAssertEqual(presentation.warning, warning)
        XCTAssertEqual(presentation.selected, selected)
    }

    private func model(data: UserData, undoWindow: Duration, cached: BoardData? = nil) async throws -> (DeviceStore, TrainViewModel) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = DeviceStore(directory: directory)
        if let cached { try await store.cache(cached, modes: data.modes) }
        try await store.save(data)
        let model = TrainViewModel(store: store, undoWindow: undoWindow)
        model.networkDisabled = true
        for _ in 0..<200 {
            if model.state.ready { return (store, model) }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Controller did not load saved state")
        return (store, model)
    }

    private func model(data: UserData) async throws -> (DeviceStore, TrainViewModel) {
        try await model(data: data, undoWindow: defaultUndoWindow)
    }

    private func makeFocus() -> (UserData, Journey) {
        let now = epochNow()
        let a = Station(id: "200060", name: "Central Station")
        let b = Station(id: "215020", name: "Parramatta Station")
        let original = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "Parramatta", from: a, to: b, departure: now + 300_000, arrival: now + 2_100_000, estimatedDeparture: now + 300_000, estimatedArrival: now + 2_100_000)])
        let next = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "Parramatta", from: a, to: b, departure: now + 900_000, arrival: now + 2_700_000)])
        let observed = BoardData(from: a, to: b, journeys: [original], generatedAt: now, source: "live")
        let scheduled = BoardData(from: a, to: b, journeys: [next], generatedAt: 100, source: "schedule", offline: true)
        let trip = SavedTrip(id: "trip", from: a, to: b, createdAt: now)
        return (UserData(trips: [trip], focus: FocusedJourney(tripId: trip.id, reverse: false, journey: original, board: observed, alternatives: scheduled)), next)
    }

}
