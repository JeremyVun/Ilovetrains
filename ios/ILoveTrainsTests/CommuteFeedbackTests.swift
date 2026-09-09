import Foundation
import XCTest
@testable import ILoveTrains

final class CommuteFeedbackTests: XCTestCase {
    private var fixture: [String: Any]!
    private var epoch: Millis!

    override func setUpWithError() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(
            forResource: "commute-feedback",
            withExtension: "json"
        ))
        fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        epoch = try number(fixture["epochMs"])
    }

    func testSharedRecommendationCases() throws {
        for raw in try dictionaries(fixture["recommendations"]) {
            let caseID = try string(raw["id"])
            let candidates = try dictionaries(raw["journeys"]).map { candidate -> (String, Journey) in
                let candidateID = try string(candidate["id"])
                let legs = try arrays(candidate["legs"]).map { values -> Leg in
                    guard values.count == 3 else { throw FixtureError.invalid }
                    return Leg(
                        line: try string(values[0]), mode: "train", headsign: "Fixture",
                        from: station("from"), to: station("to"),
                        departure: epoch + (try number(values[1])),
                        arrival: epoch + (try number(values[2])),
                        cancelled: candidate["cancelled"] as? Bool ?? false
                    )
                }
                return (candidateID, Journey(legs: legs))
            }
            let selected = selectRecommendation(candidates.map(\.1), now: epoch)
            XCTAssertEqual(candidates.first { $0.1 == selected }?.0, try string(raw["expected"]), caseID)
            XCTAssertEqual(recommendationCost(try XCTUnwrap(selected)), epoch + (try number(raw["expectedCostDelta"])), caseID)
            if let expectedAlternative = raw["alternative"] as? String {
                let wrapped = candidates.map {
                    JourneyRecommendation(
                        journey: $0.1,
                        board: BoardData(from: station("from"), to: station("to"), journeys: [$0.1], generatedAt: epoch)
                    )
                }
                let alternative = earliestAlternative(
                    wrapped, recommended: try XCTUnwrap(selected), now: epoch, modes: allModes, maxTransfers: nil
                )
                XCTAssertEqual(candidates.first { $0.1 == alternative?.journey }?.0, expectedAlternative, caseID)
            }
        }
    }

    func testSharedPreferenceCases() throws {
        for raw in try dictionaries(fixture["preferences"]) {
            let caseID = try string(raw["id"])
            let choice = (raw["choice"] as? String).flatMap(TransferLimit.init(rawValue:)) ?? .two
            let flag = raw["flag"] as? Bool ?? false
            let data = UserData(transferLimit: choice, flags: [transferLimitFlagKey: flag])
            XCTAssertEqual(data.transferLimit.rawValue, try string(raw["expectedChoice"]), caseID)
            XCTAssertEqual(data.requestTransferLimit, optionalInt(raw["expectedCap"]), caseID)
            XCTAssertEqual(data.offlineTransferBound, try int(raw["expectedSolver"]), caseID)
        }
    }

    func testSharedArrivalCases() throws {
        let defaults = try dictionary(fixture["arrivalDefaults"])
        let destination = try station(from: dictionary(fixture["destination"]), id: "destination")
        for raw in try dictionaries(fixture["arrivals"]) {
            let caseID = try string(raw["id"])
            let now = epoch + (try number(raw["nowDelta"]))
            let departure = epoch + (try number(raw["departureDelta"] ?? defaults["departureDelta"]))
            let arrival = epoch + (try number(raw["arrivalDelta"] ?? defaults["arrivalDelta"]))
            let target: Station? = raw.keys.contains("destination")
                ? ((raw["destination"] is NSNull) ? nil : try station(from: dictionary(raw["destination"]), id: "destination"))
                : destination
            let initialGuard = try guardValue(raw.keys.contains("guard") ? raw["guard"] : defaults["guard"])
            let base = ArrivalInput(
                identity: try string(fixture["identity"]),
                departureMs: departure,
                arrivalMs: arrival,
                nowMs: now,
                destination: target,
                guard: initialGuard,
                permissionPending: raw["permissionPending"] as? Bool ?? false,
                legacyCompleted: raw["legacyCompleted"] as? Bool ?? false,
                cancelled: raw["cancelled"] as? Bool ?? false,
                matchingRefresh: raw["matchingRefresh"] as? Bool ?? false,
                resumeWaitUntilMs: try raw["resumeWaitUntilDelta"].map { epoch + (try number($0)) }
            )
            var window: ArrivalWindow?
            var guardState = initialGuard
            for values in try arrays(raw["samples"]) {
                guard values.count >= 4 else { throw FixtureError.invalid }
                let sampleNow = epoch + (try number(values[0]))
                let sample = ArrivalSample(
                    lat: try number(values[1]), lon: try number(values[2]), at: sampleNow,
                    accuracy: try number(values[3]), speed: values.count > 4 ? try number(values[4]) : nil
                )
                var input = base
                input.identity = raw["windowIdentity"] as? String ?? base.identity
                input.nowMs = sampleNow
                input.guard = guardState
                input.window = window
                input.sample = sample
                let next = reduceArrival(input)
                window = next.window
                guardState = next.guard
            }
            var input = base
            input.guard = raw["windowIdentity"] == nil ? guardState : initialGuard
            input.window = window
            let actual = reduceArrival(input)
            XCTAssertEqual(actual.state.rawValue, try string(raw["expectedState"]), caseID)
            XCTAssertEqual(actual.action.rawValue, try string(raw["expectedAction"]), caseID)
            if let basis = raw["expectedBasis"] as? String { XCTAssertEqual(actual.basis?.rawValue, basis, caseID) }
            if let moving = raw["expectedMoving"] as? Bool { XCTAssertEqual(actual.moving, moving, caseID) }
        }
    }

    func testArrivalCorruptionAndOrdinaryCompletionExpiry() {
        let corrupt = reduceArrival(ArrivalInput(
            identity: "one", departureMs: epoch - 100_000, arrivalMs: epoch,
            nowMs: epoch + 100_000,
            guard: ArrivalGuard(armed: true, basis: .location, confirmedAt: epoch + 999_999)
        ))
        XCTAssertNotEqual(corrupt.state, .arrived)
        XCTAssertNil(corrupt.guard?.basis)
        XCTAssertNil(corrupt.guard?.confirmedAt)
        XCTAssertEqual(corrupt.guard?.retainedAt, epoch)

        let legacy = reduceArrival(ArrivalInput(
            identity: "one", departureMs: epoch - 100_000, arrivalMs: epoch,
            nowMs: epoch + 1_800_001, legacyCompleted: true
        ))
        let location = reduceArrival(ArrivalInput(
            identity: "one", departureMs: epoch - 100_000, arrivalMs: epoch,
            nowMs: epoch + 1_800_001,
            guard: ArrivalGuard(armed: true, retainedAt: epoch + 1_800_000, basis: .location, confirmedAt: epoch)
        ))
        XCTAssertEqual(legacy.action, .expire)
        XCTAssertEqual(location.action, .expire)
    }

    func testMalformedStoredGuardPreservesIndependentArmedField() throws {
        let journey = Journey(legs: [Leg(
            line: "T1", mode: "train", headsign: "to", from: station("from"), to: station("to"),
            departure: epoch - 60_000, arrival: epoch
        )])
        let focus = FocusedJourney(
            tripId: "trip", reverse: false, journey: journey,
            board: BoardData(from: station("from"), to: station("to"), journeys: [journey], generatedAt: epoch),
            arrivalGuard: ArrivalGuard(armed: true, retainedAt: epoch - 1_000)
        )
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(focus)) as? [String: Any])
        raw["arrivalGuard"] = ["armed": true, "retainedAt": "bad", "basis": "location", "confirmedAt": "bad"]
        let restored = try JSONDecoder().decode(
            FocusedJourney.self,
            from: JSONSerialization.data(withJSONObject: raw)
        )
        XCTAssertEqual(restored.arrivalGuard?.armed, true)
        XCTAssertNil(restored.arrivalGuard?.retainedAt)
        XCTAssertNil(restored.arrivalGuard?.basis)
        XCTAssertNil(restored.arrivalGuard?.confirmedAt)

        let roundTrip = try JSONDecoder().decode(
            FocusedJourney.self,
            from: JSONEncoder().encode(restored)
        )
        XCTAssertEqual(roundTrip.arrivalGuard, ArrivalGuard(armed: true))
    }

    private func guardValue(_ raw: Any?) throws -> ArrivalGuard? {
        guard let raw, !(raw is NSNull) else { return nil }
        let value = try dictionary(raw)
        return ArrivalGuard(
            armed: value["armed"] as? Bool,
            retainedAt: try value["retainedDelta"].map { epoch + (try number($0)) },
            basis: (value["basis"] as? String).flatMap(ArrivalBasis.init(rawValue:)),
            confirmedAt: try value["confirmedDelta"].map { epoch + (try number($0)) }
        )
    }

    private func station(_ id: String) -> Station { Station(id: id, name: id) }

    private func station(from raw: [String: Any], id: String) throws -> Station {
        Station(id: id, name: id, lat: try number(raw["lat"]), lon: try number(raw["lon"]))
    }

    private func dictionaries(_ raw: Any?) throws -> [[String: Any]] {
        try values(raw).map(dictionary)
    }

    private func arrays(_ raw: Any?) throws -> [[Any]] {
        try values(raw).map { raw in
            guard let value = raw as? [Any] else { throw FixtureError.invalid }
            return value
        }
    }

    private func values(_ raw: Any?) throws -> [Any] {
        guard let value = raw as? [Any] else { throw FixtureError.invalid }
        return value
    }

    private func dictionary(_ raw: Any?) throws -> [String: Any] {
        guard let value = raw as? [String: Any] else { throw FixtureError.invalid }
        return value
    }

    private func string(_ raw: Any?) throws -> String {
        guard let value = raw as? String else { throw FixtureError.invalid }
        return value
    }

    private func number(_ raw: Any?) throws -> Double {
        guard let value = raw as? NSNumber else { throw FixtureError.invalid }
        return value.doubleValue
    }

    private func int(_ raw: Any?) throws -> Int { Int(try number(raw)) }

    private func optionalInt(_ raw: Any?) -> Int? {
        guard let value = raw as? NSNumber else { return nil }
        return value.intValue
    }
}

private enum FixtureError: Error { case invalid }
