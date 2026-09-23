import Foundation

let widgetAppGroup = "group.com.ilovetrains.ios"
let homeWidgetKind = "ILoveTrainsHome"
let widgetSnapshotFileName = "widget-v1.json"
let widgetScheduleHours = 168
let widgetBoardLimit = 8
let widgetLiveRefresh: Millis = 900_000
let widgetTimelineHorizon: Millis = 10_800_000
private let hourMillis: Millis = 3_600_000
private let widgetCalendar = sydneyCalendar

struct WidgetStop: Codable, Equatable, Sendable {
    var id: String
    var name: String
    var modes: [String]

    var station: Station { Station(id: id, name: name, modes: Set(modes)) }
}

struct WidgetTrip: Codable, Equatable, Sendable {
    var id: String
    var from: WidgetStop
    var to: WidgetStop
}

struct WidgetScheduleEntry: Codable, Equatable, Sendable {
    var at: Millis
    var tripId: String
    var reverse: Bool
}

struct WidgetFocus: Codable, Equatable, Sendable {
    var tripId: String
    var reverse: Bool
    var pinned: Bool
    var journey: Journey
    var board: BoardData
    var expiresAt: Millis
}

/// Everything the widget may know about the rider; only the app writes it.
struct WidgetSnapshot: Codable, Equatable, Sendable {
    var schemaVersion = 1
    var writtenAt: Millis
    var trips: [WidgetTrip]
    var schedule: [WidgetScheduleEntry]
    var focus: WidgetFocus?
    var modes: [String]
    var transferCap: Int?
    var boards: [BoardData]

    func board(from: String, to: String) -> BoardData? {
        boards.first { $0.from.id == from && $0.to.id == to }
    }

    func eligible(_ journey: Journey) -> Bool {
        journeyAllowed(journey, modes: Set(modes)) && (transferCap.map { journey.legs.count - 1 <= $0 } ?? true)
    }
}

struct WidgetAnswer: Equatable, Sendable {
    var trip: WidgetTrip
    var reverse: Bool
    var focus: WidgetFocus?

    var from: WidgetStop { reverse ? trip.to : trip.from }
    var to: WidgetStop { reverse ? trip.from : trip.to }
}

struct WidgetRequest: Equatable, Sendable {
    var key: String
    var from: Station
    var to: Station
    var modes: Set<String>
    var at: Millis?
    var transferLimit: Int?
    var focusJourneyKey: String?
    var fallback: BoardData?
}

struct WidgetContent: Equatable, Sendable {
    var date: Millis
    var answer: WidgetAnswer?
    var board: BoardData?
    var next: Journey?
    var following: [Journey]
    var provenance: String?
}

func canonicalWidgetModes(_ modes: Set<String>) -> [String] {
    ["train", "metro", "ferry"].filter(modes.contains)
}

// Sydney's UTC offsets are whole hours, so its hour boundaries are UTC's.
func widgetHourStart(_ t: Millis) -> Millis {
    (t / hourMillis).rounded(.down) * hourMillis
}

func widgetSchedule(
    from now: Millis,
    hours: Int = widgetScheduleHours,
    predict: (Millis) -> (tripId: String, reverse: Bool)?
) -> [WidgetScheduleEntry] {
    let start = widgetHourStart(now)
    return (0..<hours).compactMap { hour in
        let at = start + Millis(hour) * hourMillis
        return predict(at).map { WidgetScheduleEntry(at: at, tripId: $0.tripId, reverse: $0.reverse) }
    }
}

private func weekHour(_ t: Millis) -> Int {
    let parts = widgetCalendar.dateComponents([.weekday, .hour], from: Date(timeIntervalSince1970: t / 1_000))
    return (parts.weekday ?? 0) * 24 + (parts.hour ?? 0)
}

func widgetScheduleEntry(_ schedule: [WidgetScheduleEntry], at t: Millis) -> WidgetScheduleEntry? {
    guard let first = schedule.first, t.isFinite else { return nil }
    let offset = ((t - first.at) / hourMillis).rounded(.down)
    if offset >= 0, offset < Millis(schedule.count) {
        let entry = schedule[Int(offset)]
        if entry.at <= t, t < entry.at + hourMillis { return entry }
    }
    // Local weekday and hour, not elapsed weeks, so a daylight-saving change keeps 8am at 8am.
    for back in 0..<3 {
        let key = weekHour(t - Millis(back) * hourMillis)
        if let match = schedule.last(where: { weekHour($0.at) == key }) { return match }
    }
    return nil
}

func widgetAnswer(_ snapshot: WidgetSnapshot, at t: Millis) -> WidgetAnswer? {
    if let focus = snapshot.focus, t <= focus.expiresAt,
       let trip = snapshot.trips.first(where: { $0.id == focus.tripId }) {
        return WidgetAnswer(trip: trip, reverse: focus.reverse, focus: focus)
    }
    guard let entry = widgetScheduleEntry(snapshot.schedule, at: t),
          let trip = snapshot.trips.first(where: { $0.id == entry.tripId }) else { return nil }
    return WidgetAnswer(trip: trip, reverse: entry.reverse)
}

func widgetRequest(for answer: WidgetAnswer, in snapshot: WidgetSnapshot, now: Millis) -> WidgetRequest {
    let pair = "\(answer.from.id)|\(answer.to.id)"
    if let focus = answer.focus {
        // The followed service is asked for whole, as the app does: every mode, no cap, its own departure window once gone.
        let departed = focus.journey.departure < now
        return WidgetRequest(
            key: "focus|\(pair)|\(focus.journey.key)",
            from: answer.from.station,
            to: answer.to.station,
            modes: allModes,
            at: departed ? max(now - 86_400_000, focus.journey.departure) : nil,
            focusJourneyKey: focus.journey.key,
            fallback: focus.board
        )
    }
    return WidgetRequest(
        key: "pair|\(pair)|\(snapshot.modes.joined(separator: ","))|\(snapshot.transferCap.map(String.init) ?? "")",
        from: answer.from.station,
        to: answer.to.station,
        modes: Set(snapshot.modes),
        transferLimit: snapshot.transferCap,
        fallback: snapshot.board(from: answer.from.id, to: answer.to.id)
    )
}

