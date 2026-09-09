import Foundation
import XCTest
@testable import ILoveTrains

final class TravelTrackerStateTests: XCTestCase {
    private let minute: Millis = 60_000

    func testAcceptedPresentationCasesMatchTheSharedFixture() throws {
        let root = try fixture()
        let base = root["base"] as! [String: Any]
        for item in root["cases"] as! [[String: Any]] {
            let expected = item["expected"] as! [String: Any]
            let now = number(item, "now")
            let state = try XCTUnwrap(TravelTrackerState.derive(
                focus: fixtureFocus(root: root, base: base, item: item), now: now, generation: 7
            ))
            let name = item["name"] as! String

            XCTAssertEqual(state.stage.rawValue, expected["stage"] as? String, name)
            XCTAssertEqual(state.activeLegIndex, int(expected, "activeLeg"), name)
            XCTAssertEqual(state.event.name, expected["eventName"] as? String, name)
            XCTAssertEqual(state.event.countdownMinutes, int(expected, "countdown"), name)
            XCTAssertEqual(state.event.deadline, state.nextBoundary, name)
            XCTAssertEqual(state.headline.lead, expected["headlineLead"] as? String, name)
            XCTAssertEqual(state.headline.emphasis, expected["headlineEmphasis"] as? String, name)
            XCTAssertEqual(state.instruction, expected["instruction"] as? String, name)
            XCTAssertEqual(state.connection, expected["connection"] as? String, name)
            XCTAssertEqual(state.destination, expected["destination"] as? String, name)
            XCTAssertEqual(state.etaText, expected["eta"] as? String, name)
            XCTAssertEqual(state.tightConnection, expected["tight"] as? Bool, name)
            XCTAssertEqual(state.freshness.rawValue, expected["freshness"] as? String, name)
            XCTAssertEqual(state.provenance, expected["provenance"] as? String, name)
            XCTAssertEqual(
                state.platforms.map { "\($0.role.rawValue):\($0.label)" },
                expected["platforms"] as? [String], name
            )
            XCTAssertEqual(
                state.segments.map { Int(($0.end - $0.start) / minute) },
                (expected["segmentsMinutes"] as! [NSNumber]).map(\.intValue), name
            )
            XCTAssertEqual(
                state.progress,
                number(expected, "progressNumerator") / number(expected, "progressDenominator"),
                accuracy: 0.000_001, name
            )
            if state.freshness == .live { XCTAssertEqual(state.freshUntil, now + 90_000, name) }
            else { XCTAssertNil(state.freshUntil, name) }
        }
    }

    func testIdentityAndGenerationRejectReplacementFocusAndLatePublication() throws {
        let focus = twoLegFocus()
        let original = try XCTUnwrap(TravelTrackerState.derive(focus: focus, now: 6 * minute, generation: 4))
        XCTAssertEqual(original.revision.identity.serviceKey, "T1:300000|M2:1500000")
        var realtime = focus
        realtime.journey.legs = realtime.journey.legs.enumerated().map { index, leg in
            var leg = leg
            leg.estimatedDeparture = leg.departure + minute
            leg.estimatedArrival = leg.arrival + minute
            if index == 1 { leg.fromPlatform = "9" }
            return leg
        }
        let updated = try XCTUnwrap(TravelTrackerState.derive(focus: realtime, now: 6 * minute, generation: 5))
        XCTAssertEqual(original.revision.identity, updated.revision.identity)
        XCTAssertTrue(updated.revision.canReplace(original.revision))
        XCTAssertFalse(original.revision.canReplace(updated.revision))

        var replacement = realtime
        replacement.journey.legs[0].line = "T2"
        let replacementState = try XCTUnwrap(TravelTrackerState.derive(focus: replacement, now: 6 * minute, generation: 6))
        XCTAssertFalse(replacementState.revision.canReplace(updated.revision))
        var reverse = realtime
        reverse.reverse = true
        XCTAssertFalse(try XCTUnwrap(TravelTrackerState.derive(
            focus: reverse, now: 6 * minute, generation: 6
        )).revision.canReplace(updated.revision))

        var differentDeparture = realtime
        differentDeparture.journey.legs[0].departure += minute
        let departureState = try XCTUnwrap(TravelTrackerState.derive(focus: differentDeparture, now: 6 * minute, generation: 6))
        XCTAssertFalse(departureState.revision.canReplace(updated.revision))
    }

