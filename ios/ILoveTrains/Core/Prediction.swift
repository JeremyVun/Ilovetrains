import Foundation

struct Fix: Codable, Equatable, Sendable {
    var lat: Double
    var lon: Double
    var at: Millis
    var speed: Double?

    init(lat: Double, lon: Double, at: Millis, speed: Double? = nil) {
        self.lat = lat
        self.lon = lon
        self.at = at
        self.speed = speed
    }
}

struct Selection: Codable, Equatable, Sendable {
    var tripId: String
    var reverse: Bool
    var receipt: String?

    init(tripId: String, reverse: Bool, receipt: String? = nil) {
        self.tripId = tripId
        self.reverse = reverse
        self.receipt = receipt
    }
}

func distanceMetres(_ fix: Fix, _ station: Station) -> Double {
    guard station.lat != 0 || station.lon != 0 else { return .infinity }
    let radians = Double.pi / 180
    let latitude = (station.lat - fix.lat) * radians
    let longitude = (station.lon - fix.lon) * radians
    let h = pow(sin(latitude / 2), 2)
        + cos(fix.lat * radians) * cos(station.lat * radians) * pow(sin(longitude / 2), 2)
    return 6_371_000 * 2 * atan2(sqrt(h.clamped(to: 0...1)), sqrt((1 - h).clamped(to: 0...1)))
}

func compatible(_ trip: SavedTrip, modes: Set<String>) -> Bool {
    !modes.isEmpty && [trip.from, trip.to].allSatisfy { !$0.modes.intersection(modes).isEmpty }
}

func visibleFocus(data: UserData, now: Millis) -> FocusedJourney? {
    guard let focus = data.focus,
          now <= focus.journey.effectiveArrival + 1_800_000,
          let trip = data.trips.first(where: { $0.id == focus.tripId }),
          compatible(trip, modes: data.modes),
          focus.journey.legs.allSatisfy({ data.modes.contains($0.mode) }) else { return nil }
    return focus
}

func automaticHome(data: UserData) -> Station? {
    let grouped = Dictionary(grouping: data.votes, by: { $0.station.id })
    let winner = grouped.values
        .filter { $0.count >= 3 }
        .max { lhs, rhs in
            if lhs.count != rhs.count { return lhs.count < rhs.count }
            return (lhs.last?.day ?? "") < (rhs.last?.day ?? "")
        }
    return winner?.last?.station ?? data.trips.first?.from
}

func historyScore(events: [ViewEvent], tripId: String, reverse: Bool, now: Millis) -> Double {
    let current = sydneyCalendar.dateComponents([.weekday, .hour], from: epochDate(now))
    return events.lazy
        .filter { $0.tripId == tripId && $0.reverse == reverse }
        .reduce(0) { total, event in
            let date = sydneyCalendar.dateComponents([.weekday, .hour], from: epochDate(event.at))
            let hourDistance = min(abs((current.hour ?? 0) - (date.hour ?? 0)), 24 - abs((current.hour ?? 0) - (date.hour ?? 0)))
            let hourWeight: Double = hourDistance <= 1 ? 1 : hourDistance <= 2 ? 0.5 : 0
            let currentWeekend = (current.weekday == 1 || current.weekday == 7)
            let eventWeekend = (date.weekday == 1 || date.weekday == 7)
            let dayWeight: Double = currentWeekend == eventWeekend ? 1 : 0.2
            let age = max(0, (now - event.at) / 86_400_000)
            return total + hourWeight * dayWeight * pow(0.97, age)
        }
}

func stationHere(data: UserData, stations: [Station], fix: Fix?, now: Millis) -> Station? {
    guard data.useLocation, let fix, isCurrent(fix, now: now) else { return nil }

    var seen = Set<String>()
    let saved = data.trips
        .flatMap { [$0.from, $0.to] }
        .map { endpoint in stations.first(where: { $0.id == endpoint.id }) ?? endpoint }
        .filter { seen.insert($0.id).inserted && !$0.modes.intersection(data.modes).isEmpty }
    let eligible = stations.filter { !$0.modes.intersection(data.modes).isEmpty }

    func nearest(_ candidates: [Station], within metres: Double) -> Station? {
        candidates
            .map { ($0, distanceMetres(fix, $0)) }
            .filter { $0.1 <= metres }
            .min { $0.1 < $1.1 }?
            .0
    }

    return nearest(saved, within: 200)
        ?? nearest(eligible, within: 200)
        ?? nearest(saved, within: 2_000)
        ?? nearest(eligible, within: 2_000)
}

