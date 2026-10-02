import Foundation
import XCTest
@testable import ILoveTrains

/// Runs every case of the web-authored inference.json in each section's `run` order.
final class InferenceConformanceTests: XCTestCase {
    private var fixture: [String: Any]!

    override func setUpWithError() throws {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "inference", withExtension: "json"))
        fixture = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
    }

    func testHoldCases() throws {
        let cases = try section("holdCases")
        XCTAssertEqual(cases.count, 15)
        for raw in cases {
            let name = try XCTUnwrap(raw["name"] as? String)
            let now = try number(raw["nowMs"])
            let data = try userData(dictionary(raw["doc"]))
            let incoming = try record(dictionary(raw["incoming"]), at: now)
            let replaced = replacesLastAnswer(data: data, incoming: incoming, now: now, sightingAt: raw["sightingAt"] as? Double)
            XCTAssertEqual(replaced ? "incoming" : "stored", raw["expectedKept"] as? String, name)
        }
    }

    func testEntryCases() throws {
        let cases = try section("entryCases")
        XCTAssertEqual(cases.count, 47)
        for raw in cases {
            let name = try XCTUnwrap(raw["name"] as? String)
            let now = try number(raw["nowMs"])
            var data = try userData(dictionary(raw["doc"]))
            var snapshot = try (raw["snapshot"] as? [String: Any]).map { try record($0) }
            for write in try (raw["writes"] as? [[String: Any]] ?? []) {
                let at = try number(write["nowMs"])
                let incoming = try record(dictionary(write["record"]), at: at)
                let sightingAt = write["sightingAt"] as? Double
                if retiresSnapshot(data: data, snapshot: snapshot, incoming: incoming, sightingAt: sightingAt) { snapshot = nil }
                if replacesLastAnswer(data: data, incoming: incoming, now: at, sightingAt: sightingAt) {
                    data.lastAnswer = incoming
                }
            }
            let fix = try self.fix(dictionary(raw["fix"]))
            let previousFix = try (raw["previousFix"] as? [String: Any]).map { try self.fix($0) }
            let cached = try journeys(raw["cached"])
            let boards = try journeys(raw["boards"]).mapValues { journeys in
                BoardData(from: journeys[0].legs[0].from, to: journeys[0].legs[journeys[0].legs.count - 1].to,
                          journeys: journeys, generatedAt: now, source: "live")
            }

            var entered: (via: String, focus: FocusedJourney)?
            if let focus = inferFromRecords(data: data, snapshot: snapshot, fix: fix, now: now) {
                entered = ("platform", focus)
            } else {
                if let expected = raw["expectedRequests"] as? [[String: Any]] {
                    let requests = onBoardRequests(data: data, now: now, fix: fix, previousFix: previousFix, cached: cached)
                    XCTAssertEqual(requests.map(describe), try expected.map(describe), name)
                }
                if trainSpeed(fix, previous: previousFix),
                   let focus = inferOnBoard(data: data, now: now, fix: fix, previousFix: previousFix, boards: boards, cached: cached) {
                    entered = ("onBoard", focus)
                }
            }

            guard let expected = raw["expected"] as? [String: Any] else {
                XCTAssertNil(entered?.focus.journey.key, name)
                continue
            }
            XCTAssertEqual(entered?.via, expected["via"] as? String, name)
            XCTAssertEqual(entered?.focus.tripId, expected["tripId"] as? String, name)
            XCTAssertEqual(entered?.focus.reverse, (expected["direction"] as? String) == "reverse", name)
            XCTAssertEqual(entered?.focus.pinned, false, name)
            XCTAssertEqual(entered?.focus.journey.key, try journeyKey(expected["journeyKey"]), name)
        }
    }

    func testStopCases() throws {
        let cases = try section("stopCases")
        XCTAssertEqual(cases.count, 6)
        for raw in cases {
            let name = try XCTUnwrap(raw["name"] as? String)
            let now = try number(raw["nowMs"])
            var data = try userData(dictionary(raw["doc"]))
            let focus = try dictionary(raw["focus"])
            let journey = try TransitWire.journey(dictionary(focus["journey"]))
            data.focus = FocusedJourney(
                tripId: try XCTUnwrap(focus["tripId"] as? String), reverse: focus["direction"] as? String == "reverse",
                journey: journey, board: board(journey), pinned: focus["by"] as? String != "inferred"
            )
            XCTAssertNotNil(data.lastAnswer, name)

            let stopped = try XCTUnwrap(stoppedTrip(data, at: now), name)

            XCTAssertNil(stopped.data.focus, name)
            XCTAssertNil(stopped.data.lastAnswer, name)
            XCTAssertEqual(stopped.declinedInferred, try XCTUnwrap(raw["expectedEvent"] as? Bool), name)
            let expected = try (raw["expectedDecline"] as? [String: Any]).map { decline in
                InferenceDecline(
                    tripId: try XCTUnwrap(decline["tripId"] as? String), reverse: decline["direction"] as? String == "reverse",
                    at: try number(decline["at"]), departure: try nativeDepartureKey(decline["departure"]),
                    arrival: try number(decline["arrival"])
                )
            }
            XCTAssertEqual(stopped.data.inferenceDeclined, expected, name)
        }
    }

    func testStartCases() throws {
        let cases = try section("startCases")
        XCTAssertEqual(cases.count, 6)
        for raw in cases {
            let name = try XCTUnwrap(raw["name"] as? String)
            let journey = try TransitWire.journey(dictionary(raw["journey"]))
            XCTAssertEqual(startable(journey, now: try number(raw["nowMs"])), try XCTUnwrap(raw["expectedStartable"] as? Bool), name)
        }
    }

    func testRunningCases() throws {
        let cases = try section("runningCases")
        XCTAssertEqual(cases.count, 7)
        for raw in cases {
            let name = try XCTUnwrap(raw["name"] as? String)
            let journey = try TransitWire.journey(dictionary(raw["journey"]))
            var data = UserData()
            if let modes = raw["enabledModes"] as? [String] { data.modes = Set(modes) }
            XCTAssertEqual(onItsWay(journey, now: try number(raw["nowMs"]), data: data), try XCTUnwrap(raw["expectedRunning"] as? Bool), name)
        }
    }

    private func section(_ name: String) throws -> [[String: Any]] {
        let value = try dictionary(fixture[name])
        XCTAssertNotNil(value["run"] as? String)
        return try XCTUnwrap(value["cases"] as? [[String: Any]])
    }

    private func userData(_ doc: [String: Any]) throws -> UserData {
        let rows = { (key: String) in doc[key] as? [[String: Any]] ?? [] }
        let preferences = doc["preferences"] as? [String: Any] ?? [:]
        var data = UserData(
            trips: try rows("trips").map { trip in
                SavedTrip(id: try XCTUnwrap(trip["id"] as? String), from: try TransitWire.station(dictionary(trip["from"])),
                          to: try TransitWire.station(dictionary(trip["to"])), createdAt: TransitWire.epoch(trip["createdAt"]) ?? 0)
            },
            history: try rows("history").map { event in
                ViewEvent(tripId: try XCTUnwrap(event["tripId"] as? String), reverse: event["direction"] as? String == "reverse",
                          at: try XCTUnwrap(TransitWire.epoch(event["t"])))
            },
            rides: try rows("rides").map { ride in
                Ride(tripId: try XCTUnwrap(ride["tripId"] as? String), reverse: ride["direction"] as? String == "reverse",
                     departure: try XCTUnwrap(TransitWire.epoch(ride["scheduledDeparture"] ?? ride["departedAt"])),
                     arrival: try XCTUnwrap(TransitWire.epoch(ride["arrivedAt"])))
            },
            lastAnswer: try (doc["lastOpen"] as? [String: Any]).map { try record($0) },
            useLocation: preferences["useLocation"] as? Bool ?? true
        )
        if let modes = preferences["enabledModes"] as? [String] { data.modes = Set(modes) }
        if let focus = doc["focus"] as? [String: Any] {
            let journey = try TransitWire.journey(dictionary(focus["journey"]))
            data.focus = FocusedJourney(
                tripId: try XCTUnwrap(focus["tripId"] as? String), reverse: focus["direction"] as? String == "reverse",
                journey: journey, board: board(journey), pinned: focus["by"] as? String != "inferred"
            )
        }
        if let decline = doc["inferenceDeclined"] as? [String: Any] {
            data.inferenceDeclined = InferenceDecline(
                tripId: try XCTUnwrap(decline["tripId"] as? String), reverse: decline["direction"] as? String == "reverse",
                at: try XCTUnwrap(TransitWire.epoch(decline["at"])), departure: try nativeDepartureKey(decline["departure"]),
                arrival: try XCTUnwrap(TransitWire.epoch(decline["arrival"]))
            )
        }
        return data
    }

    /// The web's JSON `[line, scheduled]` departure key as the native `line:scheduledMillis`.
    private func nativeDepartureKey(_ raw: Any?) throws -> String {
        let departure = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(try XCTUnwrap(raw as? String).utf8)) as? [Any])
        let leg = Leg(line: try XCTUnwrap(departure[0] as? String), mode: "train", headsign: "",
                      from: Station(id: "", name: ""), to: Station(id: "", name: ""),
                      departure: try XCTUnwrap(TransitWire.epoch(departure[1])), arrival: try XCTUnwrap(TransitWire.epoch(departure[1])))
        return Journey(legs: [leg]).departureKey
    }

    private func record(_ raw: [String: Any], at: Millis? = nil) throws -> LastAnswer {
        let journey = try TransitWire.journey(dictionary(raw["journey"]))
        return LastAnswer(
            tripId: try XCTUnwrap(raw["tripId"] as? String), reverse: raw["direction"] as? String == "reverse",
            at: try XCTUnwrap(at ?? TransitWire.epoch(raw["at"])), stationId: (raw["station"] as? [String: Any])?["id"] as? String,
            board: board(journey), journey: journey
        )
    }

    private func board(_ journey: Journey) -> BoardData {
        BoardData(from: journey.legs[0].from, to: journey.legs[journey.legs.count - 1].to, journeys: [journey], generatedAt: 0)
    }

    private func fix(_ raw: [String: Any]) throws -> Fix {
        Fix(lat: try number(raw["lat"]), lon: try number(raw["lon"]), at: try number(raw["at"]),
            speed: raw["speed"] as? Double, accuracyMetres: raw["accuracy"] as? Double, course: raw["heading"] as? Double)
    }

    private func journeys(_ raw: Any?) throws -> [String: [Journey]] {
        try (raw as? [String: [[String: Any]]] ?? [:]).mapValues { try $0.map(TransitWire.journey) }
    }

    private func journeyKey(_ raw: Any?) throws -> String {
        let legs = try XCTUnwrap(raw as? [[Any]]).map { pair in
            Leg(line: try XCTUnwrap(pair[0] as? String), mode: "train", headsign: "",
                from: Station(id: "", name: ""), to: Station(id: "", name: ""),
                departure: try XCTUnwrap(TransitWire.epoch(pair[1])), arrival: try XCTUnwrap(TransitWire.epoch(pair[1])))
        }
        return Journey(legs: legs).key
    }

    private func describe(_ request: OnBoardRequest) -> String {
        "\(request.tripId)|\(request.reverse ? "reverse" : "forward")|\(request.from.id)|\(request.to.id)|\(Int64(request.at))|\(request.limit)"
    }

    private func describe(_ raw: [String: Any]) throws -> String {
        "\(try XCTUnwrap(raw["tripId"] as? String))|\(try XCTUnwrap(raw["direction"] as? String))|"
            + "\(try XCTUnwrap(raw["from"] as? String))|\(try XCTUnwrap(raw["to"] as? String))|"
            + "\(Int64(try number(raw["at"])))|\(try XCTUnwrap(raw["limit"] as? Int))"
    }

    private func number(_ raw: Any?) throws -> Double { try XCTUnwrap(raw as? Double) }

    private func dictionary(_ raw: Any?) throws -> [String: Any] { try XCTUnwrap(raw as? [String: Any]) }
}

