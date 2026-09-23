import XCTest
@testable import ILoveTrains

final class HeaderKindTests: XCTestCase {
    private let central = Station(id: "200060", name: "Central", lat: -33.884, lon: 151.206)
    private let rhodes = Station(id: "213820", name: "Rhodes", lat: -33.8308, lon: 151.0879)
    private let bondi = Station(id: "202210", name: "Bondi Junction", lat: -33.891, lon: 151.248)
    private let stranger = Station(id: "221710", name: "Strathfield", lat: -33.8717, lon: 151.0942)
    private let now = ISO8601DateFormatter().date(from: "2026-09-06T22:00:00Z")!.timeIntervalSince1970 * 1_000
    private var stations: [Station] { [central, rhodes, bondi, stranger] }
    private var toCentral: SavedTrip { SavedTrip(id: "a", from: rhodes, to: central) }
    private var fromCentral: SavedTrip { SavedTrip(id: "c", from: central, to: bondi) }
    private func at(_ station: Station, age: Millis = 0) -> Fix { Fix(lat: station.lat, lon: station.lon, at: now - age) }
    private func daily(_ tripId: String, _ days: Int) -> [ViewEvent] {
        (1...days).map { ViewEvent(tripId: tripId, reverse: false, at: now - Double($0) * 86_400_000) }
    }

    func testWithNoStationHereTheAnswerIsPredicted() {
        let data = UserData(trips: [toCentral, fromCentral])
        XCTAssertEqual(predict(data: data, stations: stations, fix: nil, now: now)?.kind, .predicted)
        var withoutLocation = data
        withoutLocation.useLocation = false
        XCTAssertEqual(predict(data: withoutLocation, stations: stations, fix: at(central), now: now)?.kind, .predicted)
        XCTAssertEqual(predict(data: data, stations: stations, fix: at(central, age: 300_001), now: now)?.kind, .predicted)
    }

    func testTheHomewardFallbackIsHomeAndAHabitAtTheSameStationIsUsual() throws {
        let data = UserData(trips: [toCentral, fromCentral])
        let homeward = try XCTUnwrap(predict(data: data, stations: stations, fix: at(central), now: now))
        XCTAssertEqual([homeward.tripId, "\(homeward.reverse)"], ["a", "true"])
        XCTAssertEqual(homeward.kind, .home)
        var habitual = data
        habitual.history = daily("c", 3)
        let habit = try XCTUnwrap(predict(data: habitual, stations: stations, fix: at(central), now: now))
        XCTAssertEqual(habit.tripId, "c")
        XCTAssertEqual(habit.kind, .usual)
    }

    func testAnyOtherAnswerFromAStationHereIsUsual() {
        let data = UserData(trips: [toCentral, SavedTrip(id: "b", from: rhodes, to: bondi)])
        XCTAssertEqual(predict(data: data, stations: stations, fix: at(rhodes), now: now)?.kind, .usual, "standing at home offers no homeward trip")
        XCTAssertEqual(predict(data: data, stations: stations, fix: at(stranger), now: now)?.kind, .usual, "a station with no saved trip from it")
    }

