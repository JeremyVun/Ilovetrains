import Foundation

enum ArrivalState: String, Codable, Sendable {
    case travelling
    case checkingArrival
    case arrivalUnconfirmed
    case arrived
    case expiredUnconfirmed
}

enum ArrivalBasis: String, Codable, Sendable {
    case location
    case estimate
}

enum ArrivalAction: String, Codable, Sendable {
    case none
    case record
    case correct
    case withdraw
    case expire
}

struct ArrivalGuard: Codable, Equatable, Sendable {
    var armed: Bool?
    var retainedAt: Millis?
    var basis: ArrivalBasis?
    var confirmedAt: Millis?

    init(
        armed: Bool? = nil,
        retainedAt: Millis? = nil,
        basis: ArrivalBasis? = nil,
        confirmedAt: Millis? = nil
    ) {
        self.armed = armed
        self.retainedAt = retainedAt
        self.basis = basis
        self.confirmedAt = confirmedAt
    }

    private enum CodingKeys: String, CodingKey { case armed, retainedAt, basis, confirmedAt }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        armed = try? container.decodeIfPresent(Bool.self, forKey: .armed)
        retainedAt = (try? container.decodeIfPresent(Millis.self, forKey: .retainedAt)).flatMap {
            validTransitMillis($0) ? $0 : nil
        }
        confirmedAt = (try? container.decodeIfPresent(Millis.self, forKey: .confirmedAt)).flatMap {
            validTransitMillis($0) ? $0 : nil
        }
        let rawBasis = try? container.decodeIfPresent(String.self, forKey: .basis)
        basis = rawBasis.flatMap(ArrivalBasis.init(rawValue:))
        if basis == .location, confirmedAt == nil { basis = nil }
        if basis != .location { confirmedAt = nil }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(armed, forKey: .armed)
        if let retainedAt, validTransitMillis(retainedAt) { try container.encode(retainedAt, forKey: .retainedAt) }
        try container.encodeIfPresent(basis, forKey: .basis)
        if basis == .location, let confirmedAt, validTransitMillis(confirmedAt) {
            try container.encode(confirmedAt, forKey: .confirmedAt)
        }
    }
}

struct ArrivalSample: Equatable, Sendable {
    var lat: Double
    var lon: Double
    var at: Millis
    var accuracy: Double
    var speed: Double?
}

struct ArrivalWindow: Equatable, Sendable {
    var identity: String
    var samples: [ArrivalSample]
}

struct ArrivalInput: Sendable {
    var identity: String
    var departureMs: Millis
    var arrivalMs: Millis
    var nowMs: Millis
    var destination: Station?
    var `guard`: ArrivalGuard?
    var window: ArrivalWindow?
    var sample: ArrivalSample?
    var monitoring: Bool
    var permissionPending: Bool
    var legacyCompleted: Bool
    var cancelled: Bool
    var matchingRefresh: Bool
    var resumeWaitUntilMs: Millis?

    init(
        identity: String,
        departureMs: Millis,
        arrivalMs: Millis,
        nowMs: Millis,
        destination: Station? = nil,
        `guard`: ArrivalGuard? = nil,
        window: ArrivalWindow? = nil,
        sample: ArrivalSample? = nil,
        monitoring: Bool = false,
        permissionPending: Bool = false,
        legacyCompleted: Bool = false,
        cancelled: Bool = false,
        matchingRefresh: Bool = false,
        resumeWaitUntilMs: Millis? = nil
    ) {
        self.identity = identity
        self.departureMs = departureMs
        self.arrivalMs = arrivalMs
        self.nowMs = nowMs
        self.destination = destination
        self.guard = `guard`
        self.window = window
        self.sample = sample
        self.monitoring = monitoring
        self.permissionPending = permissionPending
        self.legacyCompleted = legacyCompleted
        self.cancelled = cancelled
        self.matchingRefresh = matchingRefresh
        self.resumeWaitUntilMs = resumeWaitUntilMs
    }
}

struct ArrivalResult: Equatable, Sendable {
    var state: ArrivalState
    var basis: ArrivalBasis?
    var `guard`: ArrivalGuard?
    var window: ArrivalWindow
    var away: Bool
    var moving: Bool
    var action: ArrivalAction
}

enum ArrivalRules {
    static let sampleInterval: Millis = 5_000
    static let maxAge: Millis = 30_000
    static let futureAllowance: Millis = 5_000
    static let window: Millis = 120_000
    static let maxSamples = 24
    static let maxGap: Millis = 30_000
    static let checking: Millis = 180_000
    static let retention: Millis = 7_200_000
    static let expiry: Millis = 1_800_000
}

