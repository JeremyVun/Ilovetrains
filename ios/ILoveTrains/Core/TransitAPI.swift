import Foundation

struct TransitAPI: Sendable {
    var baseURL = "https://ilovetrains.jeremyvun.com"
    var session: URLSession = .shared

    func departures(from: Station, to: Station, modes: Set<String>, at: Double? = nil, transferLimit: Int? = nil) async throws -> BoardData {
        var url = URLComponents(string: baseURL + "/api/v1/departures")!
        url.queryItems = [URLQueryItem(name: "from", value: from.id), URLQueryItem(name: "to", value: to.id),
            URLQueryItem(name: "limit", value: "10"), URLQueryItem(name: "modes", value: modes.sorted().joined(separator: ","))]
        if let at { url.queryItems?.append(URLQueryItem(name: "at", value: ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: at / 1000)))) }
        if let transferLimit { url.queryItems?.append(URLQueryItem(name: "transferLimit", value: String(transferLimit))) }
        var request = URLRequest(url: url.url!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, bytes.count <= 2_000_000 else { throw TransitError.unavailable }
        var board = try TransitWire.board(bytes)
        board.from = from; board.to = to
        board.serverStale = http.value(forHTTPHeaderField: "X-Data-Stale")?.lowercased() == "true"
        return board
    }

    func flags() async throws -> [String: Bool] {
        var request = URLRequest(url: URL(string: baseURL + "/api/v1/flags")!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200, bytes.count <= 65_536 else { throw TransitError.unavailable }
        return try TransitWire.flags(bytes)
    }

    func feedback(text: String, category: String) async throws {
        let text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, text.utf8.count <= 8192, !text.contains("\0"), ["problem", "suggestion", "other"].contains(category) else { throw TransitError.invalid }
        let bytes = try JSONSerialization.data(withJSONObject: ["project": "ilovetrains", "category": category, "feedback": text])
        guard bytes.count <= 10_240 else { throw TransitError.invalid }
        var request = URLRequest(url: URL(string: "https://analytics.jeremyvun.com/feedback")!, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 12)
        request.httpMethod = "POST"; request.httpBody = bytes
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 201 else { throw TransitError.unavailable }
    }
}
enum TransitError: Error { case unavailable, invalid }

enum TransitWire {
    static func epoch(_ value: Any?) -> Double? {
        if let number = value as? NSNumber { return number.doubleValue.rounded() }
        guard let string = value as? String else { return nil }
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = format.date(from: string) { return (date.timeIntervalSince1970 * 1000).rounded() }
        format.formatOptions = [.withInternetDateTime]
        return format.date(from: string).map { ($0.timeIntervalSince1970 * 1000).rounded() }
    }
    static func boolean(_ value: Any?) -> Bool? {
        // JSON numbers also bridge to NSNumber and cast to Bool, so ask for the boolean type itself.
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }
    static func flags(_ bytes: Data) throws -> [String: Bool] {
        guard let raw = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { throw TransitError.invalid }
        return raw.compactMapValues(boolean)
    }
    static func station(_ raw: [String: Any]) throws -> Station {
        guard let id = raw["id"] as? String, let name = raw["name"] as? String else { throw TransitError.invalid }
        let location = raw["location"] as? [String: Double] ?? [:]
        return Station(id: id, name: name, lat: location["lat"] ?? 0, lon: location["lon"] ?? 0, modes: (raw["modes"] as? [String]).map(Set.init) ?? allModes)
    }
    static func journey(_ raw: [String: Any]) throws -> Journey {
        guard let rows = raw["legDetail"] as? [[String: Any]], !rows.isEmpty else { throw TransitError.invalid }
        let legs = try rows.map { row -> Leg in
            guard let line = row["line"] as? [String: String], let name = line["name"], let mode = line["mode"],
                  let from = row["from"] as? [String: Any], let to = row["to"] as? [String: Any],
                  let dep = row["departure"] as? [String: Any], let arr = row["arrival"] as? [String: Any],
                  let departure = epoch(dep["scheduled"]), let arrival = epoch(arr["scheduled"]), arrival >= departure else { throw TransitError.invalid }
            return Leg(line: name, mode: mode, headsign: row["headsign"] as? String ?? "", from: try station(from), to: try station(to),
                departure: departure, arrival: arrival, estimatedDeparture: epoch(dep["estimated"]), estimatedArrival: epoch(arr["estimated"]),
                fromPlatform: from["platform"] as? String, toPlatform: to["platform"] as? String, cancelled: row["cancelled"] as? Bool ?? false)
        }
        return Journey(legs: legs)
    }
    static func board(_ bytes: Data) throws -> BoardData {
        guard let raw = try JSONSerialization.jsonObject(with: bytes) as? [String: Any],
              let from = raw["from"] as? [String: Any], let to = raw["to"] as? [String: Any],
              let journeys = raw["journeys"] as? [[String: Any]], let generated = epoch(raw["generatedAt"]) else { throw TransitError.invalid }
        return BoardData(from: try station(from), to: try station(to), journeys: journeys.compactMap { try? journey($0) }, generatedAt: generated, source: "live")
    }
}