    func testRetainedDelayNeverFallsBackAndFutureSourceNeverBecomesFreshOnRender() throws {
        var focus = twoLegFocus()
        focus.journey.retained = true
        focus.journey.legs = focus.journey.legs.map { leg in
            var leg = leg
            leg.estimatedDeparture = leg.departure + 5 * minute
            leg.estimatedArrival = leg.arrival + 5 * minute
            return leg
        }
        focus.board.journeys = [focus.journey]
        focus.board.generatedAt = minute
        let state = try XCTUnwrap(TravelTrackerState.derive(focus: focus, now: 11 * minute, generation: 1))
        XCTAssertEqual(state.stage, .ride)
        XCTAssertEqual(state.event.countdownMinutes, 9)
        XCTAssertEqual(state.eta, 45 * minute)
        XCTAssertEqual(state.freshness, .retained)
        XCTAssertNil(state.freshUntil)

        focus.journey.retained = false
        focus.board.generatedAt = 12 * minute
        let future = try XCTUnwrap(TravelTrackerState.derive(focus: focus, now: 11 * minute, generation: 1))
        XCTAssertEqual(future.freshness, .stale)
        XCTAssertNil(future.freshUntil)
    }

    func testCancellationStaysOnChosenIdentityAndSeparatesFinalArrivalCancellation() throws {
        let focus = twoLegFocus()
        var cancelled = focus
        cancelled.journey.legs[1].cancelled = true
        let state = try XCTUnwrap(TravelTrackerState.derive(focus: cancelled, now: 6 * minute, generation: 1))
        XCTAssertEqual(state.revision.identity.serviceKey, focus.journey.key)
        XCTAssertEqual(state.event.kind, .cancellation)
        XCTAssertEqual(state.headline.text, "M2 cancelled")
        XCTAssertEqual(state.instruction, "10:25 from Change cancelled.")
        XCTAssertTrue(state.cancelled)
        XCTAssertTrue(state.arrivalCancelled)
        XCTAssertNil(state.connection)

        var firstCancelled = focus
        firstCancelled.journey.legs[0].cancelled = true
        XCTAssertFalse(try XCTUnwrap(TravelTrackerState.derive(
            focus: firstCancelled, now: 6 * minute, generation: 1
        )).arrivalCancelled)
    }

