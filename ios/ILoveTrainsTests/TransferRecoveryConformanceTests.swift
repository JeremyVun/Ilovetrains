import Foundation
import XCTest
@testable import ILoveTrains

final class TransferRecoveryConformanceTests: XCTestCase {
    private let keys = [
        "followedChanges", "composedChanges", "recoveryAnchor", "search", "candidate", "composed",
        "status", "pinIcon", "changeLabels", "receipt", "instruction", "arrival", "figure",
        "provenance", "alert",
    ].sorted()

    func testEveryTransferRecoveryCaseCarriesTheWholeSeam() throws {
        let root = try fixture()
        XCTAssertTrue((root["notes"] as! String).contains("printed clock minutes"))
        XCTAssertGreaterThanOrEqual(((root["base"] as! [String: Any])["legs"] as! [Any]).count, 2)
        let cases = root["cases"] as! [[String: Any]]
        XCTAssertEqual(cases.count, 20)
        for item in cases {
            let name = item["name"] as! String
            XCTAssertNotNil(item["now"] as? NSNumber, name)
            XCTAssertNotNil(item["fresh"] as? Bool, name)
            XCTAssertTrue(["focus", "inferred"].contains(item["by"] as! String), name)
            XCTAssertNotNil(item["searches"] as? [Any], name)
            XCTAssertEqual((item["expected"] as! [String: Any]).keys.sorted(), keys, name)
        }
    }

    func testEveryCaseDerivesTheSharedSeam() throws {
        let root = try fixture()
        for item in root["cases"] as! [[String: Any]] {
            let name = item["name"] as! String
            let now = number(item, "now")
            let expected = item["expected"] as! [String: Any]
            let searches = self.searches(item)
            let focus = self.focus(root: root, item: item, searches: searches)

            let plan = recoveryPlan(focus)
            XCTAssertEqual(plan.followedStates.map(\.rawValue), expected["followedChanges"] as! [String], name)
            XCTAssertEqual(plan.search?.anchor, expected["recoveryAnchor"] as? Int, name)
            let searchId = plan.search.flatMap { search in
                searches.first { $0.value.from == search.from.id && $0.value.at == search.at }?.key
            }
            XCTAssertEqual(searchId, expected["search"] as? String, name)

            let journeys = searchId.map { searches[$0]!.journeys } ?? []
            let candidate = plan.search.flatMap { recoveryCandidate(journeys, arrival: $0.at, modes: allModes) }
            XCTAssertEqual(candidate.flatMap { hit in journeys.firstIndex { $0.key == hit.key } },
                           expected["candidate"] as? Int, name)

            var settled = focus
            settled.recovery = recoveryRecord(
                plan: plan, held: focus.recovery, journeys: journeys, modes: allModes,
                fetchedAt: now, source: RecoverySource(generatedAt: now, degraded: false)
            )
            let after = recoveryPlan(settled)
            let composed = expected["composed"] as! [[String: Any]]
            XCTAssertEqual(after.composedStates.map(\.rawValue), expected["composedChanges"] as! [String], name)
            XCTAssertEqual(after.composed.legs.map(\.line), composed.map { $0["line"] as! String }, name)
            XCTAssertEqual(after.composed.legs.map(\.departure), composed.map { number($0, "scheduledDeparture") }, name)

            XCTAssertEqual(focusStatus(settled, plan: after, now: now, complete: false).uppercased(),
                           expected["status"] as! String, name)
            XCTAssertEqual(focusStatusPresentation(settled, now: now, complete: false).pinIcon,
                           expected["pinIcon"] as! Bool, name)
            XCTAssertEqual(
                after.composed.legs.indices.dropLast().map {
                    axisChangeLabel(after.composed, index: $0, recoveryChangeIndex: after.recoveryChangeIndex)
                },
                expected["changeLabels"] as! [String], name
            )
            XCTAssertEqual(focusReceipt(settled, plan: after, now: now) ?? "", expected["receipt"] as! String, name)
            XCTAssertEqual(focusedInstruction(after, now: now), expected["instruction"] as! String, name)

            let clocks = focusArrivalClocks(after, followed: settled.journey)
            let arrival = expected["arrival"] as! [String: String]
            XCTAssertEqual(clocks.shown, arrival["shown"], name)
            XCTAssertEqual(clocks.struck, arrival["struck"], name)
            XCTAssertEqual(clocks.planned, arrival["planned"], name)

            let figure = directionFigureFor(after.composed, now: now)
            XCTAssertEqual(figure?.value, expected["figure"] as? String, name)
            XCTAssertEqual(figure?.provenance.uppercased(), expected["provenance"] as? String, name)

            XCTAssertEqual(deliveredCue(settled, item: item, now: now)?.rawValue, expected["alert"] as? String, name)
        }
    }

