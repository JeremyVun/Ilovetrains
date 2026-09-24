import Foundation

func orderedLineCodes(_ journey: Journey) -> [String] {
    var seen = Set<String>()
    return journey.legs.map(\.line).filter { !$0.isEmpty && seen.insert($0).inserted }
}

func platformText(_ raw: String?, mode: String, full: Bool = false) -> String? {
    guard var value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    value = value.replacingOccurrences(of: "^(Platform|Wharf)\\s*", with: "", options: [.regularExpression, .caseInsensitive])
    if mode.lowercased() == "ferry" {
        guard let range = value.range(of: "\\d+", options: .regularExpression) else { return full ? raw : "Wharf" }
        let number = String(value[range])
        var side: String?
        if let sideRange = value.range(of: "Side\\s*[A-Za-z0-9]+", options: [.regularExpression, .caseInsensitive]) {
            side = String(value[sideRange]).replacingOccurrences(of: "Side", with: "", options: .caseInsensitive).trimmingCharacters(in: .whitespaces)
        }
        return full ? "Wharf \(number)" + (side.map { ", Side \($0)" } ?? "") : number + (side ?? "")
    }
    let token = value.range(of: "[A-Za-z0-9]+(?:[A-Za-z])?", options: .regularExpression).map { String(value[$0]) } ?? value
    return full ? "Platform \(token)" : token
}

func departurePlatformText(_ raw: String?, mode: String) -> String? {
    guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    if mode.lowercased() == "ferry",
       value.range(of: "\\d+|\\bSide\\s*[A-Za-z0-9]+", options: [.regularExpression, .caseInsensitive]) == nil {
        return "Wharf"
    }
    return platformText(raw, mode: mode, full: true)
}

func transferPlatformText(_ raw: String?, mode: String) -> String? {
    guard mode.lowercased() == "ferry" else { return platformText(raw, mode: mode) }
    guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    let number = value.range(of: "\\d+", options: .regularExpression).map { String(value[$0]) }
    let side = value.range(of: "(?<=Side)\\s*[A-Za-z0-9]+", options: [.regularExpression, .caseInsensitive])
        .map { String(value[$0]).trimmingCharacters(in: .whitespaces).uppercased() }
    if let number { return number + (side ?? "") }
    return side ?? "—"
}

func genericModeName(_ mode: String) -> String { mode == "ferry" ? "ferry" : "train" }

func minutesBetween(_ from: Millis, _ to: Millis) -> Int {
    Int(to / 60_000) - Int(from / 60_000)
}

enum ConnectionState: String, Codable, Equatable, Sendable {
    case ordinary, tight, lost, broken
}

/// Printed clock minutes, so a window agrees with the two times printed beside it.
func connectionWindow(_ before: Leg, _ after: Leg) -> Int {
    minutesBetween(before.effectiveArrival, after.effectiveDeparture)
}

func connectionState(_ before: Leg, _ after: Leg, recovery: Bool = false) -> ConnectionState {
    if before.cancelled || after.cancelled { return .broken }
    let window = connectionWindow(before, after)
    if window <= 0 { return .lost }
    // A recovery pair was never printed together, so only the window decides it.
    let printed = recovery ? window : minutesBetween(before.arrival, after.departure)
    return window < 5 || window < printed ? .tight : .ordinary
}

func connectionStates(_ legs: [Leg], recoveryFrom changeIndex: Int? = nil) -> [ConnectionState] {
    legs.indices.dropLast().map { index in
        connectionState(legs[index], legs[index + 1], recovery: changeIndex.map { index >= $0 } ?? false)
    }
}