final class InferenceRuleTests: XCTestCase {
    private let rhodes = Station(id: "213820", name: "Rhodes Station", lat: -33.83053, lon: 151.087032)
    private let townHall = Station(id: "200070", name: "Town Hall Station", lat: -33.873596, lon: 151.206899)
    private let now: Millis = 1_790_806_200_000

    func testATickTakesAFixOnlyWhileAFixCanStillDecideTravel() {
        let departed = journey(departing: now - 60_000)
        var data = UserData(trips: [SavedTrip(id: "rt", from: rhodes, to: townHall)])
        let needs = { (shown: [Millis], fix: Fix?, previous: Fix?) in
            tickNeedsFix(data: data, now: self.now, shownDepartures: shown, fix: fix, previousFix: previous)
        }
        XCTAssertTrue(needs([now - shownDepartureFixWindow], nil, nil))
        XCTAssertFalse(needs([now - shownDepartureFixWindow - 1], nil, nil))
        XCTAssertFalse(needs([now + 1], nil, nil), "a shown train that has not left needs no fix")

        data.lastAnswer = LastAnswer(tripId: "rt", reverse: false, at: now - 120_000, stationId: rhodes.id,
                                     board: board(departed), journey: departed)
        XCTAssertTrue(needs([], nil, nil), "a held record whose train left")
        data.lastAnswer?.stationId = nil
        XCTAssertFalse(needs([], nil, nil), "an unsighted record is not held")
        let upcoming = journey(departing: now + 60_000)
        data.lastAnswer = LastAnswer(tripId: "rt", reverse: false, at: now - 120_000, stationId: rhodes.id,
                                     board: board(upcoming), journey: upcoming)
        XCTAssertFalse(needs([], nil, nil), "a held record whose train has not left")

        let moving = Fix(lat: -33.85, lon: 151.13, at: now - movingFixFresh, speed: 14)
        XCTAssertTrue(needs([], moving, nil))
        var stale = moving
        stale.at -= 1
        XCTAssertFalse(needs([], stale, nil))
        var walking = moving
        walking.speed = 1.5
        XCTAssertFalse(needs([], walking, nil))
        let derived = Fix(lat: -33.85, lon: 151.13, at: now, accuracyMetres: 10)
        let behind = Fix(lat: -33.844, lon: 151.112, at: now - 30_000, accuracyMetres: 10)
        XCTAssertTrue(needs([], derived, behind), "a derived train speed")
    }

