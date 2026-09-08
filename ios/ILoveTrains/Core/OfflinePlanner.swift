import CryptoKit
import Foundation
import SQLite3

actor OfflinePlanner {
    private struct PackageInfo: Decodable, Sendable {
        var source: String
        var schemaVersion: Int
        var sha256: String
        var url: String
        var bytes: Int64
        var serviceDateFrom: String
        var serviceDateTo: String
        var generatedAt: Millis = 0

        enum CodingKeys: CodingKey {
            case source, schemaVersion, sha256, url, bytes, serviceDateFrom, serviceDateTo
        }
    }

    private struct Manifest: Decodable, Sendable {
        var schemaVersion: Int
        var generatedAt: FlexibleMillis
        var packages: [PackageInfo]
    }

    private struct ScheduleCache {
        var baseAt: Millis
        var serviceDate: String
        var horizonHours: Int
        var connections: [ScheduledConnection]
    }

    private struct StopRef {
        var stopId: String
        var stationId: String
        var platform: String?
    }

    private struct RouteRef {
        var line: String
        var mode: String
    }

    private struct TripRef {
        var source: String
        var tripId: String
        var route: RouteRef
        var headsign: String
    }

    private let bundle: Bundle
    private let directory: URL
    private let packageStore: OfflinePackageStore
    private let router = OfflineRouter()
    private var realtime = OfflineRealtime()
    private var database: OfflineDatabase?
    private var activePackage: PackageInfo?
    private var scheduleCache: ScheduleCache?
    private var stationsById: [String: Station] = [:]
    private var stopsById: [Int: StopRef] = [:]
    private var tripsById: [Int: TripRef] = [:]
    private var updating = false
    private var realtimeRefreshing = false
    private var dataGeneration = 0

    private(set) var coverageDescription = "Timetable unavailable"

    init(bundle: Bundle = .main, directory: URL? = nil) {
        self.bundle = bundle
        let root = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("timetable", isDirectory: true)
        self.directory = root
        packageStore = OfflinePackageStore(directory: root)
    }

    func initialize() async throws {
        try packageStore.prepareDirectory()
        for manifestData in packageStore.manifests() {
            guard let info = try? parseManifest(manifestData),
                  validateDatabase(packageStore.database(info.sha256), info: info) else { continue }
            try packageStore.activate(
                candidateDatabase: packageStore.database(info.sha256),
                manifest: manifestData,
                sha256: info.sha256
            )
            try open(info)
            return
        }
        try installBundled()
    }

    func plan(
        from: Station,
        to: Station,
        at: Millis,
        modes: Set<String>,
        limit: Int = 24,
        maxTransfers: Int = 2
    ) async throws -> BoardData {
        guard let active = activePackage, let database else { throw OfflineCoreError.notInitialized }
        let date = Self.compactDate(containing: at)
        if date < active.serviceDateFrom || date > active.serviceDateTo {
            return BoardData(
                from: from,
                to: to,
                generatedAt: active.generatedAt,
                source: "schedule",
                offline: true,
                coverage: coverageDescription,
                error: "The offline timetable does not cover this date"
            )
        }
        guard !modes.isEmpty,
              !from.modes.intersection(modes).isEmpty,
              !to.modes.intersection(modes).isEmpty else {
            return BoardData(
                from: from,
                to: to,
                generatedAt: active.generatedAt,
                source: "schedule",
                offline: true,
                coverage: coverageDescription
            )
        }

        var assignments: [String: StopAssignment] = [:]
        func assigned(_ source: String, _ stopId: String) -> StopAssignment? {
            let key = "\(source)\0\(stopId)"
            if let value = assignments[key] { return value }
            let value = assignmentFor(database, source: source, stopId: stopId)
            if let value { assignments[key] = value }
            return value
        }
        func connections(_ hours: Int) throws -> [ScheduledConnection] {
            let scheduled = try cachedConnections(database, at: at, horizonHours: hours).filter { modes.contains($0.mode) }
            guard realtime.hasFreshData() else { return scheduled }
            return realtime.overlay(scheduled, assignment: assigned).sorted(by: Self.connectionOrder)
        }

        var routed = router.route(
            from: from,
            to: to,
            at: at,
            connections: try connections(Self.initialHorizonHours),
            limit: limit,
            maxTransfers: maxTransfers
        )
        if routed.isEmpty || routed.contains(where: Self.hasLongWait) {
            routed = router.route(
                from: from,
                to: to,
                at: at,
                connections: try connections(Self.maximumHorizonHours),
                limit: limit,
                maxTransfers: maxTransfers
            )
        }
        var observedAt: Millis?
        var matched = false
        let journeys = routed.map { journey in
            let result = realtime.observation(journey)
            matched = matched || result.matched
            if let observation = result.observedAt {
                observedAt = min(observedAt ?? .greatestFiniteMagnitude, observation)
            }
            return result.value
        }
        return BoardData(
            from: from,
            to: to,
            journeys: journeys,
            generatedAt: observedAt ?? active.generatedAt,
            source: matched ? "live" : "schedule",
            offline: !matched,
            coverage: coverageDescription
        )
    }

    func refreshRealtime(baseURL: String) async throws {
        guard Self.endpoint(baseURL, path: "/api/v1/realtime/") != nil else { throw OfflineCoreError.insecureURL }
        guard !realtimeRefreshing else { return }
        realtimeRefreshing = true
        defer { realtimeRefreshing = false }
        let generation = dataGeneration
        var refreshed = realtime
        await refreshed.refresh(baseURL: baseURL)
        if generation == dataGeneration { realtime = refreshed }
    }

    func refreshFocused(_ journey: Journey) -> FocusUpdate {
        guard let database else { return FocusUpdate(journey: journey.scheduledOnly()) }
        let scheduled = Self.scheduledFocusBaseline(journey) { source, stopId in
            self.assignmentFor(database, source: source, stopId: stopId)?.platform
        }
        let result = realtime.overlay(scheduled) { source, stopId in
            self.assignmentFor(database, source: source, stopId: stopId)
        }
        let live = !scheduled.legs.isEmpty && scheduled.legs.indices.allSatisfy(result.matchedLegIndices.contains)
        return FocusUpdate(
            journey: result.value,
            observedAt: result.observedAt,
            live: live,
            matchedLegIndices: result.matchedLegIndices
        )
    }

    func update(baseURL: String) async throws {
        guard !updating else { throw OfflineCoreError.updateInProgress }
        updating = true
        defer { updating = false }
        guard let manifestURL = Self.endpoint(baseURL, path: "/api/v1/timetable/manifest") else {
            throw OfflineCoreError.insecureURL
        }
        var request = URLRequest(url: manifestURL, timeoutInterval: 15)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (manifestTemporary, manifestResponse) = try await URLSession.shared.download(for: request)
        defer { try? FileManager.default.removeItem(at: manifestTemporary) }
        let manifestAttributes = try FileManager.default.attributesOfItem(atPath: manifestTemporary.path)
        guard let response = manifestResponse as? HTTPURLResponse,
              response.statusCode == 200,
              let manifestSize = manifestAttributes[.size] as? NSNumber,
              manifestSize.intValue <= 1_000_000 else { throw OfflineCoreError.invalidResponse }
        let manifestData = try Data(contentsOf: manifestTemporary)
        let candidate = try parseManifest(manifestData)
        if candidate.sha256 == activePackage?.sha256 { return }
        guard let packageURL = URL(string: candidate.url, relativeTo: manifestURL)?.absoluteURL,
              Self.isSecure(packageURL) else { throw OfflineCoreError.insecureURL }
        let download = directory.appendingPathComponent("download-\(candidate.sha256).zip")
        let extracted = directory.appendingPathComponent("candidate-\(candidate.sha256).sqlite3")
        defer {
            try? FileManager.default.removeItem(at: download)
            try? FileManager.default.removeItem(at: extracted)
        }
        try await downloadPackage(packageURL, to: download, expectedBytes: candidate.bytes)
        guard try Self.sha256(download) == candidate.sha256 else { throw OfflineCoreError.invalidPackage }
        try OfflineZip.extractDatabase(from: download, to: extracted)
        guard validateDatabase(extracted, info: candidate) else { throw OfflineCoreError.invalidDatabase }

        let previous = activePackage?.sha256
        try packageStore.activate(candidateDatabase: extracted, manifest: manifestData, sha256: candidate.sha256)
        do {
            try open(candidate)
        } catch {
            if let previous,
               let previousManifest = packageStore.manifests().first(where: {
                   (try? parseManifest($0).sha256) == previous
               }),
               let previousInfo = try? parseManifest(previousManifest),
               validateDatabase(packageStore.database(previous), info: previousInfo) {
                try? packageStore.activate(
                    candidateDatabase: packageStore.database(previous),
                    manifest: previousManifest,
                    sha256: previous
                )
                try? open(previousInfo)
            }
            throw error
        }
        packageStore.retain(Set([candidate.sha256, previous].compactMap { $0 }))
    }

    static func gtfsEpochMillis(serviceDate: String, seconds: Int) -> Millis? {
        guard let date = parseCompactDate(serviceDate) else { return nil }
        let days = seconds / 86_400
        let remaining = seconds % 86_400
        guard let shifted = sydneyCalendar.date(byAdding: .day, value: days, to: date) else { return nil }
        let ymd = sydneyCalendar.dateComponents([.year, .month, .day], from: shifted)
        var components = DateComponents()
        components.calendar = sydneyCalendar
        components.timeZone = sydneyTimeZone
        components.year = ymd.year
        components.month = ymd.month
        components.day = ymd.day
        components.hour = remaining / 3_600
        components.minute = remaining % 3_600 / 60
        components.second = remaining % 60
        return sydneyCalendar.date(from: components).map { $0.timeIntervalSince1970 * 1_000 }
    }

    static func scheduledFocusBaseline(
        _ journey: Journey,
        platform: (String, String) -> String?
    ) -> Journey {
        Journey(legs: journey.legs.map { leg in
            var value = leg.scheduledOnly()
            if let identity = leg.identity {
                value.fromPlatform = platform(identity.source, identity.fromStopId)
                value.toPlatform = platform(identity.source, identity.toStopId)
                value.scheduledFromPlatform = value.fromPlatform
                value.scheduledToPlatform = value.toPlatform
                value.platformBaselineCaptured = true
            }
            return value
        })
    }

    private func installBundled() throws {
        guard let manifestURL = bundle.url(forResource: "timetable-manifest", withExtension: "json") else {
            throw OfflineCoreError.missingBundledResource("timetable-manifest.json")
        }
        guard let archiveURL = bundle.url(forResource: "timetable", withExtension: "zip") else {
            throw OfflineCoreError.missingBundledResource("timetable.zip")
        }
        let manifestData = try Data(contentsOf: manifestURL)
        let info = try parseManifest(manifestData)
        guard try Self.sha256(archiveURL) == info.sha256 else { throw OfflineCoreError.invalidPackage }
        let extracted = directory.appendingPathComponent("candidate-\(info.sha256).sqlite3")
        defer { try? FileManager.default.removeItem(at: extracted) }
        try OfflineZip.extractDatabase(from: archiveURL, to: extracted)
        guard validateDatabase(extracted, info: info) else { throw OfflineCoreError.invalidDatabase }
        try packageStore.activate(candidateDatabase: extracted, manifest: manifestData, sha256: info.sha256)
        try open(info)
    }

    private func open(_ info: PackageInfo) throws {
        database?.close()
        let opened = try OfflineDatabase(url: packageStore.database(info.sha256))
        database = opened
        activePackage = info
        scheduleCache = nil
        stationsById = try loadStations(opened)
        try loadReferences(opened)
        coverageDescription = Self.coverage(from: info.serviceDateFrom, to: info.serviceDateTo)
        dataGeneration += 1
    }

    private func validateDatabase(_ url: URL, info: PackageInfo) -> Bool {
        guard FileManager.default.fileExists(atPath: url.path),
              let candidate = try? OfflineDatabase(url: url) else { return false }
        defer { candidate.close() }
        guard (try? candidate.scalarInt("PRAGMA application_id")) == 0x494c5452,
              (try? candidate.scalarInt("PRAGMA user_version")) == 1,
              (try? candidate.scalarText("PRAGMA quick_check")) == "ok" else { return false }
        var metadata: [String: String] = [:]
        do {
            try candidate.rows("SELECT key,value FROM meta WHERE key IN ('service_date_from','service_date_to')") { row in
                if let key = OfflineDatabase.text(row, 0), let value = OfflineDatabase.text(row, 1) { metadata[key] = value }
            }
        } catch {
            return false
        }
        return metadata["service_date_from"] == info.serviceDateFrom
            && metadata["service_date_to"] == info.serviceDateTo
    }

    private func cachedConnections(
        _ database: OfflineDatabase,
        at: Millis,
        horizonHours: Int
    ) throws -> [ScheduledConnection] {
        let serviceDate = Self.compactDate(containing: at)
        if let cache = scheduleCache,
           cache.serviceDate == serviceDate,
           cache.horizonHours >= horizonHours,
           at >= cache.baseAt,
           at <= cache.baseAt + 30 * 60_000 {
            return cache.connections
        }
        let connections = try readConnections(database, at: at, horizonHours: horizonHours)
        scheduleCache = ScheduleCache(
            baseAt: at,
            serviceDate: serviceDate,
            horizonHours: horizonHours,
            connections: connections
        )
        return connections
    }

    private func readConnections(
        _ database: OfflineDatabase,
        at: Millis,
        horizonHours: Int
    ) throws -> [ScheduledConnection] {
        let horizon = at + Millis(horizonHours) * 3_600_000
        let atDate = Date(timeIntervalSince1970: at / 1_000)
        let horizonDate = Date(timeIntervalSince1970: horizon / 1_000)
        let currentStart = Self.startOfSydneyDay(atDate)
        let atComponents = Self.sydneyCalendar.dateComponents([.hour, .minute, .second], from: atDate)
        let horizonComponents = Self.sydneyCalendar.dateComponents([.hour, .minute, .second], from: horizonDate)
        let atCivilSeconds = Self.secondsOfDay(atComponents) - 3 * 3_600
        let horizonCivilSeconds = Self.secondsOfDay(horizonComponents)
        let horizonStart = Self.startOfSydneyDay(horizonDate)
        var result: [ScheduledConnection] = []
        result.reserveCapacity(80_000)
        for offset in -1...2 {
            guard let serviceStart = Self.sydneyCalendar.date(byAdding: .day, value: offset, to: currentStart) else { continue }
            let fromCurrent = Self.sydneyCalendar.dateComponents([.day], from: serviceStart, to: currentStart).day ?? -offset
            let toHorizon = Self.sydneyCalendar.dateComponents([.day], from: serviceStart, to: horizonStart).day ?? 0
            let lower = max(0, fromCurrent * 86_400 + atCivilSeconds)
            let upper = min(36 * 3_600, toHorizon * 86_400 + horizonCivilSeconds)
            if lower > upper { continue }
            let serviceDate = Self.compactDate(serviceStart)
            try queryConnections(database, serviceDate: serviceDate, lower: lower, upper: upper, output: &result)
        }
        return result.filter { $0.departure <= horizon && $0.arrival >= at - 3 * 3_600_000 }
            .sorted(by: Self.connectionOrder)
    }

    private func queryConnections(
        _ database: OfflineDatabase,
        serviceDate: String,
        lower: Int,
        upper: Int,
        output: inout [ScheduledConnection]
    ) throws {
        guard let date = Self.parseCompactDate(serviceDate), let dateNumber = Int64(serviceDate) else { return }
        let weekday = Self.sydneyCalendar.component(.weekday, from: date)
        let weekdayMask = 1 << ((weekday + 5) % 7)
        let sql = """
            SELECT c.trip,c.from_sequence,c.to_sequence,c.from_stop,c.to_stop,
              c.departure_secs,c.arrival_secs,c.pickup_type,c.drop_off_type
            FROM connections c
            JOIN trips tr ON tr.id=c.trip
            JOIN services sv ON sv.id=tr.service
            WHERE c.departure_secs BETWEEN ? AND ?
              AND (
                EXISTS(SELECT 1 FROM service_exceptions x WHERE x.service=sv.id AND x.service_date=? AND x.exception_type=1)
                OR (? BETWEEN sv.start_date AND sv.end_date AND (sv.weekdays & ?) != 0
                  AND NOT EXISTS(SELECT 1 FROM service_exceptions x WHERE x.service=sv.id AND x.service_date=? AND x.exception_type=2))
              )
            """
        let fastEpochBase = Self.fastEpochBase(serviceDate)
        try database.rows(sql, bindings: [
            .integer(Int64(lower)), .integer(Int64(upper)), .integer(dateNumber),
            .integer(dateNumber), .integer(Int64(weekdayMask)), .integer(dateNumber)
        ]) { row in
            guard let trip = tripsById[OfflineDatabase.int(row, 0)],
                  let fromStop = stopsById[OfflineDatabase.int(row, 3)],
                  let toStop = stopsById[OfflineDatabase.int(row, 4)] else { return }
            let departureSeconds = OfflineDatabase.int(row, 5)
            let arrivalSeconds = OfflineDatabase.int(row, 6)
            guard let departure = fastEpochBase.map({ $0 + Millis(departureSeconds) * 1_000 })
                    ?? Self.gtfsEpochMillis(serviceDate: serviceDate, seconds: departureSeconds),
                  let arrival = fastEpochBase.map({ $0 + Millis(arrivalSeconds) * 1_000 })
                    ?? Self.gtfsEpochMillis(serviceDate: serviceDate, seconds: arrivalSeconds) else { return }
            output.append(ScheduledConnection(
                source: trip.source,
                tripId: trip.tripId,
                serviceDate: serviceDate,
                fromSequence: OfflineDatabase.int(row, 1),
                toSequence: OfflineDatabase.int(row, 2),
                fromStopId: fromStop.stopId,
                toStopId: toStop.stopId,
                fromStationId: fromStop.stationId,
                toStationId: toStop.stationId,
                fromStation: stationsById[fromStop.stationId],
                toStation: stationsById[toStop.stationId],
                departure: departure,
                arrival: arrival,
                pickupType: OfflineDatabase.int(row, 7),
                dropOffType: OfflineDatabase.int(row, 8),
                fromPlatform: fromStop.platform,
                toPlatform: toStop.platform,
                line: trip.route.line,
                mode: trip.route.mode,
                headsign: trip.headsign
            ))
        }
    }

    private func loadStations(_ database: OfflineDatabase) throws -> [String: Station] {
        var stations: [String: Station] = [:]
        try database.rows("SELECT id,name,lat,lon,modes FROM stations") { row in
            guard let id = OfflineDatabase.text(row, 0),
                  let name = OfflineDatabase.text(row, 1) else { return }
            let modes = Set((OfflineDatabase.text(row, 4) ?? "").split(separator: ",").map(String.init))
            stations[id] = Station(
                id: id,
                name: name,
                lat: OfflineDatabase.double(row, 2),
                lon: OfflineDatabase.double(row, 3),
                modes: modes
            )
        }
        return stations
    }

    private func loadReferences(_ database: OfflineDatabase) throws {
        var sources: [Int: String] = [:]
        try database.rows("SELECT id,name FROM sources") { row in
            sources[OfflineDatabase.int(row, 0)] = OfflineDatabase.text(row, 1)
        }
        var routes: [Int: RouteRef] = [:]
        try database.rows("SELECT id,short_name,long_name,mode FROM routes") { row in
            let shortName = OfflineDatabase.text(row, 1) ?? ""
            guard let longName = OfflineDatabase.text(row, 2),
                  let mode = OfflineDatabase.text(row, 3) else { return }
            routes[OfflineDatabase.int(row, 0)] = RouteRef(line: shortName.isEmpty ? longName : shortName, mode: mode)
        }
        var stops: [Int: StopRef] = [:]
        try database.rows("SELECT id,stop_id,station_id,platform FROM stops") { row in
            guard let stopId = OfflineDatabase.text(row, 1), let stationId = OfflineDatabase.text(row, 2) else { return }
            stops[OfflineDatabase.int(row, 0)] = StopRef(
                stopId: stopId,
                stationId: stationId,
                platform: OfflineDatabase.text(row, 3)
            )
        }
        var trips: [Int: TripRef] = [:]
        try database.rows("SELECT id,source,trip_id,route,headsign FROM trips") { row in
            guard let source = sources[OfflineDatabase.int(row, 1)],
                  let tripId = OfflineDatabase.text(row, 2),
                  let route = routes[OfflineDatabase.int(row, 3)],
                  let headsign = OfflineDatabase.text(row, 4) else { return }
            trips[OfflineDatabase.int(row, 0)] = TripRef(source: source, tripId: tripId, route: route, headsign: headsign)
        }
        stopsById = stops
        tripsById = trips
    }

    private func assignmentFor(_ database: OfflineDatabase, source: String, stopId: String) -> StopAssignment? {
        var assignment: StopAssignment?
        try? database.rows(
            "SELECT st.platform,st.station_id FROM stops st JOIN sources src ON src.id=st.source WHERE src.name=? AND st.stop_id=?",
            bindings: [.text(source), .text(stopId)]
        ) { row in
            if let stationId = OfflineDatabase.text(row, 1) {
                assignment = StopAssignment(platform: OfflineDatabase.text(row, 0), stationId: stationId)
            }
        }
        return assignment
    }

    private func parseManifest(_ data: Data) throws -> PackageInfo {
        let manifest = try JSONDecoder().decode(Manifest.self, from: data)
        let candidates = manifest.packages.filter { $0.source == "network" }
        guard manifest.schemaVersion == 1,
              candidates.count == 1,
              candidates[0].schemaVersion == 1,
              candidates[0].sha256.count == 64,
              candidates[0].sha256.allSatisfy({ $0.isHexDigit && !$0.isUppercase }),
              candidates[0].bytes >= 0,
              candidates[0].bytes <= 300 * 1_024 * 1_024,
              Self.parseCompactDate(candidates[0].serviceDateFrom) != nil,
              Self.parseCompactDate(candidates[0].serviceDateTo) != nil,
              candidates[0].serviceDateFrom <= candidates[0].serviceDateTo else {
            throw OfflineCoreError.invalidManifest
        }
        var info = candidates[0]
        info.generatedAt = manifest.generatedAt.value
        return info
    }

    private func downloadPackage(_ url: URL, to destination: URL, expectedBytes: Int64) async throws {
        let (temporary, response) = try await URLSession.shared.download(from: url)
        defer { try? FileManager.default.removeItem(at: temporary) }
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw OfflineCoreError.invalidResponse
        }
        let size = try FileManager.default.attributesOfItem(atPath: temporary.path)[.size] as? NSNumber
        guard size?.int64Value == expectedBytes else { throw OfflineCoreError.invalidPackage }
        if FileManager.default.fileExists(atPath: destination.path) { try FileManager.default.removeItem(at: destination) }
        try FileManager.default.moveItem(at: temporary, to: destination)
    }

    private static func sha256(_ url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }
        var hash = SHA256()
        while let data = try handle.read(upToCount: 1_024 * 1_024), !data.isEmpty { hash.update(data: data) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func endpoint(_ baseURL: String, path: String) -> URL? {
        guard var components = URLComponents(string: baseURL) else { return nil }
        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = (basePath.isEmpty ? "" : "/\(basePath)") + path
        guard let url = components.url, isSecure(url) else { return nil }
        return url
    }

    private static func isSecure(_ url: URL) -> Bool {
        url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(url.host))
    }

    private static func hasLongWait(_ journey: Journey) -> Bool {
        zip(journey.legs, journey.legs.dropFirst()).contains { $1.departure - $0.arrival > 3_600_000 }
    }

    private static func connectionOrder(_ left: ScheduledConnection, _ right: ScheduledConnection) -> Bool {
        if left.effectiveDeparture != right.effectiveDeparture { return left.effectiveDeparture < right.effectiveDeparture }
        if left.tripKey != right.tripKey { return left.tripKey < right.tripKey }
        return left.fromSequence < right.fromSequence
    }

    private static func fastEpochBase(_ serviceDate: String) -> Millis? {
        guard let start = parseCompactDate(serviceDate),
              let end = sydneyCalendar.date(byAdding: .day, value: 2, to: start) else { return nil }
        if let transition = sydneyTimeZone.nextDaylightSavingTimeTransition(after: start.addingTimeInterval(-1)), transition < end {
            return nil
        }
        return start.timeIntervalSince1970 * 1_000
    }

    private static func startOfSydneyDay(_ date: Date) -> Date { sydneyCalendar.startOfDay(for: date) }

    private static func secondsOfDay(_ components: DateComponents) -> Int {
        (components.hour ?? 0) * 3_600 + (components.minute ?? 0) * 60 + (components.second ?? 0)
    }

    private static func compactDate(containing millis: Millis) -> String {
        compactDate(Date(timeIntervalSince1970: millis / 1_000))
    }

    private static func compactDate(_ date: Date) -> String {
        let parts = sydneyCalendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d%02d%02d", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
    }

    private static func parseCompactDate(_ value: String) -> Date? {
        guard value.count == 8,
              let year = Int(value.prefix(4)),
              let month = Int(value.dropFirst(4).prefix(2)),
              let day = Int(value.suffix(2)) else { return nil }
        var components = DateComponents()
        components.calendar = sydneyCalendar
        components.timeZone = sydneyTimeZone
        components.year = year
        components.month = month
        components.day = day
        guard let date = sydneyCalendar.date(from: components), compactDate(date) == value else { return nil }
        return date
    }

    private static func coverage(from: String, to: String) -> String {
        guard let first = parseCompactDate(from), let last = parseCompactDate(to) else { return "Timetable unavailable" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_AU")
        formatter.timeZone = sydneyTimeZone
        formatter.dateFormat = "d MMM yyyy"
        return "\(formatter.string(from: first))–\(formatter.string(from: last))"
    }

    private static let initialHorizonHours = 6
    private static let maximumHorizonHours = 30
    private static let sydneyTimeZone = TimeZone(identifier: "Australia/Sydney")!
    private static let sydneyCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = sydneyTimeZone
        return calendar
    }()
}
