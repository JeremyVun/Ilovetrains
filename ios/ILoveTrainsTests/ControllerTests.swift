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
        let history = [ViewEvent(tripId: "trip-0", reverse: false, at: epochNow())]
        let (_, model) = try await model(data: UserData(trips: trips, history: history))
        model.saveTrip(from: a, to: Station(id: "new", name: "New"))
        XCTAssertEqual(model.state.totalTrips, 10)
        XCTAssertTrue(model.state.trips.contains { $0.id == "trip-0" })
        XCTAssertFalse(model.state.trips.contains { $0.id == "trip-1" })
        XCTAssertTrue(model.state.trips.contains { $0.to.id == "new" })
        model.pause()
    }

    func testOpeningAnotherTripPreservesShownAnswerEvidence() async throws {
        let now = epochNow()
        let a = Station(id: "a", name: "A")
        let b = Station(id: "b", name: "B")
        let c = Station(id: "c", name: "C")
        let first = SavedTrip(id: "first", from: a, to: b)
        let second = SavedTrip(id: "second", from: a, to: c)
        let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: a, to: b, departure: now + 60_000, arrival: now + 600_000)])
        let board = BoardData(from: a, to: b, journeys: [journey], generatedAt: now, source: "live")
        let answer = LastAnswer(tripId: first.id, reverse: false, at: now, stationId: a.id, board: board, journey: journey)
        let (store, model) = try await model(data: UserData(trips: [first, second], lastAnswer: answer))

        model.openTrip(id: second.id)

        let restored = await store.load()
        XCTAssertEqual(restored.lastAnswer, answer)
        model.pause()
    }

    func testLateLocationCannotRefillClearedSetupOrigin() async throws {
        let (_, model) = try await model(data: UserData())
        let central = try XCTUnwrap(model.state.stations.first { $0.id == "200060" })
        let townHall = try XCTUnwrap(model.state.stations.first { $0.id == "200070" })
        model.resume()
        model.chooseSetupFrom(central)
        model.clearSetupFrom()

        model.receiveLocation(Fix(lat: townHall.lat, lon: townHall.lon, at: epochNow()))

        XCTAssertNil(model.state.setupFrom)
        XCTAssertEqual(model.state.nearestStation?.id, townHall.id)
        model.pause()
    }

    func testArrivalCompletionUsesTheSavedDirectionalEndpoint() async throws {
        let now = epochNow()
        let savedFrom = Station(id: "from", name: "From", lat: -33.884, lon: 151.206)
        let savedTo = Station(id: "to", name: "To", lat: -33.8173, lon: 151.0053)
        let wireFrom = Station(id: "from", name: "From")
        let wireTo = Station(id: "to", name: "To")
        let trip = SavedTrip(id: "trip", from: savedFrom, to: savedTo)
        let journey = Journey(legs: [Leg(
            line: "T1", mode: "train", headsign: "To", from: wireFrom, to: wireTo,
            departure: now - 600_000, arrival: now + 240_000
        )])
        let board = BoardData(from: savedFrom, to: savedTo, journeys: [journey], generatedAt: now, source: "live")
        let focus = FocusedJourney(tripId: trip.id, reverse: false, journey: journey, board: board, pinned: false)
        let (store, model) = try await model(data: UserData(trips: [trip], focus: focus))
        model.resume()

        model.receiveLocation(Fix(lat: savedTo.lat, lon: savedTo.lon, at: epochNow()))

        XCTAssertTrue(model.state.focusComplete)
        try await settled(store) { $0.rides.count == 1 }
        let restored = await store.load()
        let ride = try XCTUnwrap(restored.rides.first)
        XCTAssertEqual(ride.from, savedFrom)
        XCTAssertEqual(ride.to, savedTo)
        model.pause()
    }

    func testAutoCreatedPairIsMarkedJustAddedUntilNextResume() async throws {
        let central = Station(id: "200060", name: "Central Station", lat: -33.8832, lon: 151.2067, modes: ["train"])
        let parramatta = Station(id: "215020", name: "Parramatta Station", lat: -33.8173, lon: 151.0053, modes: ["train"])
        let townHall = Station(id: "200070", name: "Town Hall Station", lat: -33.8736, lon: 151.2069, modes: ["train"])
        let (_, model) = try await model(data: UserData(trips: [SavedTrip(id: "existing", from: central, to: parramatta)]))
        model.resume()

        model.receiveLocation(Fix(lat: townHall.lat, lon: townHall.lon, at: epochNow()))

        let added = try XCTUnwrap(model.state.justAddedTripId)
        XCTAssertEqual(model.state.selectedTripId, added)
        XCTAssertTrue(model.state.selectionPredicted)
        XCTAssertNil(model.state.focus)
        model.pause()
        model.resume()
        XCTAssertNil(model.state.justAddedTripId)
        model.pause()
    }

    func testIncompatiblePairCanBeSavedAndStaysHiddenUntilEnabled() async throws {
        let from = Station(id: "wharf-a", name: "Wharf A", modes: ["ferry"])
        let to = Station(id: "wharf-b", name: "Wharf B", modes: ["ferry"])
        let (store, model) = try await model(data: UserData(modes: ["train"]))

        model.saveTrip(from: from, to: to)

        XCTAssertEqual(model.state.totalTrips, 1)
        XCTAssertTrue(model.state.trips.isEmpty)
        XCTAssertNil(model.state.selectedTripId)
        XCTAssertNil(model.state.board)
        try await settled(store) { $0.trips.count == 1 }
        let restored = await store.load()
        XCTAssertEqual(restored.trips.count, 1)
        model.setMode(mode: "ferry", enabled: true)
        XCTAssertEqual(model.state.trips.count, 1)
        model.pause()
    }

    func testRedirectMatchesFirstLineAndScheduledDepartureOnly() {
        let from = Station(id: "a", name: "A")
        let to = Station(id: "b", name: "B")
        let original = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: from, to: to, departure: 10_000, arrival: 20_000)])
        let sameDepartureWrongLine = Journey(legs: [Leg(line: "T2", mode: "train", headsign: "B", from: from, to: to, departure: 10_000, arrival: 20_000)])
        let delayedMatch = Journey(legs: [Leg(
            line: "T1", mode: "train", headsign: "B", from: from, to: to,
            departure: 10_000, arrival: 20_000, estimatedDeparture: 15_000
        )])

        XCTAssertEqual(redirectMatch(for: original, in: [sameDepartureWrongLine, delayedMatch]), delayedMatch)
        XCTAssertNil(redirectMatch(for: original, in: [sameDepartureWrongLine]))
    }

    func testRedirectSetupUsesLocatedSavedDirectionalOrigin() async throws {
        let savedFrom = Station(id: "a", name: "A", lat: -33.86, lon: 151.21)
        let savedTo = Station(id: "b", name: "B", lat: -33.81, lon: 151.00)
        let wireFrom = Station(id: "a", name: "A")
        let wireTo = Station(id: "b", name: "B")
        let trip = SavedTrip(id: "trip", from: savedFrom, to: savedTo)
        let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "A", from: wireTo, to: wireFrom, departure: epochNow() + 60_000, arrival: epochNow() + 600_000)])
        let board = BoardData(from: savedTo, to: savedFrom, journeys: [journey], generatedAt: epochNow(), source: "live")
        let focus = FocusedJourney(tripId: trip.id, reverse: true, journey: journey, board: board, pinned: false)
        let (_, model) = try await model(data: UserData(trips: [trip], focus: focus))

        model.newTrip()

        XCTAssertEqual(model.state.setupFrom, savedTo)
        XCTAssertNotEqual(model.state.setupFrom, wireTo)
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

        model.receiveLocation(Fix(lat: townHall.lat, lon: townHall.lon, at: observedAt, accuracyMetres: 50))

        XCTAssertEqual(model.state.nearestStation?.id, townHall.id)
        XCTAssertTrue(model.state.nearbyStations.contains { $0.id == townHall.id })
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

    func testExplicitLocationFillsAdditionalTripAndCanBeUsedAfterClearing() async throws {
        let (_, model) = try await model(data: UserData(trips: makeFocus().0.trips))
        model.resume(); model.seeded = true; model.location.stop()
        model.newTrip()
        let station = try XCTUnwrap(model.state.stations.first { $0.id == "200070" })
        let fix = Fix(lat: station.lat, lon: station.lon, at: model.state.now, accuracyMetres: 50)
        model.receiveLocation(fix)
        XCTAssertNil(model.state.setupFrom, "Silent lookup must not change an additional trip")
        model.requestLocation()
        XCTAssertEqual(model.state.setupLocationStatus, .locating)
        model.receiveLocation(fix)
        XCTAssertEqual(model.state.setupFrom?.id, station.id)
        model.clearSetupFrom()
        model.requestLocation()
        model.receiveLocation(fix)
        XCTAssertEqual(model.state.setupFrom?.id, station.id, "A new tap supersedes the earlier clear")
        model.pause()
    }

    func testTypingCancelsExplicitLocationAndLateFailure() async throws {
        let (_, model) = try await model(data: UserData())
        model.resume(); model.seeded = true; model.location.stop()
        let station = try XCTUnwrap(model.state.stations.first { $0.id == "200070" })
        model.requestLocation()
        model.setupOriginQueryChanged()
        model.receiveLocation(Fix(lat: station.lat, lon: station.lon, at: model.state.now, accuracyMetres: 50))
        model.locationFailed(.unavailable)
        XCTAssertNil(model.state.setupFrom)
        XCTAssertEqual(model.state.setupLocationStatus, .idle)
        model.pause()
    }

    func testFailedAndApproximateLocationHaveRecoverableStates() async throws {
        let (_, model) = try await model(data: UserData())
        model.resume(); model.seeded = true; model.location.stop()
        let station = try XCTUnwrap(model.state.stations.first { $0.id == "200070" })
        model.requestLocation(); model.locationFailed(.unavailable)
        XCTAssertEqual(model.state.setupLocationStatus, .unavailable)
        model.requestLocation()
        model.receiveLocation(Fix(lat: station.lat, lon: station.lon, at: model.state.now, accuracyMetres: 1_000))
        XCTAssertNil(model.state.setupFrom)
        XCTAssertEqual(model.state.setupLocationStatus, .chooseStation)
        XCTAssertFalse(model.state.nearbyStations.isEmpty)
        model.receiveLocation(Fix(lat: station.lat, lon: station.lon, at: model.state.now, accuracyMetres: 25))
        XCTAssertNil(model.state.setupFrom, "A later silent fix cannot replace an offered station choice")
        model.chooseSetupFrom(station)
        XCTAssertEqual(model.state.setupFrom?.id, station.id)
        model.clearSetupFrom(); model.requestLocation()
        model.receiveLocation(Fix(lat: 0, lon: 0, at: model.state.now, accuracyMetres: 50))
        XCTAssertEqual(model.state.setupLocationStatus, .noNearby)
        model.requestLocation()
        model.receiveLocation(Fix(lat: station.lat, lon: station.lon, at: model.state.now - 300_001, accuracyMetres: 50))
        XCTAssertEqual(model.state.setupLocationStatus, .unavailable)
        model.pause()
    }

    func testLocationConfidenceHonoursAccuracyAmbiguityAndModes() {
        let central = Station(id: "central", name: "Central", lat: -33.8832, lon: 151.2067, modes: ["train"])
        let townHall = Station(id: "town-hall", name: "Town Hall", lat: -33.8736, lon: 151.2069, modes: ["train"])
        let ferry = Station(id: "ferry", name: "Wharf", lat: central.lat, lon: central.lon, modes: ["ferry"])
        let stations = [townHall, ferry, central]
        func choice(_ accuracy: Double?) -> SetupLocationChoice {
            setupLocationChoice(stations: stations, modes: ["train"],
                fix: Fix(lat: central.lat, lon: central.lon, at: 1, accuracyMetres: accuracy))
        }
        XCTAssertEqual(choice(50).automatic, central)
        for accuracy: Double? in [nil, 1_000, -1, .nan] {
            XCTAssertNil(choice(accuracy).automatic)
            XCTAssertEqual(choice(accuracy).stations, [central, townHall])
        }
        let ambiguous = setupLocationChoice(stations: stations, modes: allModes,
            fix: Fix(lat: central.lat, lon: central.lon, at: 1, accuracyMetres: 50))
        XCTAssertNil(ambiguous.automatic)
        XCTAssertTrue(setupLocationChoice(stations: stations, modes: allModes, fix: Fix(lat: 0, lon: 0, at: 1, accuracyMetres: 50)).stations.isEmpty)
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