    func testNativeKindsMatchTheWebAnswerKindForEverySharedPredictionCase() throws {
        // Derived by running web/js/predict.js `locate` over the same fixture.
        let web = [
            "repeated checks do not beat a local homeward fallback": "home",
            "established local history still outranks homeward fallback": "usual",
            "standing at destination chooses real return pair": "home",
            "relevant origin history outranks home fallback": "usual",
            "three first-open votes infer home": "home"
        ]
        let url = try XCTUnwrap(Bundle(for: HeaderKindTests.self).url(forResource: "prediction", withExtension: "json"))
        let cases = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [[String: Any]])
        var names = Set<String>()
        for fixture in cases {
            let name = try XCTUnwrap(fixture["name"] as? String)
            names.insert(name)
            let at = try XCTUnwrap(ISO8601DateFormatter().date(from: XCTUnwrap(fixture["now"] as? String))).timeIntervalSince1970 * 1_000
            let doc = try XCTUnwrap(fixture["doc"] as? [String: Any])
            let station = { (raw: Any?) throws -> Station in try TransitWire.station(XCTUnwrap(raw as? [String: Any])) }
            let rows = { (key: String) in (doc[key] as? [[String: Any]]) ?? [] }
            let lastViewed = doc["lastViewed"] as? [String: String]
            var data = UserData(
                trips: try rows("trips").map { SavedTrip(id: $0["id"] as? String ?? "", from: try station($0["from"]), to: try station($0["to"])) },
                history: try rows("history").map { row in
                    let t = try XCTUnwrap(ISO8601DateFormatter().date(from: XCTUnwrap(row["t"] as? String)))
                    return ViewEvent(tripId: row["tripId"] as? String ?? "", reverse: row["direction"] as? String == "reverse", at: t.timeIntervalSince1970 * 1_000)
                },
                votes: try rows("homeVotes").map { HomeVote(day: $0["day"] as? String ?? "", station: try station($0["station"])) },
                lastTripId: lastViewed?["tripId"],
                lastReverse: lastViewed?["direction"] == "reverse"
            )
            data.useLocation = ((doc["preferences"] as? [String: Any])?["useLocation"] as? Bool) ?? true
            let fix = (fixture["fix"] as? [String: Double]).map { Fix(lat: $0["lat"] ?? 0, lon: $0["lon"] ?? 0, at: at) }
            let stations = try ((fixture["stations"] as? [Any]) ?? []).map { try station($0) }
            XCTAssertEqual(predict(data: data, stations: stations, fix: fix, now: at)?.kind.rawValue, web[name] ?? "predicted", name)
            data.useLocation = false
            XCTAssertEqual(predict(data: data, stations: stations, fix: fix, now: at)?.kind, .predicted, name)
        }
        XCTAssertTrue(names.isSuperset(of: web.keys))
    }

    func testAVisibleFocusNamesItsOwnKindAndAnExplicitChoiceIsBrowsing() {
        let journey = Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Central", from: rhodes, to: central, departure: now, arrival: now + 1_200_000)])
        let pinned = FocusedJourney(tripId: "a", reverse: false, journey: journey, board: BoardData(from: rhodes, to: central, journeys: [journey], generatedAt: now))
        var inferred = pinned
        inferred.pinned = false
        let predicted = Selection(tripId: "a", reverse: false, kind: .home)
        XCTAssertEqual(homeAnswerKind(focus: pinned, predicted: predicted, tripId: "a", reverse: false, autoSavedTripId: "a"), .focus)
        XCTAssertEqual(homeAnswerKind(focus: inferred, predicted: nil, tripId: "a", reverse: false, autoSavedTripId: nil), .inferred)
        XCTAssertEqual(homeAnswerKind(focus: nil, predicted: predicted, tripId: "a", reverse: false, autoSavedTripId: nil), .home)
        XCTAssertNil(homeAnswerKind(focus: nil, predicted: nil, tripId: "a", reverse: false, autoSavedTripId: "a"), "browsing an explicit choice")
        XCTAssertNil(homeAnswerKind(focus: nil, predicted: predicted, tripId: "a", reverse: true, autoSavedTripId: nil),
                     "an answer home did not predict is not its own")
        XCTAssertEqual(homeAnswerKind(focus: nil, predicted: predicted, tripId: "a", reverse: false, autoSavedTripId: "a"), .pair,
                       "the trip home saved from here this open is a pair answer")
        XCTAssertEqual(homeAnswerKind(focus: nil, predicted: Selection(tripId: "a", reverse: false, kind: .usual), tripId: "a", reverse: false,
                                      autoSavedTripId: "a"), .pair)
        XCTAssertEqual(homeAnswerKind(focus: nil, predicted: predicted, tripId: "a", reverse: false, autoSavedTripId: "b"), .home)
    }

    func testTheLeadIsTheJourneyHomeShowsForTheSelectedTripAndDirection() {
        let sooner = Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Central", from: rhodes, to: central, departure: now + 120_000, arrival: now + 1_500_000)])
        let later = Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Central", from: rhodes, to: central, departure: now + 600_000, arrival: now + 2_000_000)])
        var cancelled = sooner
        cancelled.legs[0].departure = now + 60_000
        cancelled.legs[0].cancelled = true
        let board = BoardData(from: rhodes, to: central, journeys: [cancelled, sooner, later], generatedAt: now, source: "live")
        var state = AppState()
        state.trips = [toCentral]; state.selectedTripId = "a"; state.board = board; state.homeBoard = board; state.now = now
        XCTAssertEqual(displayedHomeLead(state)?.key, sooner.key, "the first running service leads")
        state.recommendation = JourneyRecommendation(journey: later, board: board)
        XCTAssertEqual(displayedHomeLead(state)?.key, later.key, "a recommendation leads when it has one")
        state.reverse = true
        XCTAssertNil(displayedHomeLead(state), "a board for the other direction is not this answer's")
        state.reverse = false
        state.board = nil; state.homeBoard = nil
        XCTAssertNil(displayedHomeLead(state))
        state.recommendation = nil
        state.board = BoardData(from: rhodes, to: central, journeys: [], generatedAt: now)
        XCTAssertNil(displayedHomeLead(state))
    }

    func testOnlyAWriteThatAppendsTheRideCountsIt() {
        let journey = Journey(legs: [Leg(line: "T9", mode: "train", headsign: "Central", from: rhodes, to: central, departure: now - 1_500_000, arrival: now - 60_000)])
        let focus = FocusedJourney(tripId: "a", reverse: false, journey: journey, board: BoardData(from: rhodes, to: central, journeys: [journey], generatedAt: now))
        let recorded = settledRides([], focus: focus, arrived: true)
        XCTAssertTrue(rideAppended(before: [], after: recorded))

        var moved = focus
        moved.journey.legs[0].estimatedArrival = now - 30_000
        let corrected = settledRides(recorded, focus: moved, arrived: true)
        XCTAssertEqual(corrected.map(\.arrival), [now - 30_000])
        XCTAssertFalse(rideAppended(before: recorded, after: corrected), "a correction")
        XCTAssertFalse(rideAppended(before: corrected, after: settledRides(corrected, focus: moved, arrived: true)))

        let withdrawn = settledRides(corrected, focus: moved, arrived: false)
        XCTAssertFalse(rideAppended(before: corrected, after: withdrawn))
        XCTAssertTrue(rideAppended(before: withdrawn, after: settledRides(withdrawn, focus: moved, arrived: true)),
                      "a withdrawn estimate recorded again counts again")

        var reversed = focus
        reversed.reverse = true
        XCTAssertTrue(rideAppended(before: recorded, after: settledRides(recorded, focus: reversed, arrived: true)),
                      "the other direction is another ride")

        let full = (1...100).map { Ride(tripId: "old\($0)", reverse: false, departure: Double($0), arrival: Double($0) + 1) }
        let appended = settledRides(full, focus: focus, arrived: true)
        XCTAssertEqual(appended.count, 100)
        XCTAssertTrue(rideAppended(before: full, after: appended), "the hundred-ride cap still appends")
    }
}
