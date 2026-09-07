import XCTest
@testable import ILoveTrains

final class OfflinePlannerTests: XCTestCase {
    func testBundledPackageRoutesTrainMetroMixedAndFerry() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let planner = OfflinePlanner(bundle: .main, directory: directory)
        try await planner.initialize()
        let coverage = await planner.coverageDescription
        XCTAssertEqual(coverage, "5 Sep 2026–4 Oct 2026")

        let sunday = sydneyMillis(year: 2026, month: 9, day: 6, hour: 10)
        let monday = sydneyMillis(year: 2026, month: 9, day: 7, hour: 10)
        let train = try await planner.plan(
            from: station("200060", "Central Station", "train", "metro"),
            to: station("215020", "Parramatta Station", "train"),
            at: sunday,
            modes: ["train"]
        )
        let metro = try await planner.plan(
            from: station("2155384", "Tallawong Station", "metro"),
            to: station("206710", "Chatswood Station", "train", "metro"),
            at: monday,
            modes: ["metro"]
        )
        let mixed = try await planner.plan(
            from: station("202010", "Mascot Station", "train"),
            to: station("2155382", "Kellyville Station", "metro"),
            at: monday,
            modes: ["train", "metro"]
        )
        let ferry = try await planner.plan(
            from: station("200020", "Circular Quay", "train", "ferry"),
            to: station("209573", "Manly Wharf", "ferry"),
            at: sunday,
            modes: ["ferry"]
        )

