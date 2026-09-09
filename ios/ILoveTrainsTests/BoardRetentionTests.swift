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

    func testOutsidePrefixRecommendationPersistsWithItsOwnSource() throws {
        let outside = shiftedT9(departure: now + 10 * 60_000, arrival: now + 20 * 60_000)
        let source = BoardData(
            from: townHall, to: rhodes, journeys: [outside], generatedAt: now,
            source: "live", requestMaxTransfers: 2
        )
        let page = RecommendationPage(
            at: now + 10_000, rawBody: Data("supplement".utf8), board: source, maxTransfers: 2
        )
        let board = BoardData(
            from: townHall, to: rhodes, journeys: [t9], generatedAt: now - 20_000,
            source: "live", homeJourneyKey: outside.key, requestMaxTransfers: 2,
            recommendation: page
        )

        let restored = try JSONDecoder().decode(BoardData.self, from: JSONEncoder().encode(board))
        let selected = try XCTUnwrap(selectRecommendation(
            recommendationCandidates(restored), now: now, modes: allModes, maxTransfers: 2
        ))

        XCTAssertEqual(selected.journey.key, outside.key)
        XCTAssertEqual(selected.board.generatedAt, source.generatedAt)
        XCTAssertEqual(selected.board.requestMaxTransfers, 2)
        XCTAssertEqual(restored.recommendation?.rawBody, Data("supplement".utf8))
        XCTAssertEqual(retainedHomeJourney(retainedOfflineBoard(restored), now: now)?.key, outside.key)
    }

    func testRecommendationDedupKeepsNewerMatchingObservation() throws {
        var observed = t9
        observed.legs[0].estimatedArrival = now + 35 * 60_000
        let older = RecommendationPage(
            at: now - 20_000,
            board: BoardData(from: townHall, to: rhodes, journeys: [t9], generatedAt: now - 20_000, source: "live"),
            maxTransfers: nil
        )
        let board = BoardData(
            from: townHall, to: rhodes, journeys: [observed], generatedAt: now,
            source: "live", recommendationPages: [older]
        )

        let match = try XCTUnwrap(recommendationCandidates(board).first { $0.journey.key == t9.key })
        XCTAssertEqual(match.journey.effectiveArrival, observed.effectiveArrival)
        XCTAssertEqual(match.board.generatedAt, now)
    }

    func testCandidateFreshnessUsesEachSourcesTransferCap() throws {
        let pageJourney = shiftedT9(departure: now + 12 * 60_000, arrival: now + 24 * 60_000)
        let page = RecommendationPage(
            at: now,
            board: BoardData(
                from: townHall, to: rhodes, journeys: [pageJourney], generatedAt: now,
                source: "live", requestMaxTransfers: 2
            ),
            maxTransfers: 2
        )
        let board = BoardData(
            from: townHall, to: rhodes, journeys: [t9], generatedAt: now,
            source: "live", requestMaxTransfers: nil, recommendationPages: [page]
        )

        let selected = try XCTUnwrap(selectRecommendation(
            recommendationCandidates(board), now: now, modes: allModes, maxTransfers: 2
        ))
        XCTAssertEqual(selected.journey.key, pageJourney.key)
        XCTAssertEqual(selected.board.requestMaxTransfers, 2)
    }

    func testFreshIneligibleCandidateDoesNotDisplaceRetainedAnswer() throws {
        var retained = t9
        retained.retained = true
        var cancelled = shiftedT9(departure: now + 5 * 60_000, arrival: now + 15 * 60_000)
        cancelled.legs[0].cancelled = true
        let candidates = [
            JourneyRecommendation(
                journey: retained,
                board: BoardData(from: townHall, to: rhodes, journeys: [retained], generatedAt: now - 120_000, source: "live")
            ),
            JourneyRecommendation(
                journey: cancelled,
                board: BoardData(from: townHall, to: rhodes, journeys: [cancelled], generatedAt: now, source: "live")
            )
        ]

        XCTAssertEqual(
            selectRecommendation(candidates, now: now, modes: allModes, maxTransfers: nil)?.journey.key,
            retained.key
        )
    }

    func testStaticReplanRetainsOutsidePrefixObservation() throws {
        var observed = t9
        observed.legs[0].estimatedArrival = now + 31 * 60_000
        let previous = BoardData(
            from: townHall, to: rhodes, generatedAt: now - 30_000, source: "live",
            homeJourneyKey: observed.key,
            recommendation: RecommendationPage(
                at: now - 30_000,
                board: BoardData(from: townHall, to: rhodes, journeys: [observed], generatedAt: now - 30_000, source: "live"),
                maxTransfers: nil
            )
        )
        let localJourney = shiftedT9(departure: now + 8 * 60_000, arrival: now + 18 * 60_000)
        let local = BoardData(
            from: townHall, to: rhodes, journeys: [localJourney], generatedAt: now,
            source: "schedule", offline: true
        )

        let merged = try XCTUnwrap(mergeBoardResults(previous: previous, local: local, online: nil, now: now))
        XCTAssertEqual(merged.recommendation?.journeys.first?.effectiveArrival, observed.effectiveArrival)
        XCTAssertEqual(merged.recommendation?.journeys.first?.retained, true)
        XCTAssertEqual(merged.recommendation?.source, "live")
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

    func testFocusedRefreshRejectsDifferentServiceIdentityAndLegCount() {
        let focus = FocusedJourney(tripId: "trip", reverse: false, journey: t9, board: previous)
        var differentService = t9
        differentService.legs[0].line = "T8"
        differentService.legs[0].estimatedArrival = now + 40 * 60_000
        let identityMismatch = focusAfterRefresh(
            focus,
            update: FocusUpdate(journey: differentService, observedAt: now + 1, live: true),
            alternatives: nil
        )
        let extraLeg = Leg(
            line: "M1", mode: "metro", headsign: "Tallawong", from: rhodes, to: townHall,
            departure: now + 30 * 60_000, arrival: now + 45 * 60_000,
            estimatedArrival: now + 50 * 60_000, cancelled: true
        )
        let wrongCount = Journey(legs: t9.legs + [extraLeg])
        let countMismatch = focusAfterRefresh(
            focus,
            update: FocusUpdate(journey: wrongCount, observedAt: now + 2, live: true),
            alternatives: nil
        )

        XCTAssertEqual(identityMismatch.journey.effectiveArrival, t9.effectiveArrival)
        XCTAssertEqual(identityMismatch.journey.retained, true)
        XCTAssertEqual(identityMismatch.board.generatedAt, previous.generatedAt)
        XCTAssertTrue(identityMismatch.board.offline)
        XCTAssertEqual(countMismatch.journey.legs.count, 1)
        XCTAssertEqual(countMismatch.journey.effectiveArrival, t9.effectiveArrival)
        XCTAssertEqual(countMismatch.journey.retained, true)
        XCTAssertEqual(countMismatch.board.generatedAt, previous.generatedAt)
        XCTAssertTrue(countMismatch.board.offline)
    }

    func testPartialObservedRefreshJudgesCompletionAgainstTheMergedFinalArrival() {
        let middle = Station(id: "change", name: "Change")
        let first = Leg(
            line: "T8", mode: "train", headsign: "Change", from: townHall, to: middle,
            departure: now - 30 * 60_000, arrival: now - 15 * 60_000
        )
        let second = Leg(
            line: "M1", mode: "metro", headsign: "Rhodes", from: middle, to: rhodes,
            departure: now - 12 * 60_000, arrival: now - 60_000
        )
        let journey = Journey(legs: [first, second])
        let focus = FocusedJourney(
            tripId: "trip", reverse: false, journey: journey,
            board: BoardData(from: townHall, to: rhodes, journeys: [journey], generatedAt: now - 60_000, source: "live")
        )
        let recorded = [Ride(
            tripId: "trip", reverse: false, departure: journey.departure,
            arrival: journey.effectiveArrival, from: townHall, to: rhodes
        )]
        var firstOnly = journey.scheduledOnly()
        firstOnly.legs[0].estimatedArrival = first.arrival + 60_000
        let firstUpdate = FocusUpdate(
            journey: firstOnly, observedAt: now, live: false, matchedLegIndices: [0]
        )
        let unchangedFinal = focusAfterRefresh(focus, update: firstUpdate, alternatives: nil)
        let confirmed = settledRides(
            recorded,
            focus: unchangedFinal,
            arrived: firstUpdate.canJudgeClock && now >= unchangedFinal.journey.effectiveArrival
        )

        XCTAssertEqual(confirmed, recorded)
        XCTAssertTrue(unchangedFinal.board.offline)

        var finalOnly = journey.scheduledOnly()
        finalOnly.legs[1].estimatedArrival = now + 2 * 60_000
        let finalUpdate = FocusUpdate(
            journey: finalOnly, observedAt: now + 1, live: false, matchedLegIndices: [1]
        )
        let movedFuture = focusAfterRefresh(unchangedFinal, update: finalUpdate, alternatives: nil)
        let withdrawn = settledRides(
            recorded,
            focus: movedFuture,
            arrived: finalUpdate.canJudgeClock && now >= movedFuture.journey.effectiveArrival
        )

        XCTAssertEqual(movedFuture.journey.effectiveArrival, now + 2 * 60_000)
        XCTAssertTrue(withdrawn.isEmpty)
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
