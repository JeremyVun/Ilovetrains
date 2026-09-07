import XCTest
@testable import ILoveTrains

final class BoardRetentionTests: XCTestCase {
    private let now: Millis = 1_788_765_000_000
    private let townHall = Station(id: "200070", name: "Town Hall Station")
    private let rhodes = Station(id: "213820", name: "Rhodes Station")

    private var t9: Journey {
        Journey(legs: [Leg(
            line: "T9", mode: "train", headsign: "Epping", from: townHall, to: rhodes,
            departure: now + 60_000, arrival: now + 25 * 60_000,
            estimatedDeparture: now + 4 * 60_000, estimatedArrival: now + 28 * 60_000
        )])
    }

    private var previous: BoardData {
        BoardData(
            from: townHall, to: rhodes, journeys: [t9], generatedAt: now,
            source: "live", homeJourneyKey: t9.key
        )
    }

    func testFocusedJourneyKeepsLastKnownDelayAcrossRestart() throws {
        let focus = FocusedJourney(tripId: "trip", reverse: false, journey: t9, board: previous).lastKnown()
        let restored = try JSONDecoder().decode(FocusedJourney.self, from: JSONEncoder().encode(focus))

        XCTAssertEqual(restored.journey.effectiveArrival, t9.effectiveArrival)
        XCTAssertEqual(restored.journey.retained, true)
        XCTAssertTrue(restored.board.offline)
        XCTAssertFalse(restored.board.isLive(now))
    }

    func testDelayedTrainSurvivesOfflineReopenFiveMinutesAfterDeparture() throws {
        let reopened = now + 9 * 60_000
        let cached = try JSONDecoder().decode(BoardData.self, from: JSONEncoder().encode(previous))
        let emptyLocal = BoardData(from: townHall, to: rhodes, generatedAt: now - 86_400_000, offline: true)
        let result = try XCTUnwrap(mergeBoardResults(previous: cached, local: emptyLocal, online: nil, now: reopened))

        XCTAssertTrue(result.offline)
        XCTAssertEqual(result.journeys.map(\.key), [t9.key])
        XCTAssertEqual(result.journeys[0].effectiveDeparture, t9.effectiveDeparture)
        XCTAssertEqual(retainedHomeJourney(result, now: reopened)?.key, t9.key)
        XCTAssertEqual(figureFor(result.journeys[0], board: result, now: reopened).provenance, "Ago")
        XCTAssertEqual(figureFor(result.journeys[0], board: result, now: reopened).value, "5")
        XCTAssertEqual(try JSONDecoder().decode(BoardData.self, from: JSONEncoder().encode(result)), result)
    }

    func testScheduledReplanDoesNotEraseObservedDelay() throws {
        let local = BoardData(
            from: townHall, to: rhodes, journeys: [t9.scheduledOnly()], generatedAt: now,
            source: "schedule", offline: true
        )
        let result = try XCTUnwrap(mergeBoardResults(previous: previous, local: local, online: nil, now: now + 5 * 60_000))

        XCTAssertEqual(result.journeys[0].effectiveArrival, t9.effectiveArrival)
        XCTAssertEqual(result.journeys[0].retained, true)
    }

    func testOnlineFutureReplacesCacheButKeepsDepartedTrain() throws {
        let later = shiftedT9(departure: now + 20 * 60_000, arrival: now + 45 * 60_000)
        let online = BoardData(from: townHall, to: rhodes, journeys: [later], generatedAt: now + 9 * 60_000, source: "live")
        let result = try XCTUnwrap(mergeBoardResults(previous: previous, local: nil, online: online, now: now + 9 * 60_000))

        XCTAssertEqual(result.journeys.map(\.key), [t9.key, later.key])
        XCTAssertEqual(result.journeys[0].retained, true)
        XCTAssertEqual(nextHomeJourney(result, now: now + 9 * 60_000)?.key, later.key)
        XCTAssertNil(retainedHomeJourney(result, now: now + 9 * 60_000))
        XCTAssertEqual(figureFor(result.journeys[0], board: result, now: now + 9 * 60_000).provenance, "Ago")
    }

