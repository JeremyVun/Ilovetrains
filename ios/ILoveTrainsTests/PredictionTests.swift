import Foundation
import XCTest
@testable import ILoveTrains

final class PredictionTests: XCTestCase {
    func testCommittedWebPredictionFixtures() throws {
        let cases = try JSONDecoder().decode([PredictionFixture].self, from: Data(contentsOf: fixtureURL("prediction")))
        for fixture in cases {
            let now = epoch(fixture.now)
            let data = fixture.doc.userData()
            let stations = fixture.stations.map { $0.station }
            let fix = fixture.fix.map { Fix(lat: $0.lat, lon: $0.lon, at: now) }
            let result = predict(data: data, stations: stations, fix: fix, now: now)

            XCTAssertEqual(result?.tripId, fixture.expected.selection?.tripId, fixture.name)
            XCTAssertEqual(result?.reverse, fixture.expected.selection?.reverse, fixture.name)
            XCTAssertEqual(automaticHome(data: data)?.id, fixture.expected.home, fixture.name)

            var withoutLocation = data
            withoutLocation.useLocation = false
            let noLocation = predict(data: withoutLocation, stations: stations, fix: fix, now: now)
            XCTAssertEqual(noLocation?.tripId, fixture.expected.noLocation?.tripId, fixture.name)
            XCTAssertEqual(noLocation?.reverse, fixture.expected.noLocation?.direction == "reverse", fixture.name)

            for expected in fixture.expected.scores {
                XCTAssertEqual(
                    historyScore(events: data.history, tripId: expected.tripId, reverse: expected.reverse, now: now),
                    expected.value,
                    accuracy: 0.000_000_001,
                    fixture.name
                )
            }
        }
    }

    func testInferenceNeedsPlatformEvidenceAndMovement() {
        let now = epoch("2026-09-07T08:00:00+10:00")
        let rhodes = Station(id: "213820", name: "Rhodes", lat: -33.8308, lon: 151.0879)
        let central = Station(id: "200060", name: "Central", lat: -33.884, lon: 151.206)
        let trip = SavedTrip(id: "a", from: rhodes, to: central)
        let journey = Journey(legs: [Leg(
            line: "T9", mode: "train", headsign: "Central", from: rhodes, to: central,
            departure: now - 300_000, arrival: now + 1_200_000
        )])
        let board = BoardData(from: rhodes, to: central, journeys: [journey], generatedAt: now)
        let data = UserData(
            trips: [trip],
            lastAnswer: LastAnswer(
                tripId: trip.id, reverse: false, at: now - 400_000,
                stationId: rhodes.id, board: board, journey: journey
            )
        )

        XCTAssertNil(inferredFocus(data: data, fix: Fix(lat: rhodes.lat, lon: rhodes.lon, at: now), now: now))
        XCTAssertNil(inferredFocus(data: data, fix: Fix(lat: -33.85, lon: 151.13, at: now - 300_001), now: now))
        XCTAssertEqual(
            inferredFocus(data: data, fix: Fix(lat: -33.85, lon: 151.13, at: now), now: now)?.pinned,
            false
        )
    }

    func testMetadataUsesShownDirectionAndSydneyCalendar() {
        let now = epoch("2026-09-07T08:00:00+10:00")
        let yesterday = epoch("2026-09-06T18:00:00+10:00")
        let rhodes = Station(id: "213820", name: "Rhodes", lat: -33.8308, lon: 151.0879)
        let central = Station(id: "200060", name: "Central", lat: -33.884, lon: 151.206)
        let trip = SavedTrip(id: "a", from: rhodes, to: central)
        let data = UserData(
            trips: [trip],
            rides: [Ride(tripId: "a", reverse: false, departure: yesterday - 1_000, arrival: yesterday)]
        )

        let metadata = savedTripMetadata(
            data: data,
            fix: Fix(lat: central.lat, lon: central.lon, at: now),
            selectedTripId: "a",
            selectedReverse: true,
            now: now
        )
        XCTAssertEqual(metadata["a"], "10 m away · Last ridden yesterday")
    }
}

private struct PredictionFixture: Decodable {
    var name: String
    var doc: FixtureDocument
    var fix: FixtureFix?
    var now: String
    var stations: [FixtureStation]
    var expected: FixtureExpected
}

private struct FixtureDocument: Decodable {
    var trips: [FixtureTrip]
    var history: [FixtureHistory]
    var rides: [FixtureRide]
    var homeVotes: [FixtureVote]
    var preferences: FixturePreferences?
    var lastViewed: FixtureLastViewed?

    func userData() -> UserData {
        UserData(
            trips: trips.map { $0.savedTrip },
            history: history.map { ViewEvent(tripId: $0.tripId, reverse: $0.direction == "reverse", at: epoch($0.t)) },
            rides: rides.compactMap { $0.ride },
            votes: homeVotes.map { HomeVote(day: $0.day, station: $0.station.station) },
            lastTripId: lastViewed?.tripId,
            lastReverse: lastViewed?.direction == "reverse",
            modes: Set(preferences?.enabledModes ?? Array(allModes)).intersection(allModes),
            useLocation: preferences?.useLocation ?? true
        )
    }
}

private struct FixtureTrip: Decodable {
    var id: String
    var from: FixtureStation
    var to: FixtureStation
    var createdAt: String?

    var savedTrip: SavedTrip {
        SavedTrip(id: id, from: from.station, to: to.station, createdAt: createdAt.map(epoch) ?? 0)
    }
}

private struct FixtureHistory: Decodable {
    var tripId: String
    var direction: String
    var t: String
}

private struct FixtureRide: Decodable {
    var tripId: String
    var direction: String
    var scheduledDeparture: String?
    var departedAt: String?
    var arrivedAt: String?
    var from: FixtureStation?
    var to: FixtureStation?

    var ride: Ride? {
        guard let departure = scheduledDeparture ?? departedAt, let arrivedAt, let from, let to else { return nil }
        return Ride(
            tripId: tripId, reverse: direction == "reverse", departure: epoch(departure), arrival: epoch(arrivedAt),
            from: from.station, to: to.station
        )
    }
}

private struct FixtureVote: Decodable {
    var day: String
    var station: FixtureStation
}

private struct FixturePreferences: Decodable {
    var useLocation: Bool?
    var enabledModes: [String]?
}

private struct FixtureLastViewed: Decodable {
    var tripId: String
    var direction: String
}

private struct FixtureStation: Decodable {
    struct Location: Decodable {
        var lat: Double
        var lon: Double
    }

    var id: String
    var name: String
    var location: Location?
    var modes: [String]?

    var station: Station {
        Station(
            id: id,
            name: name,
            lat: location?.lat ?? 0,
            lon: location?.lon ?? 0,
            modes: modes.map { Set($0) } ?? allModes
        )
    }
}

private struct FixtureFix: Decodable {
    var lat: Double
    var lon: Double
}

private struct FixtureExpected: Decodable {
    var selection: FixtureSelection?
    var noLocation: FixtureSelection?
    var home: String?
    var scores: [FixtureScore]
}

private struct FixtureSelection: Decodable {
    var tripId: String
    var reverse: Bool?
    var direction: String?
}

private struct FixtureScore: Decodable {
    var tripId: String
    var reverse: Bool
    var value: Double
}

private func epoch(_ value: String) -> Millis {
    ISO8601DateFormatter().date(from: value)!.timeIntervalSince1970 * 1_000
}

private func fixtureURL(_ name: String) -> URL {
    Bundle(for: PredictionTests.self).url(forResource: name, withExtension: "json")!
}
