import Foundation
import XCTest
@testable import ILoveTrains

final class StorageTests: XCTestCase {
    func testFocusAndExactIdentitySurviveRestart() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceStore(directory: directory)
        let from = Station(id: "a", name: "A")
        let to = Station(id: "b", name: "B")
        let journey = Journey(legs: [Leg(
            line: "T9", mode: "train", headsign: "B", from: from, to: to,
            departure: 10_000, arrival: 20_000, estimatedDeparture: 11_000, estimatedArrival: 22_000,
            fromPlatform: "1", toPlatform: "2",
            identity: TripIdentity(source: "sydneytrains", tripId: "exact", serviceDate: "20260906", fromStopId: "a1", toStopId: "b2")
        )])
        let board = BoardData(from: from, to: to, journeys: [journey], generatedAt: 9_000, source: "live", serverStale: true)
        let data = UserData(
            trips: [SavedTrip(id: "t", from: from, to: to)],
            focus: FocusedJourney(tripId: "t", reverse: false, journey: journey, board: board),
            modes: []
        )

        try await store.save(data)
        let restored = await store.load()
        XCTAssertEqual(restored, data)
        XCTAssertEqual(restored.focus?.journey.legs.first?.identity?.tripId, "exact")
    }

    func testCorruptPrimaryRecoversThePreviousAtomicDocument() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceStore(directory: directory)
        let from = Station(id: "a", name: "A")
        let to = Station(id: "b", name: "B")
        let first = UserData(trips: [SavedTrip(id: "first", from: from, to: to)])
        let second = UserData(trips: [SavedTrip(id: "second", from: from, to: to)])

        try await store.save(first)
        try await store.save(second)
        try Data("not json".utf8).write(to: directory.appendingPathComponent("personal-v1.json"))
        let recovered = await store.load()
        XCTAssertEqual(recovered.trips.map(\.id), ["first"])
    }

    func testCacheIsPairAwareAndDeletionPurgesBothDirections() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceStore(directory: directory)
        let from = Station(id: "a", name: "A")
        let to = Station(id: "b", name: "B")
        let board = BoardData(from: from, to: to, generatedAt: 1)
        let reverse = BoardData(from: to, to: from, generatedAt: 2)
        let trip = SavedTrip(id: "trip", from: from, to: to)

        try await store.cache(board, modes: ["train"])
        try await store.cache(reverse, modes: ["ferry"])
        let cachedTrain = await store.cached(from: from, to: to, modes: ["train"])
        let cachedFerry = await store.cached(from: from, to: to, modes: ["ferry"])
        XCTAssertEqual(cachedTrain, board)
        XCTAssertNil(cachedFerry)

        try await store.purgeCache(for: trip)
        let purgedForward = await store.cached(from: from, to: to, modes: ["train"])
        let purgedReverse = await store.cached(from: to, to: from, modes: ["ferry"])
        XCTAssertNil(purgedForward)
        XCTAssertNil(purgedReverse)
    }

    func testCacheNeverExceedsTheGlobalFileLimit() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceStore(directory: directory)
        let modeSets: [Set<String>] = [[], ["train"], ["metro"], ["ferry"], ["train", "metro"], ["train", "ferry"], ["metro", "ferry"], allModes]

        for pair in 0..<11 {
            let from = Station(id: "from-\(pair)", name: "From \(pair)")
            let to = Station(id: "to-\(pair)", name: "To \(pair)")
            for modes in modeSets {
                try await store.cache(BoardData(from: from, to: to, generatedAt: Double(pair)), modes: modes)
            }
        }

        let files = try FileManager.default.contentsOfDirectory(at: directory.appendingPathComponent("boards"), includingPropertiesForKeys: nil)
        XCTAssertLessThanOrEqual(files.count, 64)
    }

    func testEqualSaveDoesNotCreateARecoveryCopy() async throws {
        let directory = temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DeviceStore(directory: directory)
        let data = UserData(trips: [SavedTrip(id: "trip", from: Station(id: "a", name: "A"), to: Station(id: "b", name: "B"))])

        try await store.save(data)
        try await store.save(data)

        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("personal-v1.backup.json").path))
        let restored = await store.load()
        XCTAssertEqual(restored, data)
    }

    func testMalformedPersistedJourneysAreRejectedWithoutLosingValidTrips() throws {
        let from = Station(id: "a", name: "A")
        let to = Station(id: "b", name: "B")
        let journey = Journey(legs: [Leg(line: "T1", mode: "train", headsign: "B", from: from, to: to, departure: -1_000, arrival: 20_000)])
        let board = BoardData(from: from, to: to, journeys: [journey], generatedAt: 1)
        let source = UserData(
            trips: [SavedTrip(id: "trip", from: from, to: to)],
            focus: FocusedJourney(tripId: "trip", reverse: false, journey: journey, board: board)
        )
        var raw = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(source)) as? [String: Any])
        var focus = try XCTUnwrap(raw["focus"] as? [String: Any])
        var malformedJourney = try XCTUnwrap(focus["journey"] as? [String: Any])
        malformedJourney["legs"] = []
        focus["journey"] = malformedJourney
        raw["focus"] = focus

        let recovered = try JSONDecoder().decode(UserData.self, from: JSONSerialization.data(withJSONObject: raw))
        XCTAssertEqual(recovered.trips.map(\.id), ["trip"])
        XCTAssertNil(recovered.focus)

        var huge = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(journey)) as? [String: Any])
        var legs = try XCTUnwrap(huge["legs"] as? [[String: Any]])
        legs[0]["departure"] = 1e20
        huge["legs"] = legs
        XCTAssertThrowsError(try JSONDecoder().decode(Journey.self, from: JSONSerialization.data(withJSONObject: huge)))
        XCTAssertEqual(try JSONDecoder().decode(Journey.self, from: JSONEncoder().encode(journey)), journey)
    }

    func testTripCapUsesLatestHistoryThenCreationInsteadOfLegacyLastViewed() {
        let from = Station(id: "a", name: "A")
        let trips = (0..<11).map { SavedTrip(
            id: "trip-\($0)", from: from, to: Station(id: "to-\($0)", name: "To \($0)"),
            createdAt: Double($0), lastViewed: $0 == 0 ? 1e12 : 0
        ) }
        let normalized = UserData(
            trips: trips,
            history: [ViewEvent(tripId: "trip-0", reverse: false, at: 100)]
        ).normalized()

        XCTAssertEqual(normalized.trips.count, 10)
        XCTAssertTrue(normalized.trips.contains { $0.id == "trip-0" })
        XCTAssertFalse(normalized.trips.contains { $0.id == "trip-1" })
    }
}

private func temporaryDirectory() -> URL {
    FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
}