func predict(data: UserData, stations: [Station], fix: Fix?, now: Millis) -> Selection? {
    let trips = data.trips.filter { compatible($0, modes: data.modes) }
    guard !trips.isEmpty else { return nil }

    let currentFix = data.useLocation && fix.map { isCurrent($0, now: now) } == true
    let here = stationHere(data: data, stations: stations, fix: fix, now: now)
    let candidates = trips.flatMap { trip in
        [false, true].map { reverse in
            let origin = reverse ? trip.to : trip.from
            let metres = currentFix ? distanceMetres(fix!, origin) : .infinity
            let factor: Double = !metres.isFinite ? 1 : metres <= 2_000 ? 2.5 : metres <= 10_000 ? 1 : 0.3
            let base = historyScore(events: data.history, tripId: trip.id, reverse: reverse, now: now)
            return PredictionCandidate(
                trip: trip,
                reverse: reverse,
                score: here == nil ? (base + 0.01) * factor : base
            )
        }
    }
    let local = candidates.filter { $0.from.id == here?.id }
    let pool = local.isEmpty ? candidates : local
    let best = pool.map(\.score).max() ?? 0
    let leaders = pool.filter { $0.score == best }
    let home = data.home ?? automaticHome(data: data)
    let homeward = !local.isEmpty && here?.id != home?.id
        ? local.first(where: { $0.to.id == home?.id })
        : nil
    let selected = (best > 0 && leaders.count == 1 ? leaders.first : nil)
        ?? homeward
        ?? pool.first(where: { $0.trip.id == data.lastTripId && $0.reverse == data.lastReverse })
        ?? pool[0]
    let receipt: String?
    if selected == homeward, !(best > 0 && leaders.count == 1) {
        let votes = data.votes.filter { $0.station.id == home?.id }.count
        receipt = votes >= 3
            ? "Your days usually start at \(home?.shortName ?? "")."
            : "You usually travel from \(home?.shortName ?? "")."
    } else if here == nil, !currentFix, trips.count >= 2 {
        receipt = historyReceipt(data.history, tripId: selected.trip.id, reverse: selected.reverse, now: now)
    } else {
        receipt = nil
    }
    return Selection(tripId: selected.trip.id, reverse: selected.reverse, receipt: receipt)
}

func inferredFocus(data: UserData, fix: Fix, now: Millis) -> FocusedJourney? {
    guard data.useLocation,
          data.focus == nil,
          isCurrent(fix, now: now),
          let last = data.lastAnswer,
          let trip = data.trips.first(where: { $0.id == last.tripId }),
          compatible(trip, modes: data.modes),
          last.journey.legs.allSatisfy({ data.modes.contains($0.mode) }),
          !data.rides.contains(where: { $0.tripId == trip.id && $0.reverse == last.reverse && $0.departure == last.journey.departure }) else { return nil }

    let from = last.reverse ? trip.to : trip.from
    let to = last.reverse ? trip.from : trip.to
    let journey = last.journey
    guard (journey.effectiveDeparture...(journey.effectiveArrival + 1_800_000)).contains(now),
          last.stationId == from.id,
          (0...900_000).contains(journey.effectiveDeparture - last.at) else { return nil }

    let left = distanceMetres(fix, from)
    let tripDistance = distanceMetres(Fix(lat: from.lat, lon: from.lon, at: now), to)
    let toward = left >= 1_000 && distanceMetres(fix, to) <= tripDistance - 1_000
    let fast = (fix.speed ?? 0) >= 8 && left >= 200
    guard left.isFinite, tripDistance.isFinite, toward || fast else { return nil }
    return FocusedJourney(tripId: trip.id, reverse: last.reverse, journey: journey, board: last.board, pinned: false)
}