    func testMidnightMultipleLegWalkingHandoffAndNegativeWaitUseTimelinePositions() throws {
        let beforeMidnight: Millis = 1_788_875_880_000
        let trainHub = Station(id: "train-hub", name: "Circular Quay")
        let ferryStop = Station(id: "ferry-stop", name: "Circular Quay")
        let legs = [
            Leg(line: "T2", mode: "train", headsign: "City", from: Station(id: "a", name: "Alpha Station"), to: trainHub,
                departure: beforeMidnight, arrival: beforeMidnight + 5 * minute, toPlatform: "1"),
            Leg(line: "F1", mode: "ferry", headsign: "Barangaroo", from: ferryStop, to: Station(id: "wharf", name: "Barangaroo Wharf"),
                departure: beforeMidnight + 8 * minute, arrival: beforeMidnight + 12 * minute,
                fromPlatform: "Wharf 2", toPlatform: "Side A"),
            Leg(line: "M1", mode: "metro", headsign: "Tallawong", from: Station(id: "metro-a", name: "Barangaroo Station"),
                to: Station(id: "z", name: "Final Station"), departure: beforeMidnight + 14 * minute,
                arrival: beforeMidnight + 19 * minute, fromPlatform: "3", toPlatform: "4")
        ]
        let state = try XCTUnwrap(TravelTrackerState.derive(focus: makeFocus(legs), now: beforeMidnight + minute, generation: 1))
        XCTAssertEqual(state.event.countdownMinutes, 4)
        XCTAssertEqual(state.platforms.map(\.label), ["Platform 1", "Wharf 2"])
        XCTAssertEqual(state.platforms.map(\.stationId), ["train-hub", "ferry-stop"])
        XCTAssertEqual(state.segments.map(\.mode), ["train", nil, "ferry", nil, "metro"])
        XCTAssertEqual(state.segments.map { Int(($0.end - $0.start) / minute) }, [5, 3, 4, 2, 5])

        let overlap = [
            withTimes(legs[0], departure: 0, arrival: 10 * minute),
            withTimes(legs[1], departure: 8 * minute, arrival: 20 * minute)
        ]
        let duringFirst = try XCTUnwrap(TravelTrackerState.derive(focus: makeFocus(overlap), now: 9 * minute, generation: 1))
        XCTAssertEqual(duringFirst.stage, .ride)
        XCTAssertEqual(duringFirst.connection, "F1 departs 10:08 before arrival")
        XCTAssertEqual(duringFirst.instruction, "Get off on Platform 1.")
        XCTAssertEqual(duringFirst.platforms.map(\.role), [.alight])
        XCTAssertFalse(duringFirst.tightConnection)
        XCTAssertEqual(duringFirst.etaText, "Planned 10:20")
        XCTAssertEqual(duringFirst.missedConnection?.fromLegIndex, 0)
        XCTAssertEqual(duringFirst.missedConnection?.toLegIndex, 1)
        XCTAssertEqual(duringFirst.missedConnection?.arrivalStationId, "train-hub")
        XCTAssertEqual(duringFirst.missedConnection?.departureStationId, "ferry-stop")
        XCTAssertEqual(duringFirst.segments[1].lengthFraction, 0)
        XCTAssertLessThan(duringFirst.segments[1].endFraction, duringFirst.segments[1].startFraction)
        let afterFirst = try XCTUnwrap(TravelTrackerState.derive(focus: makeFocus(overlap), now: 10 * minute, generation: 1))
        XCTAssertEqual(afterFirst.stage, .missedTransfer)
        XCTAssertEqual(afterFirst.activeLegIndex, 0)
        XCTAssertEqual(afterFirst.event.kind, .missedConnection)
        XCTAssertNil(afterFirst.event.countdownMinutes)
        XCTAssertEqual(afterFirst.headline.text, "F1 connection unavailable")
        XCTAssertEqual(afterFirst.instruction, "F1 departure 10:08 is before the 10:10 arrival.")
        XCTAssertTrue(afterFirst.platforms.isEmpty)
        XCTAssertFalse(afterFirst.tightConnection)
        XCTAssertEqual(afterFirst.nextBoundary, 20 * minute)
        XCTAssertNil(TravelTrackerState.derive(focus: makeFocus(overlap), now: 20 * minute, generation: 1))

        var lateEarlierLeg = overlap
        lateEarlierLeg[0].arrival = 25 * minute
        let stillRiding = try XCTUnwrap(TravelTrackerState.derive(focus: makeFocus(lateEarlierLeg), now: 21 * minute, generation: 1))
        XCTAssertEqual(stillRiding.stage, .ride)
        XCTAssertEqual(stillRiding.nextBoundary, 25 * minute)
        XCTAssertEqual(stillRiding.progress, 21.0 / 25.0, accuracy: 0.000_001)
        XCTAssertEqual(stillRiding.segments[0].endFraction, 1, accuracy: 0.000_001)
        XCTAssertEqual(try XCTUnwrap(stillRiding.segments.last).endFraction, 20.0 / 25.0, accuracy: 0.000_001)
        XCTAssertNil(TravelTrackerState.derive(focus: makeFocus(lateEarlierLeg), now: 25 * minute, generation: 1))
    }