    func testFreshExactObservationOverridesSavedEstimate() throws {
        var updated = t9
        updated.legs[0].estimatedArrival = now + 32 * 60_000
        let online = BoardData(from: townHall, to: rhodes, journeys: [updated], generatedAt: now + 30_000, source: "live")
        let result = try XCTUnwrap(mergeBoardResults(previous: previous, local: nil, online: online, now: now + 30_000))

        XCTAssertEqual(result.journeys, [updated])
        XCTAssertNotEqual(result.journeys[0].retained, true)
    }

    func testPartialLocalRealtimeBoardCannotMakeScheduledCopyFresh() throws {
        let unrelated = shiftedT9(departure: now + 30 * 60_000, arrival: now + 55 * 60_000)
        var observed = unrelated
        observed.legs[0].estimatedArrival = observed.arrival + 60_000
        let local = BoardData(
            from: townHall, to: rhodes, journeys: [t9.scheduledOnly(), observed], generatedAt: now + 30_000,
            source: "live", offline: false
        )
        let result = try XCTUnwrap(mergeBoardResults(previous: previous, local: local, online: nil, now: now + 30_000))

        XCTAssertEqual(result.journeys.first { $0.key == t9.key }?.effectiveArrival, t9.effectiveArrival)
        XCTAssertEqual(result.journeys.first { $0.key == t9.key }?.retained, true)
        XCTAssertNotEqual(result.journeys.first { $0.key == observed.key }?.retained, true)
    }

    func testAuthoritativeEmptyOnlineBoardRemovesOldFutureDepartures() throws {
        let online = BoardData(from: townHall, to: rhodes, generatedAt: now, source: "live")
        let result = try XCTUnwrap(mergeBoardResults(previous: previous, local: nil, online: online, now: now))

        XCTAssertTrue(result.journeys.isEmpty)
        XCTAssertNil(result.homeJourneyKey)
    }

    func testOfflineHeaderKeepsOriginalUntilThirtyMinutesAfterArrival() throws {
        let next = shiftedT9(departure: now + 20 * 60_000, arrival: now + 45 * 60_000)
        let local = BoardData(from: townHall, to: rhodes, journeys: [next], generatedAt: now, source: "schedule", offline: true)
        let result = try XCTUnwrap(mergeBoardResults(previous: previous, local: local, online: nil, now: now + 9 * 60_000))

        XCTAssertEqual(result.journeys.count, 2)
        XCTAssertEqual(nextHomeJourney(result, now: now + 9 * 60_000)?.key, t9.key)
        XCTAssertNil(retainedHomeJourney(result, now: t9.effectiveArrival + 1_800_001))
    }

    func testOldRowsAndOtherStationPairsDoNotLeakIntoBoard() throws {
        let old = shiftedT9(departure: now - 2 * 86_400_000, arrival: now - 2 * 86_400_000 + 60_000)
        let oldBoard = BoardData(from: townHall, to: rhodes, journeys: [old], generatedAt: now, source: "live")
        XCTAssertTrue(try XCTUnwrap(mergeBoardResults(previous: oldBoard, local: nil, online: nil, now: now)).journeys.isEmpty)

        let reverse = BoardData(from: rhodes, to: townHall, generatedAt: now, source: "live")
        XCTAssertTrue(try XCTUnwrap(mergeBoardResults(previous: previous, local: nil, online: reverse, now: now)).journeys.isEmpty)
    }

    func testNewOptionalFieldsDecodeWhenAbsent() throws {
        let legacy = BoardData(from: townHall, to: rhodes, journeys: [t9], generatedAt: now, source: "live")
        let encoded = try JSONEncoder().encode(legacy)
        let raw = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertNil(raw["homeJourneyKey"])
        let journey = try XCTUnwrap((raw["journeys"] as? [[String: Any]])?.first)
        XCTAssertNil(journey["retained"])

        let decoded = try JSONDecoder().decode(BoardData.self, from: encoded)
        XCTAssertNil(decoded.homeJourneyKey)
        XCTAssertNil(decoded.journeys[0].retained)
    }