func savedTripMetadata(
    data: UserData,
    fix: Fix?,
    selectedTripId: String?,
    selectedReverse: Bool,
    now: Millis
) -> [String: String] {
    let currentFix = data.useLocation && fix.map { isCurrent($0, now: now) } == true ? fix : nil
    let today = sydneyCalendar.startOfDay(for: epochDate(now))
    return Dictionary(uniqueKeysWithValues: data.trips.map { trip in
        let reverse: Bool
        if data.focus?.tripId == trip.id {
            reverse = data.focus?.reverse ?? false
        } else if selectedTripId == trip.id {
            reverse = selectedReverse
        } else {
            reverse = false
        }
        let origin = reverse ? trip.to : trip.from
        let distance = currentFix
            .map { distanceMetres($0, origin) }
            .flatMap { $0.isFinite ? formatSavedDistance($0) : nil }
        let latest = data.rides
            .filter { $0.tripId == trip.id && $0.arrival > 0 && $0.arrival <= now }
            .max { $0.arrival < $1.arrival }
        let ridden: String
        if let latest {
            let arrival = epochDate(latest.arrival)
            let days = sydneyCalendar.dateComponents([.day], from: sydneyCalendar.startOfDay(for: arrival), to: today).day ?? 0
            switch days {
            case 0: ridden = "Rode it today"
            case 1: ridden = "Last ridden yesterday"
            case 2...6: ridden = "Last ridden \(weekdayFormatter.string(from: arrival))"
            default: ridden = "Last ridden \(dayFormatter.string(from: arrival))"
            }
        } else {
            ridden = "Never ridden"
        }
        return (trip.id, [distance, ridden].compactMap { $0 }.joined(separator: " · "))
    })
}

private struct PredictionCandidate: Equatable {
    var trip: SavedTrip
    var reverse: Bool
    var score: Double
    var from: Station { reverse ? trip.to : trip.from }
    var to: Station { reverse ? trip.from : trip.to }
}

private func isCurrent(_ fix: Fix, now: Millis) -> Bool {
    (0...300_000).contains(now - fix.at)
}

private func epochDate(_ time: Millis) -> Date {
    Date(timeIntervalSince1970: time / 1_000)
}

private func historyReceipt(_ history: [ViewEvent], tripId: String, reverse: Bool, now: Millis) -> String? {
    let current = sydneyCalendar.dateComponents([.weekday, .hour], from: epochDate(now))
    let matches = history.filter { event in
        guard event.tripId == tripId, event.reverse == reverse else { return false }
        let date = sydneyCalendar.dateComponents([.weekday, .hour, .year, .month, .day], from: epochDate(event.at))
        let sameDayType = (current.weekday == 1 || current.weekday == 7) == (date.weekday == 1 || date.weekday == 7)
        let difference = abs((current.hour ?? 0) - (date.hour ?? 0))
        return sameDayType && min(difference, 24 - difference) <= 2
    }
    guard matches.count >= 3 else { return nil }
    let weekday = current.weekday != 1 && current.weekday != 7
    let morning = (current.hour ?? 0) < 12
    let days = Set(matches.map { sydneyCalendar.startOfDay(for: epochDate($0.at)) })
    return weekday && morning && days.count >= 3
        ? "You check this trip most weekday mornings."
        : "You often check this trip around now."
}

private func formatSavedDistance(_ metres: Double) -> String {
    if metres < 1_000 {
        return "\(max(10, Int((metres / 10).rounded()) * 10)) m away"
    }
    if metres < 10_000 {
        return String(format: "%.1f km away", locale: Locale(identifier: "en_AU_POSIX"), metres / 1_000)
    }
    return "\(Int((metres / 1_000).rounded())) km away"
}

private let weekdayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_AU")
    formatter.timeZone = sydneyZone
    formatter.dateFormat = "EEEE"
    return formatter
}()

private let dayFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_AU")
    formatter.timeZone = sydneyZone
    formatter.dateFormat = "d MMM"
    return formatter
}()

private extension Comparable {
    func clamped(to range: ClosedRange<Self>) -> Self {
        min(max(self, range.lowerBound), range.upperBound)
    }
}