    func testADeclineHoldsItsTripForAnHourOrUntilItsArrivalHasLongPassed() {
        let declined = journey(departing: now - 600_000)
        let focus = FocusedJourney(tripId: "rt", reverse: false, journey: declined, board: board(declined), pinned: false)
        let data = UserData(trips: [SavedTrip(id: "rt", from: rhodes, to: townHall)], inferenceDeclined: inferenceDecline(of: focus, at: now))
        let other = journey(departing: now + 600_000)
        XCTAssertTrue(inferenceDeclined(data, tripId: "rt", now: now + declineHold - 1, journey: other))
        XCTAssertFalse(inferenceDeclined(data, tripId: "rt", now: now + declineHold, journey: other))
        XCTAssertTrue(inferenceDeclined(data, tripId: "rt", now: now + 86_400_000, journey: declined), "never the declined departure")
        XCTAssertFalse(inferenceDeclined(data, tripId: "rr", now: now))
    }

    func testAPlatformSightingRecordedAfterTheTrainLeftDoesNotEnter() {
        let departed = journey(departing: now - 300_000)
        var data = UserData(trips: [SavedTrip(id: "rt", from: rhodes, to: townHall)])
        data.useLocation = true
        let seenAfter = LastAnswer(tripId: "rt", reverse: false, at: departed.effectiveDeparture + 30_000, stationId: rhodes.id,
                                   board: board(departed), journey: departed)
        let riding = Fix(lat: -33.83914, lon: 151.111, at: now, speed: 14, accuracyMetres: 10)
        XCTAssertNil(inferredFocus(data: data, record: seenAfter, fix: riding, now: now),
                     "a record written after its train left is a retained answer, not evidence of boarding")
        var atDeparture = seenAfter
        atDeparture.at = departed.effectiveDeparture
        XCTAssertEqual(inferredFocus(data: data, record: atDeparture, fix: riding, now: now)?.journey.key, departed.key)
        var early = seenAfter
        early.at = departed.effectiveDeparture - travelSeen - 1
        XCTAssertNil(inferredFocus(data: data, record: early, fix: riding, now: now))
    }

    func testHomeOffersStartTripOnlyForItsLeadWhileItLeavesWithinFifteenMinutes() {
        var state = AppState()
        state.trips = [SavedTrip(id: "rt", from: rhodes, to: townHall)]
        state.selectedTripId = "rt"
        state.now = now
        let soon = journey(departing: now + travelSeen)
        state.board = board(soon)
        XCTAssertEqual(state.startableLead?.key, soon.key)
        state.board = board(journey(departing: now + travelSeen + 1_000))
        XCTAssertNil(state.startableLead, "never a train further off")
        state.board = board(soon)
        state.focus = FocusedJourney(tripId: "rt", reverse: false, journey: soon, board: board(soon), pinned: false)
        XCTAssertNil(state.startableLead, "trip mode is already on")
    }

    private func journey(departing departure: Millis) -> Journey {
        Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Town Hall", from: rhodes, to: townHall,
                           departure: departure, arrival: departure + 1_620_000)])
    }

    private func board(_ journey: Journey) -> BoardData {
        BoardData(from: rhodes, to: townHall, journeys: [journey], generatedAt: now)
    }
}
