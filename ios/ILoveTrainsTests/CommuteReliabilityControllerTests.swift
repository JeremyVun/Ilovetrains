import ActivityKit
import XCTest
@testable import ILoveTrains

/// The commute-reliability controller paths, driven offline the way the owner rides:
/// every request fails and the bundled timetable answers, at a clock it covers.
@MainActor
final class CommuteReliabilityControllerTests: XCTestCase {
    private var models: [TrainViewModel] = []
    private let analytics = makeAnalytics(debug: true)
    private var origin: Station!
    private var destination: Station!
    private var rhodes: Station!
    private var townHall: Station!

    override func setUp() async throws {
        try await super.setUp()
        OfflineTransport.reset()
        let stations = try await DeviceStore(directory: temporaryDirectory()).stations()
        origin = try XCTUnwrap(stations.first { $0.id == "200060" })
        destination = try XCTUnwrap(stations.first { $0.id == "215020" })
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
        let seen = LastAnswer(tripId: "rt", reverse: false, at: boarded.effectiveDeparture - 120_000, stationId: origin.id,
                              board: BoardData(from: origin, to: destination, journeys: [boarded], generatedAt: 0, offline: true),
                              journey: boarded)
        let location = ScriptedLocation()
        let (store, model) = try await model(UserData(trips: [commute], lastAnswer: seen), planner: planner, clock: clock, location: location)

        model.resume()
        try await refreshWritten(model, store)
        XCTAssertNotEqual(model.state.recommendation?.journey.key, boarded.key, "the open's refresh answers with a later train")
        let stored = await store.load().lastAnswer
        XCTAssertEqual(stored?.journey.key, boarded.key, "an unsighted record cannot replace the held one")
        XCTAssertEqual(stored?.stationId, origin.id)
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

        model.receiveLocation(Fix(at: (origin.lat, origin.lon), time: clock.now, speed: 0))
        try await until { await store.load().lastAnswer?.stationId == self.origin.id }
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

    func testWithEveryRequestFailingTheTickStillRefreshesTheBoard() async throws {
        let planner = OfflinePlanner()
        let next = try await firstDirect(planner, at: mondayMorning)
        let clock = TestClock(next.effectiveDeparture - 120_000)
        let location = ScriptedLocation()
        let (store, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: location)
        model.resume()
        try await refreshWritten(model, store)
        let shown = try XCTUnwrap(displayedHomeLead(model.state))

        // Past the shown train's fix window the tick takes no fix, so the board refresh is its own.
        clock.now = shown.effectiveDeparture + shownDepartureFixWindow + 1_000
        model.tick()
        let asked = location.requests.count, sent = OfflineTransport.requests().count
        model.refreshTick()

        try await until { (model.state.recommendation?.journey.effectiveDeparture ?? 0) >= clock.now }
        XCTAssertNotEqual(model.state.recommendation?.journey.key, shown.key)
        XCTAssertEqual(location.requests.count, asked)
        XCTAssertGreaterThan(OfflineTransport.requests().count, sent, "the tick's realtime fetch was asked for and failed")
    }

    func testABusyCorridorsOfflineBoardStillOffersTrainsThatHaveNotLeft() async throws {
        // Central → Parramatta at 08:00: a quarter hour's plan alone held only trains that had left (ruling 24).
        let clock = TestClock(mondayMorning)
        let (_, model) = try await model(UserData(trips: [commute]), clock: clock, location: ScriptedLocation())
        model.resume()
        model.openTrip(id: commute.id)
        try await until { model.state.board != nil && !model.state.refreshing }

        let rows = try XCTUnwrap(model.state.board?.journeys)
        XCTAssertTrue(rows.contains { (clock.now - offlineBoardLookback...clock.now).contains($0.effectiveDeparture) },
                      "the last quarter hour stays on the board")
        let upcoming = rows.filter { !$0.cancelled && $0.effectiveDeparture > clock.now }
        XCTAssertFalse(upcoming.isEmpty, "\(rows.map { clockTime($0.effectiveDeparture) })")
        XCTAssertLessThanOrEqual(try XCTUnwrap(upcoming.first).effectiveDeparture - clock.now, travelSeen)
        XCTAssertEqual(rows.map(\.effectiveDeparture), rows.map(\.effectiveDeparture).sorted())
    }

    func testExpiryKeepsARecordNamingAnotherTrain() async throws {
        let now = mondayMorning
        let clock = TestClock(now)
        let ride = { (departure: Millis) in
            Journey(legs: [Leg(line: "T1", mode: "train", headsign: "Parramatta", from: self.origin, to: self.destination,
                               departure: departure, arrival: departure + 1_800_000)])
        }
        let expired = ride(now - 10_800_000), next = ride(now - 300_000)
        let focus = FocusedJourney(tripId: commute.id, reverse: false, journey: expired,
                                   board: BoardData(from: origin, to: destination, journeys: [expired], generatedAt: expired.departure),
                                   pinned: false)
        let seen = LastAnswer(tripId: commute.id, reverse: false, at: next.effectiveDeparture - 120_000, stationId: origin.id,
                              board: BoardData(from: origin, to: destination, journeys: [next], generatedAt: 0, offline: true),
                              journey: next)
        // Without location nothing arms the arrival guard, so the long-overdue trip expires on open.
        let (store, model) = try await model(UserData(trips: [commute], focus: focus, lastAnswer: seen, useLocation: false),
                                             clock: clock, location: ScriptedLocation(), network: false)
        model.resume()
        model.tick()

        try await until { await store.load().focus == nil }
        let kept = await store.load().lastAnswer
        XCTAssertEqual(kept, seen, "expiry clears only a record naming the expired train")
    }

    func testOfflineOnBoardEntryMatchesTheRunningTimetableService() async throws {
        // The owner's commute; every bundled service changes on the way. Half way through a long itinerary,
        // thirty planned services from the cached board's median ride still reach the train under way.
        let planner = OfflinePlanner()
        try await planner.initialize()
        let planned = try await planner.plan(from: rhodes, to: townHall, at: mondayMorning, modes: allModes,
                                             limit: timetablePageLimit, maxTransfers: 2)
        let riding = try XCTUnwrap(planned.journeys.first { !$0.cancelled })
        let progress = 0.5
        let ridingNow = riding.effectiveDeparture + (riding.effectiveArrival - riding.effectiveDeparture) * progress
        let clock = TestClock(ridingNow - 30_000)
        let trip = SavedTrip(id: "rt", from: rhodes, to: townHall)
        let (store, model) = try await model(UserData(trips: [trip]), planner: planner, clock: clock, location: ScriptedLocation())
        model.resume()
        try await refreshWritten(model, store, from: rhodes, to: townHall)
        let along = { (fraction: Double) in
            (self.rhodes.lat + (self.townHall.lat - self.rhodes.lat) * fraction, self.rhodes.lon + (self.townHall.lon - self.rhodes.lon) * fraction)
        }

        model.receiveLocation(Fix(at: along(progress - 0.04), time: clock.now, speed: 14))
        XCTAssertNil(model.state.focus, "one fix with no heading cannot tell the direction")
        clock.now = ridingNow
        let asked = OfflineTransport.requests().count
        model.receiveLocation(Fix(at: along(progress), time: clock.now, speed: 14))
        try await until(seconds: 30) { model.state.focus != nil }

        XCTAssertEqual(model.state.focus?.journey.key, riding.key,
                       "\(planned.journeys.prefix(8).map { "\($0.key) \(clockTime($0.effectiveDeparture))-\(clockTime($0.effectiveArrival))" })")
        XCTAssertEqual(model.state.focus?.pinned, false)
        XCTAssertEqual(model.state.focus?.board.from.id, rhodes.id)
        XCTAssertEqual(analytics.ledger.filter { $0.t == "entered_inferred" }.count, 1)
        let asks = OfflineTransport.requests().dropFirst(asked).compactMap(\.query)
        XCTAssertTrue(asks.contains { $0.contains("at=") && $0.contains("limit=\(onBoardLimit)") && !$0.contains("at=\(iso(riding.departure))") },
                      "the running services are asked for online too, and that request fails: \(asks)")
    }

    func testTheEvidenceWaitHoldsOnceAVisitAndARestartCannotExtendIt() async throws {
        let now = mondayMorning
        let clock = TestClock(now)
        let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "Parramatta", from: origin, to: destination,
                                         departure: now - 2_400_000, arrival: now - 600_000)])
        let focus = FocusedJourney(tripId: "rt", reverse: false, journey: journey,
                                   board: BoardData(from: origin, to: destination, journeys: [journey], generatedAt: now - 2_400_000),
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
        let planned = try await planner.plan(from: origin, to: destination, at: anchor, modes: allModes, limit: timetablePageLimit, maxTransfers: 2)
            .journeys.filter { $0.effectiveDeparture < clock.now - 900_000 }
        XCTAssertGreaterThanOrEqual(planned.count, 2)
        var online = planned[0]
        online.legs[0].estimatedDeparture = online.legs[0].departure + 120_000
        online.legs[0].fromPlatform = "9"
        let onlineOnly = Journey(legs: [Leg(line: "T1X", mode: "train", headsign: "Parramatta", from: origin, to: destination,
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

    private var commute: SavedTrip { SavedTrip(id: "rt", from: origin, to: destination) }

    /// A weekday morning inside the bundled timetable's coverage.
    private var mondayMorning: Millis {
        ISO8601DateFormatter().date(from: "2026-10-12T08:00:00+11:00")!.timeIntervalSince1970 * 1_000
    }

    func testStopTripOnAGuessedTripDeclinesItAndEndsTheTracker() async throws {
        let tracker = quietTracker()
        let (store, model, boarded, _, location) = try await guessedTrip(tracker: tracker)
        try await until { await tracker.snapshot().active != nil }

        model.stopTrip()

        XCTAssertNil(model.state.focus)
        XCTAssertEqual(model.state.screen, .home)
        XCTAssertTrue(model.state.selectionPredicted, "Home answers where the phone is now")
        XCTAssertFalse(location.isMonitoring)
        XCTAssertEqual(analytics.ledger.filter { $0.t == "declined_inferred" }.count, 1)
        try await until { await store.load().focus == nil }
        let stored = await store.load()
        XCTAssertEqual(stored.inferenceDeclined?.tripId, commute.id)
        XCTAssertEqual(stored.inferenceDeclined?.departure, boarded.departureKey)
        XCTAssertNil(stored.lastAnswer)
        XCTAssertTrue(stored.rides.isEmpty)
        try await until { await tracker.snapshot().active == nil }
    }

    func testStartingTheGuessedJourneyFromItsRunningRowKeepsItsArrivalGuard() async throws {
        let (store, model, boarded, clock, location) = try await guessedTrip()
        try await until { model.state.focus?.arrivalGuard?.armed == true }
        let armed = model.state.focus?.arrivalGuard
        clock.now += 30_000
        model.tick()
        model.openTrip(id: commute.id)
        try await until { model.state.board != nil && !model.state.refreshing }
        let row = try XCTUnwrap(model.state.board?.journeys.first { $0.key == boarded.key })

        model.openBoardRow(row)

        XCTAssertEqual(model.state.screen, .home)
        XCTAssertEqual(model.state.focus?.pinned, true)
        XCTAssertEqual(model.state.focus?.arrivalGuard, armed, "the guard armed while guessed survives the start")
        XCTAssertTrue(location.isMonitoring)
        try await until { await store.load().focus?.pinned == true }
        let declined = await store.load().inferenceDeclined
        XCTAssertNil(declined)
    }

    func testARunningBoardRowStartsTheTripOfflineAndItsLockScreenStopDeclinesItUnreported() async throws {
        let planner = OfflinePlanner()
        let clock = TestClock(mondayMorning)
        let tracker = quietTracker()
        let (store, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: ScriptedLocation(),
                                             tracker: tracker)
        model.resume()
        model.openTrip(id: commute.id)
        try await until { model.state.board != nil && !model.state.refreshing }
        let left = try XCTUnwrap(model.state.board?.journeys.filter { !$0.cancelled && $0.effectiveDeparture <= clock.now })
        let arrived = try XCTUnwrap(left.min { $0.effectiveArrival < $1.effectiveArrival })
        let running = try XCTUnwrap(left.max { $0.effectiveArrival < $1.effectiveArrival })
        XCTAssertGreaterThan(running.effectiveArrival, arrived.effectiveArrival)
        clock.now = arrived.effectiveArrival
        model.tick()

        model.openBoardRow(arrived)
        XCTAssertEqual(model.state.screen, .detail, "a row that has arrived still opens its journey")
        XCTAssertNil(model.state.focus)
        model.back()
        model.openBoardRow(running)

        XCTAssertEqual(model.state.screen, .home)
        XCTAssertEqual(model.state.focus?.journey.key, running.key)
        XCTAssertEqual(model.state.focus?.pinned, true)
        try await until { await store.load().focus?.journey.key == running.key }
        try await until { await tracker.snapshot().active != nil }
        XCTAssertFalse(OfflineTransport.requests().isEmpty, "every request failed on the way")
        let active = await tracker.snapshot().active
        let session = try XCTUnwrap(active?.sessionId)
        StopTripIntent.handler = { [weak model] in await model?.stopTrip(session: $0) }
        defer { StopTripIntent.handler = nil }

        _ = try await StopTripIntent(session: session).perform()

        XCTAssertNil(model.state.focus)
        let stored = await store.load()
        XCTAssertNil(stored.focus)
        XCTAssertTrue(stored.rides.isEmpty)
        XCTAssertEqual(stored.inferenceDeclined, InferenceDecline(tripId: commute.id, reverse: false, at: clock.now,
                                                                  departure: running.departureKey, arrival: running.effectiveArrival),
                       "a rider who stops a trip they started while riding is not guessed back in")
        XCTAssertFalse(analytics.ledger.contains { $0.t == "declined_inferred" }, "only a guessed stop is reported")
        try await until { await tracker.snapshot().active == nil }
    }

    func testTheLiveActivityStopActsOnlyForTheCurrentSession() async throws {
        let tracker = quietTracker()
        let (store, model, _, _, _) = try await guessedTrip(tracker: tracker)
        try await until { await tracker.snapshot().active != nil }
        let current = await tracker.snapshot().active
        let session = try XCTUnwrap(current?.sessionId)
        StopTripIntent.handler = { [weak model] in await model?.stopTrip(session: $0) }
        defer { StopTripIntent.handler = nil }

        _ = try await StopTripIntent(session: UUID()).perform()
        XCTAssertNotNil(model.state.focus, "an old activity's button cannot stop the current trip")

        _ = try await StopTripIntent(session: session).perform()
        XCTAssertNil(model.state.focus)
        let stored = await store.load()
        XCTAssertNil(stored.focus, "the stop is saved before the intent returns")
        XCTAssertNotNil(stored.inferenceDeclined)
        XCTAssertEqual(analytics.ledger.filter { $0.t == "declined_inferred" }.count, 1)
        let ended = await tracker.snapshot().active
        XCTAssertNil(ended)
    }

    func testTenMinutesAwayIsANewOpenAndNineKeepTheBoard() async throws {
        let clock = TestClock(mondayMorning)
        let (_, model) = try await model(UserData(trips: [commute]), clock: clock, location: ScriptedLocation())
        model.resume()
        model.openTrip(id: commute.id)
        XCTAssertFalse(model.state.selectionPredicted)

        model.pause()
        clock.now += newOpenAfter - 60_000
        model.resume()
        XCTAssertEqual(model.state.screen, .board, "a quick switch keeps the board")
        XCTAssertFalse(model.state.selectionPredicted)

        model.pause()
        clock.now += newOpenAfter
        model.resume()
        XCTAssertEqual(model.state.screen, .home)
        XCTAssertTrue(model.state.selectionPredicted, "the explicit selection is gone")
    }

    func testATrackerTapStillLandsOnItsJourneyAfterTenMinutesInEitherOrder() async throws {
        let planner = OfflinePlanner()
        let clock = TestClock(mondayMorning)
        let tracker = quietTracker()
        let (_, model) = try await model(UserData(trips: [commute]), planner: planner, clock: clock, location: ScriptedLocation(),
                                         tracker: tracker)
        model.resume()
        model.openTrip(id: commute.id)
        try await until { model.state.board != nil && !model.state.refreshing }
        let running = try XCTUnwrap(model.state.board?.journeys.filter { onItsWay($0, now: clock.now, data: UserData()) }
            .max { $0.effectiveArrival < $1.effectiveArrival })
        XCTAssertGreaterThan(running.effectiveArrival, clock.now + 2 * newOpenAfter + 60_000, "still riding after both returns")
        model.openBoardRow(running)
        try await until { await tracker.snapshot().active != nil }
        let active = await tracker.snapshot().active
        let session = try XCTUnwrap(active?.sessionId)
        let url = try XCTUnwrap(URL(string: "ilovetrains://tracker?session=\(session.uuidString)"))

        model.openTrip(id: commute.id)
        model.pause()
        clock.now += newOpenAfter
        model.openURL(url)
        try await until { model.state.screen == .detail }
        model.resume()
        XCTAssertEqual(model.state.screen, .detail, "the route landed first, and the return does not override it")
        XCTAssertEqual(model.state.detail?.key, running.key)

        model.back()
        model.pause()
        clock.now += newOpenAfter
        model.resume()
        XCTAssertEqual(model.state.screen, .home)
        model.openURL(url)
        try await until { model.state.screen == .detail }
        XCTAssertEqual(model.state.detail?.key, running.key)
    }

    private func quietTracker() -> TravelTrackerController {
        TravelTrackerController(store: TravelTrackerSessionFileStore(directory: temporaryDirectory()), driver: QuietActivities())
    }

    /// Trip mode entered the way it is guessed today: seen at the platform, then a fix on the way.
    private func guessedTrip(
        tracker: TravelTrackerController? = nil
    ) async throws -> (DeviceStore, TrainViewModel, Journey, TestClock, ScriptedLocation) {
        let planner = OfflinePlanner()
        try await planner.initialize()
        let clock = TestClock(mondayMorning)
        // The plan the offline board makes at this moment, so the guessed service is one of its rows.
        let board = try await planner.plan(from: origin, to: destination, at: clock.now - 900_000, modes: allModes, limit: 24, maxTransfers: 2)
        let boarded = try XCTUnwrap(board.journeys.last { !$0.cancelled && $0.effectiveDeparture <= clock.now - 180_000 })
        let seen = LastAnswer(tripId: commute.id, reverse: false, at: boarded.effectiveDeparture - 120_000, stationId: origin.id,
                              board: BoardData(from: origin, to: destination, journeys: [boarded], generatedAt: 0, offline: true),
                              journey: boarded)
        let location = ScriptedLocation()
        let (store, model) = try await model(UserData(trips: [commute], lastAnswer: seen), planner: planner, clock: clock,
                                             location: location, tracker: tracker)
        model.resume()
        try await refreshWritten(model, store)
        model.receiveLocation(Fix(at: along(0.17), time: clock.now, speed: 14))
        XCTAssertEqual(model.state.focus?.journey.key, boarded.key)
        XCTAssertEqual(model.state.focus?.pinned, false)
        return (store, model, boarded, clock, location)
    }

    private func along(_ fraction: Double) -> (Double, Double) {
        (origin.lat + (destination.lat - origin.lat) * fraction, origin.lon + (destination.lon - origin.lon) * fraction)
    }

    private func firstDirect(_ planner: OfflinePlanner, at: Millis) async throws -> Journey {
        try await planner.initialize()
        let board = try await planner.plan(from: origin, to: destination, at: at, modes: ["train"], limit: timetablePageLimit, maxTransfers: 2)
        return try XCTUnwrap(board.journeys.first { $0.legs.count == 1 && !$0.cancelled && $0.effectiveDeparture >= at },
                             "\(board.error ?? "") \(board.journeys.prefix(6).map { "\($0.legs.map(\.line)) \(clockTime($0.effectiveDeparture))" })")
    }

    private func model(
        _ data: UserData,
        planner: OfflinePlanner = OfflinePlanner(),
        clock: TestClock,
        location: ScriptedLocation,
        network: Bool = true,
        tracker: TravelTrackerController? = nil
    ) async throws -> (DeviceStore, TrainViewModel) {
        let store = DeviceStore(directory: temporaryDirectory())
        try await store.save(data)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [OfflineTransport.self]
        var api = TransitAPI()
        api.baseURL = "http://offline.invalid"
        api.session = URLSession(configuration: configuration)
        let tracker = tracker ?? quietTracker()
        let model = TrainViewModel(store: store, api: api, planner: planner, tracker: tracker, location: location,
                                   keepalive: StoppedKeepalive(), analytics: analytics, clock: { clock.now })
        models.append(model)
        model.networkDisabled = !network
        try await until { model.state.ready }
        return (store, model)
    }

    /// The refresh writes `lastAnswer` after it caches its board; an unchanged record is never saved, so wait past both.
    private func refreshWritten(_ model: TrainViewModel, _ store: DeviceStore, from: Station? = nil, to: Station? = nil) async throws {
        let pair = (from ?? origin!, to ?? destination!)
        try await until { !model.state.refreshing && model.state.recommendation != nil }
        try await until { await store.cached(from: pair.0, to: pair.1, modes: allModes) != nil }
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
            "from": stop(origin), "to": stop(destination), "generatedAt": time(generatedAt), "journeys": rows
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