    func testFerryVocabularyPrintedMinuteBoundaryLongDisplayBoardingAndCompletion() throws {
        let ferryLeg = Leg(line: "F1", mode: "ferry", headsign: "Circular Quay",
            from: Station(id: "a", name: "Barangaroo Wharf"), to: Station(id: "b", name: "Balmain Wharf"),
            departure: 0, arrival: 10 * minute, fromPlatform: "Wharf 4, Side B", toPlatform: "Side A")
        let ferry = makeFocus([ferryLeg])
        let final = try XCTUnwrap(TravelTrackerState.derive(focus: ferry, now: minute, generation: 1))
        XCTAssertEqual(final.instruction, "Get off at Side A.")
        XCTAssertEqual(final.platforms.map(\.label), ["Side A"])

        var named = ferry
        named.journey.legs[0].toPlatform = "Balmain Wharf"
        XCTAssertEqual(try XCTUnwrap(TravelTrackerState.derive(focus: named, now: minute, generation: 1)).instruction,
                       "Get off at Balmain Wharf.")

        var seconds = ferryLeg
        seconds.mode = "train"; seconds.line = "T1"; seconds.arrival = 10 * minute + 1_000
        let boundary = try XCTUnwrap(TravelTrackerState.derive(focus: makeFocus([seconds]), now: 5 * minute + 59_000, generation: 1))
        XCTAssertEqual(boundary.event.countdownMinutes, 5)
        XCTAssertEqual(boundary.headline.emphasis, "5 min.")

        seconds.arrival = 120 * minute
        let long = try XCTUnwrap(TravelTrackerState.derive(focus: makeFocus([seconds]), now: 1_000, generation: 1))
        XCTAssertEqual(long.event.countdownMinutes, 120)
        XCTAssertEqual(long.headline.emphasis, "2 hr.")

        var delayed = twoLegFocus()
        delayed.journey.legs[0].estimatedDeparture = 8 * minute
        let boarding = try XCTUnwrap(TravelTrackerState.derive(focus: delayed, now: 6 * minute, generation: 1))
        XCTAssertEqual(boarding.stage, .boarding)
        XCTAssertEqual(boarding.headline.text, "T1 leaves in 2 min.")
        XCTAssertEqual(boarding.nextBoundary, 8 * minute)
        XCTAssertNil(TravelTrackerState.derive(focus: delayed, now: delayed.journey.effectiveArrival, generation: 1))
    }

    func testGuardedArrivalKeepsTrackerActiveWithUnconfirmedCopy() throws {
        let focus = twoLegFocus()
        let checking = try XCTUnwrap(TravelTrackerState.derive(
            focus: focus,
            now: focus.journey.effectiveArrival,
            generation: 1,
            arrivalState: .checkingArrival
        ))
        let moving = try XCTUnwrap(TravelTrackerState.derive(
            focus: focus,
            now: focus.journey.effectiveArrival + minute,
            generation: 2,
            arrivalState: .arrivalUnconfirmed,
            arrivalMoving: true
        ))
        let stopped = try XCTUnwrap(TravelTrackerState.derive(
            focus: focus,
            now: focus.journey.effectiveArrival + minute,
            generation: 3,
            arrivalState: .arrivalUnconfirmed
        ))

        XCTAssertEqual(checking.headline.text, "Checking arrival")
        XCTAssertEqual(checking.instruction, "Checking arrival at Finish.")
        XCTAssertEqual(moving.headline.text, "Arrival uncertain")
        XCTAssertEqual(moving.instruction, "Still on the way to Finish.")
        XCTAssertEqual(stopped.headline.text, "Arrival unconfirmed")
        XCTAssertEqual(stopped.instruction, "Arrival time needs an update.")
        XCTAssertEqual(stopped.etaText, "Last estimate 10:40")
        XCTAssertEqual(stopped.connection, "Last estimate 10:40")
        XCTAssertNil(stopped.event.countdownMinutes)
    }