func widgetNextAnswerChange(_ snapshot: WidgetSnapshot, after t: Millis, until: Millis) -> Millis? {
    if let focus = snapshot.focus, t <= focus.expiresAt, snapshot.trips.contains(where: { $0.id == focus.tripId }) {
        return focus.expiresAt + 1 <= until ? focus.expiresAt + 1 : nil
    }
    let current = widgetAnswer(snapshot, at: t)
    var boundary = widgetHourStart(t) + hourMillis
    while boundary <= until {
        if widgetAnswer(snapshot, at: boundary) != current { return boundary }
        boundary += hourMillis
    }
    return nil
}

func widgetRequests(_ snapshot: WidgetSnapshot, from now: Millis, until: Millis, limit: Int = 3) -> [WidgetRequest] {
    var requests: [WidgetRequest] = []
    var t = now
    while requests.count < limit {
        if let answer = widgetAnswer(snapshot, at: t) {
            let request = widgetRequest(for: answer, in: snapshot, now: now)
            if !requests.contains(where: { $0.key == request.key }) { requests.append(request) }
        }
        guard let next = widgetNextAnswerChange(snapshot, after: t, until: until) else { break }
        t = next
    }
    return requests
}

/// A failed or unmatched fetch shows the app's last board as the app shows a retained one.
func widgetSource(_ request: WidgetRequest, fetched: BoardData?) -> BoardData? {
    if let fetched {
        guard let key = request.focusJourneyKey else { return fetched }
        if let match = fetched.journeys.first(where: { $0.key == key }) {
            var board = fetched
            board.journeys = [match]
            return board
        }
    }
    return request.fallback.map(retainedOfflineBoard)
}

func widgetContent(_ snapshot: WidgetSnapshot, sources: [String: BoardData], at t: Millis) -> WidgetContent {
    guard let answer = widgetAnswer(snapshot, at: t) else {
        return WidgetContent(date: t, answer: nil, board: nil, next: nil, following: [], provenance: nil)
    }
    let board = sources[widgetRequest(for: answer, in: snapshot, now: t).key]
    if let focus = answer.focus {
        return WidgetContent(date: t, answer: answer, board: board, next: board?.journeys.first ?? focus.journey,
                             following: [], provenance: board.map { freshnessText($0, now: t) })
    }
    let upcoming = (board?.journeys ?? [])
        .filter { snapshot.eligible($0) && $0.effectiveDeparture > t }
        .sorted { $0.effectiveDeparture < $1.effectiveDeparture }
    let lead = upcoming.firstIndex { !$0.cancelled } ?? upcoming.indices.first
    return WidgetContent(
        date: t,
        answer: answer,
        board: board,
        next: lead.map { upcoming[$0] },
        following: lead.map { Array(upcoming[($0 + 1)...].prefix(2)) } ?? [],
        provenance: board.map { freshnessText($0, now: t) }
    )
}

func widgetNextBoundary(_ snapshot: WidgetSnapshot, sources: [String: BoardData], after t: Millis, until: Millis) -> Millis? {
    var candidates: [Millis] = []
    if let change = widgetNextAnswerChange(snapshot, after: t, until: until) { candidates.append(change) }
    if let answer = widgetAnswer(snapshot, at: t),
       let board = sources[widgetRequest(for: answer, in: snapshot, now: t).key] {
        let departures = answer.focus == nil
            ? board.journeys.filter(snapshot.eligible).map(\.effectiveDeparture)
            : board.journeys.prefix(1).map(\.effectiveDeparture)
        if let next = departures.filter({ $0 > t }).min() { candidates.append(next) }
        if board.isLive(t) { candidates.append(board.generatedAt + 90_001) }
    }
    return candidates.filter { $0 > t && $0 <= until }.min()
}

func widgetTimeline(
    _ snapshot: WidgetSnapshot,
    sources: [String: BoardData],
    from now: Millis,
    until: Millis,
    limit: Int = 60
) -> [WidgetContent] {
    var entries = [widgetContent(snapshot, sources: sources, at: now)]
    var t = now
    while entries.count < limit, let next = widgetNextBoundary(snapshot, sources: sources, after: t, until: until) {
        t = next
        entries.append(widgetContent(snapshot, sources: sources, at: t))
    }
    return entries
}

/// Board freshness alone never asks the system to redraw; the widget keeps its own refresh budget.
func widgetAnswerChanged(_ old: WidgetSnapshot?, _ new: WidgetSnapshot) -> Bool {
    guard let old else { return true }
    func focusIdentity(_ focus: WidgetFocus?) -> [String] {
        focus.map { [$0.tripId, String($0.reverse), String($0.pinned), $0.journey.key, String($0.expiresAt)] } ?? []
    }
    return old.trips != new.trips || old.schedule != new.schedule || old.modes != new.modes
        || old.transferCap != new.transferCap || focusIdentity(old.focus) != focusIdentity(new.focus)
}

func widgetContainerURL() -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: widgetAppGroup)
}

func readWidgetSnapshot(directory: URL?) -> WidgetSnapshot? {
    guard let url = directory?.appendingPathComponent(widgetSnapshotFileName),
          let data = try? Data(contentsOf: url),
          let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
          snapshot.schemaVersion == 1 else { return nil }
    return snapshot
}