    private func deliveredCue(_ focus: FocusedJourney, item: [String: Any], now: Millis) -> TravelTrackerCue.Kind? {
        // The first observation of a generation only records the baseline, so a case without one never cues.
        guard let previous = item["previous"] as? [String: Any] else { return nil }
        let baseline = TravelTrackerCueBaseline(
            arrivalDelay: int(previous, "arrivalDelay"),
            changeStates: (previous["composedChanges"] as! [String]).map { ConnectionState(rawValue: $0)! }
        )
        guard let state = TravelTrackerState.derive(focus: focus, now: now, generation: 1) else { return nil }
        return TravelTrackerCue.pending(state: state, focus: focus, now: now, previous: baseline)
            .min { $0.kind.priority < $1.kind.priority }?.kind
    }

    private func focus(root: [String: Any], item: [String: Any], searches: [String: Search]) -> FocusedJourney {
        let base = root["base"] as! [String: Any]
        var legs = ((item["legs"] as? [[String: Any]]) ?? (base["legs"] as! [[String: Any]])).map(leg)
        for estimate in item["estimates"] as? [[String: Any]] ?? [] {
            let index = int(estimate, "leg")
            if let departure = estimate["departure"] as? NSNumber { legs[index].estimatedDeparture = departure.doubleValue }
            if let arrival = estimate["arrival"] as? NSNumber { legs[index].estimatedArrival = arrival.doubleValue }
        }
        for index in item["cancelledLegs"] as? [Int] ?? [] { legs[index].cancelled = true }
        let now = number(item, "now")
        let journey = Journey(legs: legs)
        let board = BoardData(
            from: legs[0].from, to: legs[legs.count - 1].to, journeys: [journey],
            generatedAt: (item["fresh"] as! Bool) ? now : now - 600_000,
            source: base["source"] as! String
        )
        var focus = FocusedJourney(
            tripId: root["tripId"] as! String, reverse: root["reverse"] as! Bool,
            journey: journey, board: board, pinned: (item["by"] as! String) == "focus"
        )
        if let held = item["heldRecovery"] as? [String: Any] {
            let search = searches[held["search"] as! String]!
            focus.recovery = RecoveryRecord(
                changeIndex: int(held, "changeIndex"),
                journey: search.journeys[int(held, "journey")],
                fetchedAt: now - 60_000,
                source: RecoverySource(generatedAt: now - 60_000, degraded: false)
            )
        }
        return focus
    }

    private struct Search {
        var from: String
        var at: Millis
        var journeys: [Journey]
    }

    private func searches(_ item: [String: Any]) -> [String: Search] {
        var result: [String: Search] = [:]
        for raw in item["searches"] as! [[String: Any]] {
            result[raw["id"] as! String] = Search(
                from: raw["from"] as! String,
                at: number(raw, "at"),
                journeys: (raw["journeys"] as! [[String: Any]]).map {
                    Journey(legs: ($0["legs"] as! [[String: Any]]).map(leg))
                }
            )
        }
        return result
    }

    private func leg(_ raw: [String: Any]) -> Leg {
        func station(_ key: String) -> Station {
            let value = raw[key] as! [String: Any]
            return Station(id: value["id"] as! String, name: value["name"] as! String)
        }
        let departure = raw["departure"] as! [String: Any]
        let arrival = raw["arrival"] as! [String: Any]
        return Leg(
            line: raw["line"] as! String, mode: raw["mode"] as! String, headsign: raw["headsign"] as! String,
            from: station("from"), to: station("to"),
            departure: number(departure, "scheduled"), arrival: number(arrival, "scheduled"),
            estimatedDeparture: (departure["estimated"] as? NSNumber)?.doubleValue,
            estimatedArrival: (arrival["estimated"] as? NSNumber)?.doubleValue,
            fromPlatform: (raw["from"] as! [String: Any])["platform"] as? String,
            toPlatform: (raw["to"] as! [String: Any])["platform"] as? String,
            cancelled: raw["cancelled"] as? Bool ?? false
        )
    }

    private func fixture() throws -> [String: Any] {
        let url = try XCTUnwrap(Bundle(for: TransferRecoveryConformanceTests.self)
            .url(forResource: "transfer-recovery", withExtension: "json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    private func number(_ value: [String: Any], _ key: String) -> Double { (value[key] as! NSNumber).doubleValue }
    private func int(_ value: [String: Any], _ key: String) -> Int { (value[key] as! NSNumber).intValue }
}