        XCTAssertFalse(train.journeys.isEmpty)
        let direct = try XCTUnwrap(train.journeys.first { $0.departure == isoMillis("2026-09-06T00:11:01Z") })
        XCTAssertEqual(direct.arrival, isoMillis("2026-09-06T00:43:00Z"))
        XCTAssertEqual(direct.legs.first?.line, "T1")
        XCTAssertFalse(metro.journeys.isEmpty)
        XCTAssertTrue(mixed.journeys.contains { Set($0.legs.map(\.mode)).isSuperset(of: ["train", "metro"]) })
        XCTAssertFalse(ferry.journeys.isEmpty)
        XCTAssertTrue((train.journeys + metro.journeys + mixed.journeys + ferry.journeys)
            .flatMap(\.legs).allSatisfy { $0.identity != nil })
    }

    func testMissingSundayMetroExtendsSearchAndCoverageIsEnforced() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let planner = OfflinePlanner(bundle: .main, directory: directory)
        try await planner.initialize()
        let sunday = sydneyMillis(year: 2026, month: 9, day: 6, hour: 10)
        let board = try await planner.plan(
            from: station("202010", "Mascot Station", "train"),
            to: station("2155382", "Kellyville Station", "metro"),
            at: sunday,
            modes: ["train", "metro"],
            limit: 4
        )
        XCTAssertFalse(board.journeys.isEmpty)
        XCTAssertTrue(board.journeys.allSatisfy { $0.departure >= sunday })

        let unavailable = try await planner.plan(
            from: station("200060", "Central Station", "train"),
            to: station("215020", "Parramatta Station", "train"),
            at: sydneyMillis(year: 2026, month: 11, day: 1, hour: 10),
            modes: ["train"]
        )
        XCTAssertEqual(unavailable.error, "The offline timetable does not cover this date")
        XCTAssertTrue(unavailable.journeys.isEmpty)
    }

    func testCorruptActiveGenerationRecoversBundledPackage() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        var first: OfflinePlanner? = OfflinePlanner(bundle: .main, directory: directory)
        try await first?.initialize()
        first = nil
        let database = try XCTUnwrap(
            (try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil))
                .first { $0.lastPathComponent.hasPrefix("timetable-") }
        )
        try Data("corrupt".utf8).write(to: database)

        let recovered = OfflinePlanner(bundle: .main, directory: directory)
        try await recovered.initialize()
        let coverage = await recovered.coverageDescription
        XCTAssertEqual(coverage, "5 Sep 2026–4 Oct 2026")
    }

    func testRealPackageTimingProfile() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let planner = OfflinePlanner(bundle: .main, directory: directory)
        let (_, initializeMillis) = try await timed { try await planner.initialize() }
        let monday = sydneyMillis(year: 2026, month: 9, day: 7, hour: 10)
        let mascot = station("202010", "Mascot Station", "train")
        let kellyville = station("2155382", "Kellyville Station", "metro")
        let central = station("200060", "Central Station", "train", "metro")
        let (cold, coldMixedMillis) = try await timed {
            try await planner.plan(from: mascot, to: kellyville, at: monday, modes: ["train", "metro"], limit: 24)
        }
        let (warm, warmMixedMillis) = try await timed {
            try await planner.plan(from: mascot, to: kellyville, at: monday, modes: ["train", "metro"], limit: 24)
        }
        let (newPair, warmNewPairMillis) = try await timed {
            try await planner.plan(from: central, to: kellyville, at: monday, modes: ["train", "metro"], limit: 24)
        }

        XCTAssertFalse(cold.journeys.isEmpty)
        XCTAssertEqual(warm.journeys, cold.journeys)
        XCTAssertFalse(newPair.journeys.isEmpty)
        print(
            "CORE_TIMING initialize_ms=\(initializeMillis) cold_mixed_ms=\(coldMixedMillis) "
                + "warm_mixed_ms=\(warmMixedMillis) warm_new_pair_ms=\(warmNewPairMillis)"
        )
    }

    func testSyntheticSchemaAppliesServiceDatesExceptionsAndTimesBeyond24Hours() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let planner = try syntheticPlanner(directory: directory)
        try await planner.initialize()
        let at = sydneyMillis(year: 2026, month: 9, day: 7, hour: 1)
        let board = try await planner.plan(
            from: station("A", "Alpha Station", "train"),
            to: station("B", "Bravo Station", "train"),
            at: at,
            modes: ["train"],
            limit: 8
        )

        XCTAssertEqual(board.journeys.count, 2)
        XCTAssertEqual(board.journeys.map { $0.legs[0].identity?.serviceDate }, ["20260906", "20260907"])
        XCTAssertEqual(board.journeys.map(\.departure), [
            sydneyMillis(year: 2026, month: 9, day: 7, hour: 1) + 10 * 60_000,
            sydneyMillis(year: 2026, month: 9, day: 7, hour: 2)
        ])
        XCTAssertFalse(board.journeys.contains { $0.legs.first?.identity?.tripId == "removed" })
    }

    private func station(_ id: String, _ name: String, _ modes: String...) -> Station {
        Station(id: id, name: name, modes: Set(modes))
    }

    private func sydneyMillis(year: Int, month: Int, day: Int, hour: Int) -> Millis {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Australia/Sydney")!
        return calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour))!.timeIntervalSince1970 * 1_000
    }

    private func isoMillis(_ value: String) -> Millis {
        ISO8601DateFormatter().date(from: value)!.timeIntervalSince1970 * 1_000
    }

    private func timed<Value>(_ operation: () async throws -> Value) async rethrows -> (Value, Double) {
        let start = ContinuousClock.now
        let value = try await operation()
        let elapsed = start.duration(to: .now).components
        return (value, Double(elapsed.seconds) * 1_000 + Double(elapsed.attoseconds) / 1e15)
    }

    private func syntheticPlanner(directory: URL) throws -> OfflinePlanner {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let hash = String(repeating: "c", count: 64)
        let databaseURL = directory.appendingPathComponent("timetable-\(hash).sqlite3")
        let database = try OfflineDatabase(url: databaseURL, readOnly: false)
        let statements = [
            "PRAGMA application_id=0x494c5452",
            "PRAGMA user_version=1",
            "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL) WITHOUT ROWID",
            "CREATE TABLE sources(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE)",
            "CREATE TABLE stations(id TEXT PRIMARY KEY,name TEXT NOT NULL,lat REAL NOT NULL,lon REAL NOT NULL,modes TEXT NOT NULL) WITHOUT ROWID",
            "CREATE TABLE stops(id INTEGER PRIMARY KEY,source INTEGER NOT NULL,stop_id TEXT NOT NULL,station_id TEXT NOT NULL,name TEXT NOT NULL,platform TEXT,lat REAL NOT NULL,lon REAL NOT NULL)",
            "CREATE TABLE routes(id INTEGER PRIMARY KEY,source INTEGER NOT NULL,route_id TEXT NOT NULL,short_name TEXT NOT NULL,long_name TEXT NOT NULL,mode TEXT NOT NULL,color TEXT)",
            "CREATE TABLE services(id INTEGER PRIMARY KEY,source INTEGER NOT NULL,service_id TEXT NOT NULL,start_date INTEGER NOT NULL,end_date INTEGER NOT NULL,weekdays INTEGER NOT NULL)",
            "CREATE TABLE service_exceptions(service INTEGER NOT NULL,service_date INTEGER NOT NULL,exception_type INTEGER NOT NULL,PRIMARY KEY(service,service_date)) WITHOUT ROWID",
            "CREATE TABLE trips(id INTEGER PRIMARY KEY,source INTEGER NOT NULL,trip_id TEXT NOT NULL,route INTEGER NOT NULL,service INTEGER NOT NULL,headsign TEXT NOT NULL,direction_id INTEGER)",
            "CREATE TABLE connections(trip INTEGER NOT NULL,from_sequence INTEGER NOT NULL,to_sequence INTEGER NOT NULL,from_stop INTEGER NOT NULL,to_stop INTEGER NOT NULL,departure_secs INTEGER NOT NULL,arrival_secs INTEGER NOT NULL,pickup_type INTEGER NOT NULL,drop_off_type INTEGER NOT NULL,PRIMARY KEY(trip,from_sequence)) WITHOUT ROWID",
            "INSERT INTO meta VALUES('service_date_from','20260901')",
            "INSERT INTO meta VALUES('service_date_to','20260930')",
            "INSERT INTO sources VALUES(1,'source')",
            "INSERT INTO stations VALUES('A','Alpha Station',0,0,'train')",
            "INSERT INTO stations VALUES('B','Bravo Station',0,0,'train')",
            "INSERT INTO stops VALUES(1,1,'A-stop','A','Alpha','1',0,0)",
            "INSERT INTO stops VALUES(2,1,'B-stop','B','Bravo','2',0,0)",
            "INSERT INTO routes VALUES(1,1,'T1','T1','North Shore','train',NULL)",
            "INSERT INTO services VALUES(1,1,'sunday','20260901','20260930',64)",
            "INSERT INTO services VALUES(2,1,'removed','20260901','20260930',64)",
            "INSERT INTO services VALUES(3,1,'added','20260901','20260930',0)",
            "INSERT INTO service_exceptions VALUES(2,20260906,2)",
            "INSERT INTO service_exceptions VALUES(3,20260907,1)",
            "INSERT INTO trips VALUES(1,1,'overnight',1,1,'Bravo',0)",
            "INSERT INTO trips VALUES(2,1,'removed',1,2,'Bravo',0)",
            "INSERT INTO trips VALUES(3,1,'added',1,3,'Bravo',0)",
            "INSERT INTO connections VALUES(1,1,2,1,2,90600,91200,0,0)",
            "INSERT INTO connections VALUES(2,1,2,1,2,91800,92400,0,0)",
            "INSERT INTO connections VALUES(3,1,2,1,2,7200,7800,0,0)",
            "CREATE INDEX connections_departure ON connections(departure_secs)"
        ]
        for statement in statements { try database.rows(statement) { _ in } }
        database.close()
        let manifest = Data("""
        {"schemaVersion":1,"generatedAt":"2026-09-01T00:00:00Z","expiresAt":"2026-10-01T00:00:00+10:00","serviceDateFrom":"20260901","serviceDateTo":"20260930","packages":[{"source":"network","schemaVersion":1,"sha256":"\(hash)","url":"/unused.zip","bytes":1,"serviceDateFrom":"20260901","serviceDateTo":"20260930"}]}
        """.utf8)
        try manifest.write(to: directory.appendingPathComponent("active-manifest.json"))
        try manifest.write(to: directory.appendingPathComponent("manifest-\(hash).json"))
        return OfflinePlanner(bundle: .main, directory: directory)
    }
}