    func testCancellationAfterEstimateDoesNotBecomeTrackerCompletion() throws {
        var focus = twoLegFocus()
        focus.journey.legs[0].cancelled = true
        let state = try XCTUnwrap(TravelTrackerState.derive(
            focus: focus, now: focus.journey.effectiveArrival + 60_000,
            generation: 1, arrivalState: .travelling
        ))
        XCTAssertTrue(state.cancelled)
        XCTAssertEqual(state.event.kind, .cancellation)
    }

    private func twoLegFocus() -> FocusedJourney {
        makeFocus([
            Leg(line: "T1", mode: "train", headsign: "Change", from: Station(id: "a", name: "Start Station"),
                to: Station(id: "b", name: "Change Station"), departure: 5 * minute, arrival: 15 * minute,
                fromPlatform: "1", toPlatform: "2"),
            Leg(line: "M2", mode: "metro", headsign: "Finish", from: Station(id: "b", name: "Change Station"),
                to: Station(id: "c", name: "Finish Station"), departure: 25 * minute, arrival: 40 * minute,
                fromPlatform: "3", toPlatform: "4")
        ])
    }

    private func makeFocus(_ legs: [Leg]) -> FocusedJourney {
        let journey = Journey(legs: legs)
        let board = BoardData(from: legs[0].from, to: legs[legs.count - 1].to,
                              journeys: [journey], generatedAt: 6 * minute, source: "live")
        return FocusedJourney(tripId: "trip", reverse: false, journey: journey, board: board, pinned: false)
    }

    private func withTimes(_ value: Leg, departure: Millis, arrival: Millis) -> Leg {
        var result = value; result.departure = departure; result.arrival = arrival; return result
    }

    private func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: TravelTrackerStateTests.self).url(forResource: "travel-tracker", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func fixtureFocus(root: [String: Any], base: [String: Any], item: [String: Any]) -> FocusedJourney {
        let rawLegs = base["legs"] as! [[String: Any]]
        let baseChange = (rawLegs[0]["to"] as! [String: Any])["name"] as! String
        let changeName = item["changeName"] as? String ?? baseChange
        let legs = rawLegs.enumerated().map { index, raw -> Leg in
            func station(_ key: String) -> Station {
                let value = raw[key] as! [String: Any]
                let changed = (index == 0 && key == "to") || (index == 1 && key == "from")
                return Station(id: value["id"] as! String, name: changed ? changeName : value["name"] as! String)
            }
            let finalPlatform: String? = index == 1 && item.keys.contains("finalPlatform")
                ? item["finalPlatform"] as? String : raw["toPlatform"] as? String
            return Leg(
                line: raw["line"] as! String, mode: raw["mode"] as! String, headsign: raw["headsign"] as! String,
                from: station("from"), to: station("to"),
                departure: index == 1 && item["onwardDeparture"] != nil ? number(item, "onwardDeparture") : number(raw, "departure"),
                arrival: number(raw, "arrival"), fromPlatform: raw["fromPlatform"] as? String, toPlatform: finalPlatform
            )
        }
        let journey = Journey(legs: legs, retained: item["retained"] as? Bool)
        let generatedAt = item["generatedAt"].map { ($0 as! NSNumber).doubleValue } ?? number(item, "now")
        let board = BoardData(from: legs[0].from, to: legs[legs.count - 1].to, journeys: [journey], generatedAt: generatedAt,
                              source: base["source"] as! String, offline: item["offline"] as? Bool ?? false)
        return FocusedJourney(tripId: root["tripId"] as! String, reverse: root["reverse"] as! Bool,
                              journey: journey, board: board, pinned: false)
    }

    private func number(_ value: [String: Any], _ key: String) -> Double { (value[key] as! NSNumber).doubleValue }
    private func int(_ value: [String: Any], _ key: String) -> Int { (value[key] as! NSNumber).intValue }
}