    func testEarlierMergePreservesObservationsAndLetsCurrentRowsWin() {
        let old = shiftedT9(departure: now - 60 * 60_000, arrival: now - 30 * 60_000)
        var observed = old
        observed.legs[0].estimatedArrival = observed.arrival + 5 * 60_000
        var current = observed
        current.legs[0].estimatedArrival = observed.arrival + 7 * 60_000
        let expired = shiftedT9(departure: now - 25 * 60 * 60_000, arrival: now - 24 * 60 * 60_000)

        let rows = mergeEarlierJourneys([observed, expired], current: [current], cutoff: now - 86_400_000)

        XCTAssertEqual(rows, [current])
        XCTAssertEqual(rows[0].effectiveArrival, current.effectiveArrival)
        XCTAssertTrue(rows[0].realtime)
    }

    func testFailedFocusObservationKeepsLastKnownBoardAndAcceptsFreshAlternatives() {
        let oldAlternatives = BoardData(from: townHall, to: rhodes, journeys: [t9], generatedAt: now - 60_000, source: "schedule", offline: true)
        let next = shiftedT9(departure: now + 30 * 60_000, arrival: now + 55 * 60_000)
        let newAlternatives = BoardData(from: townHall, to: rhodes, journeys: [next], generatedAt: now + 1, source: "schedule", offline: true)
        let focus = FocusedJourney(tripId: "trip", reverse: false, journey: t9, board: previous, alternatives: oldAlternatives)

        let result = focusAfterRefresh(focus, update: FocusUpdate(journey: t9.scheduledOnly()), alternatives: newAlternatives)

        XCTAssertEqual(result.journey.effectiveArrival, t9.effectiveArrival)
        XCTAssertEqual(result.journey.retained, true)
        XCTAssertEqual(result.board.generatedAt, previous.generatedAt)
        XCTAssertTrue(result.board.offline)
        XCTAssertEqual(result.alternatives, newAlternatives)
    }

    func testFailedAlternativePlanRetainsPreviousAlternatives() {
        let oldAlternatives = BoardData(from: townHall, to: rhodes, journeys: [t9], generatedAt: now - 60_000, source: "schedule", offline: true)
        let focus = FocusedJourney(tripId: "trip", reverse: false, journey: t9, board: previous, alternatives: oldAlternatives)

        let result = focusAfterRefresh(focus, update: FocusUpdate(journey: t9, observedAt: now + 1, live: true), alternatives: nil)

        XCTAssertEqual(result.alternatives, oldAlternatives)
        XCTAssertEqual(result.board.generatedAt, now + 1)
    }

    @MainActor
    func testColdOfflineOpenRestoresHeaderWithoutInferringRide() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceStore(directory: directory)
        let current = epochNow()
        let journey = Journey(legs: [Leg(
            line: "T9", mode: "train", headsign: "Epping", from: townHall, to: rhodes,
            departure: current - 8 * 60_000, arrival: current + 17 * 60_000,
            estimatedDeparture: current - 5 * 60_000, estimatedArrival: current + 20 * 60_000
        )])
        let board = BoardData(
            from: townHall, to: rhodes, journeys: [journey], generatedAt: current - 5 * 60_000,
            source: "live", homeJourneyKey: journey.key
        )
        try await store.save(UserData(trips: [SavedTrip(id: "trip", from: townHall, to: rhodes)]))
        try await store.cache(board, modes: allModes)

        let model = TrainViewModel(store: store)
        model.networkDisabled = true
        for _ in 0..<200 where !model.state.ready {
            try await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertTrue(model.state.ready)
        XCTAssertNil(model.state.focus)
        XCTAssertEqual(model.state.homeBoard?.homeJourneyKey, journey.key)
        XCTAssertEqual(retainedHomeJourney(model.state.homeBoard, now: model.state.now)?.key, journey.key)
        XCTAssertEqual(model.state.homeBoard?.journeys.first?.effectiveArrival, journey.effectiveArrival)
        XCTAssertEqual(model.state.homeBoard?.journeys.first?.retained, true)
        model.pause()
    }

    private func shiftedT9(departure: Millis, arrival: Millis) -> Journey {
        var journey = t9.scheduledOnly()
        journey.legs[0].departure = departure
        journey.legs[0].arrival = arrival
        return journey
    }
}