func normalizeArrivalGuard(_ raw: ArrivalGuard?) -> ArrivalGuard? {
    guard var value = raw else { return nil }
    if value.retainedAt.map({ !validTransitMillis($0) }) == true { value.retainedAt = nil }
    if value.confirmedAt.map({ !validTransitMillis($0) }) == true { value.confirmedAt = nil }
    if value.basis == .location, value.confirmedAt == nil { value.basis = nil }
    if value.basis != .location { value.confirmedAt = nil }
    if value.armed == nil, value.retainedAt == nil, value.basis == nil, value.confirmedAt == nil { return nil }
    return value
}

func validateArrivalSample(_ raw: ArrivalSample?, nowMs: Millis) -> ArrivalSample? {
    guard var sample = raw,
          sample.lat.isFinite, sample.lon.isFinite, sample.at.isFinite, sample.accuracy.isFinite,
          abs(sample.lat) <= 90, abs(sample.lon) <= 180,
          sample.at <= nowMs + ArrivalRules.futureAllowance,
          sample.at >= nowMs - ArrivalRules.maxAge,
          sample.accuracy > 0, sample.accuracy <= 100 else { return nil }
    if let speed = sample.speed, !speed.isFinite || speed < 0 || speed > 100 { sample.speed = nil }
    return sample
}

func reduceArrival(_ input: ArrivalInput) -> ArrivalResult {
    let identity = input.identity
    let departure = input.departureMs
    let arrival = input.arrivalMs
    let now = input.nowMs
    var guardState = normalizeArrivalGuard(input.guard)
    var samples = input.window?.identity == identity
        ? input.window?.samples.filter {
            $0.at.isFinite && $0.at >= now - ArrivalRules.window && $0.at <= now + ArrivalRules.futureAllowance
        } ?? []
        : []
    var accepted: ArrivalSample?
    if let next = validateArrivalSample(input.sample, nowMs: now),
       samples.last.map({ next.at - $0.at >= ArrivalRules.sampleInterval }) ?? true {
        accepted = next
        samples.append(next)
        samples = Array(samples.suffix(ArrivalRules.maxSamples))
    }
    let arrivalWindow = ArrivalWindow(identity: identity, samples: samples)
    func result(
        _ state: ArrivalState,
        basis: ArrivalBasis? = nil,
        action: ArrivalAction = .none,
        away: Bool = false,
        moving: Bool = false
    ) -> ArrivalResult {
        ArrivalResult(
            state: state,
            basis: basis,
            guard: guardState,
            window: arrivalWindow,
            away: away,
            moving: moving,
            action: action
        )
    }
    guard !identity.isEmpty, validTransitMillis(departure), validTransitMillis(arrival), validTransitMillis(now),
          arrival >= departure else { return result(.travelling) }
    if guardState?.basis == .location,
       let confirmedAt = guardState?.confirmedAt,
       confirmedAt > now + ArrivalRules.futureAllowance {
        guardState?.basis = nil
        guardState?.confirmedAt = nil
    }
    let legacy = input.legacyCompleted && guardState == nil
    let confirmed = guardState?.basis == .location
        && (guardState?.confirmedAt ?? .infinity) <= now + ArrivalRules.futureAllowance
    if !legacy, !confirmed, now >= departure, input.monitoring || accepted != nil,
       guardState?.armed != true {
        var next = guardState ?? ArrivalGuard()
        next.armed = true
        next.retainedAt = now
        guardState = next
    }
    if guardState?.armed == true {
        let retained = guardState?.retainedAt ?? min(arrival, now)
        guardState?.retainedAt = min(retained, now)
    }
    let last = samples.last
    let fresh = last.map { now - $0.at <= ArrivalRules.maxAge } ?? false
    let distance = fresh ? last.flatMap { distanceMetres($0, input.destination) } : nil
    let away = distance.map { value in value - (last?.accuracy ?? 0) >= 300 } ?? false
    let moving = away && (meanArrivalSpeed(samples, nowMs: now) ?? -1) >= 8
    func nearPosition(_ sample: ArrivalSample) -> Bool {
        guard let distance = distanceMetres(sample, input.destination) else { return false }
        return sample.accuracy <= 50 && distance + sample.accuracy <= 200
    }
    let useful = accepted.map { sample in
        nearPosition(sample) || (distanceMetres(sample, input.destination).map { $0 - sample.accuracy >= 300 } ?? false)
    } ?? false
    if guardState?.armed == true,
       useful || (input.matchingRefresh && arrival > now),
       let retainedAt = guardState?.retainedAt,
       now - retainedAt >= 60_000 {
        guardState?.retainedAt = now
    }
    let expiryDeadline = guardState?.armed == true && !confirmed && !legacy
        ? max(arrival + ArrivalRules.expiry, (guardState?.retainedAt ?? now) + ArrivalRules.retention)
        : arrival + ArrivalRules.expiry
    let expired = now > expiryDeadline && !(input.resumeWaitUntilMs.map { now < $0 } ?? false)
    if input.cancelled {
        return result(
            expired ? .expiredUnconfirmed : .travelling,
            action: expired ? .expire : input.legacyCompleted ? .withdraw : .none
        )
    }
    if (confirmed || legacy), now > arrival + ArrivalRules.expiry {
        return result(.expiredUnconfirmed, action: .expire)
    }
    if confirmed { return result(.arrived, basis: .location, action: input.legacyCompleted ? .correct : .record) }
    if legacy && (!input.matchingRefresh || now >= arrival) {
        return result(.arrived, basis: .estimate, action: .correct)
    }

    let earliest = max(departure, arrival - 300_000)
    let near = arrivalSuffix(samples) { $0.at >= earliest && nearPosition($0) }
    let speed = meanArrivalSpeed(near, nowMs: now)
    let lowSpeed = speed.map { $0 <= 2 } ?? false
    var still = arrivalSuffix(near) { $0.speed == nil || $0.speed! <= 2 }
    if let lastAt = still.last?.at,
       let boundary = still.lastIndex(where: { $0.at <= lastAt - 60_000 }) {
        still = Array(still[boundary...])
    }
    let stationary = fresh && still.count >= 4 && (still.last?.at ?? 0) - (still.first?.at ?? 0) >= 60_000
        && still.enumerated().allSatisfy { index, sample in
            still.dropFirst(index + 1).allSatisfy { distanceMetres(sample, $0).map { $0 <= 50 } ?? false }
        }
    if guardState?.armed == true, fresh, lowSpeed || stationary {
        guardState?.basis = .location
        guardState?.confirmedAt = now
        return result(.arrived, basis: .location, action: input.legacyCompleted ? .correct : .record)
    }
    if expired {
        return result(.expiredUnconfirmed, action: .expire)
    }
    if now < arrival {
        if guardState?.basis == .estimate { guardState?.basis = nil }
        return result(.travelling, action: input.legacyCompleted ? .withdraw : .none, away: away, moving: moving)
    }
    if guardState?.armed != true, !input.permissionPending {
        var next = guardState ?? ArrivalGuard()
        next.basis = .estimate
        guardState = next
        return result(.arrived, basis: .estimate, action: input.legacyCompleted ? .correct : .record)
    }
    return result(
        away || now >= arrival + ArrivalRules.checking ? .arrivalUnconfirmed : .checkingArrival,
        away: away,
        moving: moving
    )
}

