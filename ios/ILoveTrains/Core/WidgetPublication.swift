import Foundation

struct WidgetScheduleInputs: Equatable, Sendable {
    var trips: [SavedTrip]
    var history: [ViewEvent]
    var modes: Set<String>
    var lastTripId: String?
    var lastReverse: Bool
    var start: Millis

    init(data: UserData, now: Millis) {
        trips = data.trips
        history = data.history
        modes = data.modes
        lastTripId = data.lastTripId
        lastReverse = data.lastReverse
        start = widgetHourStart(now)
    }
}

func widgetSchedule(data: UserData, stations: [Station], now: Millis) -> [WidgetScheduleEntry] {
    widgetSchedule(from: now) { at in
        predict(data: data, stations: stations, fix: nil, now: at).map { (tripId: $0.tripId, reverse: $0.reverse) }
    }
}

func widgetFocusExpiry(_ focus: FocusedJourney, now: Millis) -> Millis {
    let arrival = focus.composedJourney.effectiveArrival
    let guardState = normalizeArrivalGuard(focus.arrivalGuard)
    guard guardState?.armed == true, guardState?.basis != .location else { return arrival + ArrivalRules.expiry }
    return max(arrival + ArrivalRules.expiry, (guardState?.retainedAt ?? min(arrival, now)) + ArrivalRules.retention)
}

func widgetBoardPairs(data: UserData, schedule: [WidgetScheduleEntry]) -> [(Station, Station)] {
    var seen = Set<String>()
    return schedule.compactMap { entry in
        guard let trip = data.trips.first(where: { $0.id == entry.tripId }) else { return nil }
        let pair = entry.reverse ? (trip.to, trip.from) : (trip.from, trip.to)
        return seen.insert("\(pair.0.id)|\(pair.1.id)").inserted ? pair : nil
    }
}

func widgetSnapshot(data: UserData, schedule: [WidgetScheduleEntry], boards: [BoardData], now: Millis) -> WidgetSnapshot {
    func stop(_ station: Station) -> WidgetStop {
        WidgetStop(id: station.id, name: station.name, modes: canonicalWidgetModes(station.modes))
    }
    let trips = data.trips.filter { compatible($0, modes: data.modes) }
        .map { WidgetTrip(id: $0.id, from: stop($0.from), to: stop($0.to)) }
    let pairs = Set(widgetBoardPairs(data: data, schedule: schedule).map { "\($0.0.id)|\($0.1.id)" })
    var seen = Set<String>()
    let published = boards.compactMap { board -> BoardData? in
        let key = "\(board.from.id)|\(board.to.id)"
        guard pairs.contains(key), seen.insert(key).inserted else { return nil }
        let journeys = data.withinTransferLimit(board).journeys.filter { $0.effectiveDeparture >= now }.prefix(widgetBoardLimit)
        return BoardData(from: board.from, to: board.to, journeys: Array(journeys), generatedAt: board.generatedAt,
                         source: board.source, offline: board.offline, serverStale: board.serverStale)
    }
    let focus = visibleFocus(data: data, now: now).flatMap { focus -> WidgetFocus? in
        let expiresAt = widgetFocusExpiry(focus, now: now)
        guard data.withinTransferLimit(focus.journey), now <= expiresAt else { return nil }
        let board = BoardData(from: focus.board.from, to: focus.board.to, journeys: [focus.journey],
                              generatedAt: focus.board.generatedAt, source: focus.board.source,
                              offline: focus.board.offline, serverStale: focus.board.serverStale)
        return WidgetFocus(tripId: focus.tripId, reverse: focus.reverse, pinned: focus.pinned,
                           journey: focus.journey, board: board, expiresAt: expiresAt)
    }
    return WidgetSnapshot(
        writtenAt: now,
        trips: trips,
        schedule: trips.isEmpty ? [] : schedule,
        focus: focus,
        modes: canonicalWidgetModes(data.modes),
        transferCap: data.requestTransferLimit,
        boards: published
    )
}