func distanceMetres(_ sample: ArrivalSample, _ destination: Station?) -> Double? {
    guard let destination,
          destination.lat.isFinite, destination.lon.isFinite,
          abs(destination.lat) <= 90, abs(destination.lon) <= 180,
          destination.lat != 0 || destination.lon != 0 else { return nil }
    return distanceMetres(fromLat: sample.lat, lon: sample.lon, toLat: destination.lat, lon: destination.lon)
}

private func distanceMetres(_ left: ArrivalSample, _ right: ArrivalSample) -> Double? {
    guard left.lat.isFinite, left.lon.isFinite, right.lat.isFinite, right.lon.isFinite else { return nil }
    return distanceMetres(fromLat: left.lat, lon: left.lon, toLat: right.lat, lon: right.lon)
}

private func distanceMetres(fromLat: Double, lon fromLon: Double, toLat: Double, lon toLon: Double) -> Double {
    let radians = Double.pi / 180
    let latitude = (toLat - fromLat) * radians
    let longitude = (toLon - fromLon) * radians
    let value = sin(latitude / 2) * sin(latitude / 2)
        + cos(fromLat * radians) * cos(toLat * radians)
        * sin(longitude / 2) * sin(longitude / 2)
    return 6_371_000 * 2 * atan2(sqrt(value), sqrt(max(0, 1 - value)))
}

private func arrivalSuffix(_ samples: [ArrivalSample], where predicate: (ArrivalSample) -> Bool) -> [ArrivalSample] {
    var start = samples.count
    for index in samples.indices.reversed() {
        if !predicate(samples[index])
            || (index < samples.count - 1 && samples[index + 1].at - samples[index].at > ArrivalRules.maxGap) { break }
        start = index
    }
    return start == samples.count ? [] : Array(samples[start...])
}

private func meanArrivalSpeed(_ samples: [ArrivalSample], nowMs: Millis) -> Double? {
    let valid = arrivalSuffix(samples) { $0.speed?.isFinite == true }
    guard valid.count >= 3, let first = valid.first, let last = valid.last,
          nowMs - last.at <= ArrivalRules.maxAge, last.at - first.at >= 30_000 else { return nil }
    var area = 0.0
    for index in 1..<valid.count {
        area += ((valid[index].speed ?? 0) + (valid[index - 1].speed ?? 0)) / 2
            * (valid[index].at - valid[index - 1].at)
    }
    return area / (last.at - first.at)
}
