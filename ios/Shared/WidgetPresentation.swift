import Foundation

let widgetLiveHorizonMinutes = 40

/// The contract's shortening ladder, applied to both names one rule at a time, longest form first.
func widgetRouteForms(from: String, to: String) -> [(from: String, to: String)] {
    let rules: [(String) -> String] = [
        { $0.replacingOccurrences(of: "\\s+Station$", with: "", options: [.regularExpression, .caseInsensitive]) },
        { $0.replacingOccurrences(of: "\\s+Junction$", with: " Jn", options: [.regularExpression, .caseInsensitive]) },
        { name in
            guard let range = name.range(of: "^(North|South|East|West)\\s+", options: [.regularExpression, .caseInsensitive]) else { return name }
            return String(name[range].prefix(1)) + " " + name[range.upperBound...]
        },
    ]
    var forms = [(from: from, to: to)]
    for rule in rules {
        let last = forms[forms.count - 1]
        let next = (from: rule(last.from), to: rule(last.to))
        if next != last { forms.append(next) }
    }
    return forms
}

struct WidgetCountdown: Equatable, Sendable {
    var value: String
    var unit: String
}

/// The board's arithmetic on printed clock minutes: `Now` for the departure minute, rounded hours past 99.
func widgetCountdown(to time: Millis, now: Millis) -> WidgetCountdown {
    let minutes = minutesBetween(now, time)
    if minutes <= 0 { return WidgetCountdown(value: "Now", unit: "") }
    if minutes > 99 { return WidgetCountdown(value: "\(Int((Double(minutes) / 60).rounded()))", unit: "H") }
    return WidgetCountdown(value: "\(minutes)", unit: "min")
}

func widgetLateMinutes(_ journey: Journey) -> Int {
    minutesBetween(journey.departure, journey.effectiveDeparture)
}

/// Scheduled-only as the board prints it; `includesHorizon` adds the board's 40 minute live-estimate edge.
func widgetScheduledOnly(_ journey: Journey, now: Millis, includesHorizon: Bool) -> Bool {
    guard !journey.cancelled, let first = journey.legs.first else { return false }
    if !journey.realtime { return true }
    guard includesHorizon, first.estimatedDeparture != nil, widgetLateMinutes(journey) == 0 else { return false }
    return minutesBetween(now, journey.effectiveDeparture) > widgetLiveHorizonMinutes
}

struct WidgetStep: Equatable, Sendable {
    enum Kind: Equatable, Sendable { case board, getOff, arrive }

    var kind: Kind
    var time: Millis
    var station: String
    var leg: Leg
    var platform: String?
}

/// Journey detail's steps: board, then get off and board at every change, then arrive.
func widgetSteps(_ journey: Journey) -> [WidgetStep] {
    guard let first = journey.legs.first, let last = journey.legs.last else { return [] }
    var steps = [WidgetStep(kind: .board, time: first.effectiveDeparture, station: first.from.shortName, leg: first, platform: first.fromPlatform)]
    for (before, after) in zip(journey.legs, journey.legs.dropFirst()) {
        steps.append(WidgetStep(kind: .getOff, time: before.effectiveArrival, station: before.to.shortName, leg: before, platform: before.toPlatform))
        steps.append(WidgetStep(kind: .board, time: after.effectiveDeparture, station: after.from.shortName, leg: after, platform: after.fromPlatform))
    }
    steps.append(WidgetStep(kind: .arrive, time: last.effectiveArrival, station: last.to.shortName, leg: last, platform: last.toPlatform))
    return steps
}

/// The step still ahead of the rider, or nil once the journey has arrived.
func widgetNextStep(_ steps: [WidgetStep], now: Millis) -> Int? {
    steps.firstIndex { now < $0.time }
}

func widgetServiceName(_ leg: Leg) -> String {
    leg.line.isEmpty ? trackerVehicle(leg.mode) : leg.line
}

func trackerVehicle(_ mode: String) -> String {
    switch mode.lowercased() {
    case "ferry": "Ferry"
    case "metro": "Metro"
    default: "Train"
    }
}

/// The Live Activity's name for a boarding or alighting place: `Platform 1`, `Wharf 2, Side A`.
func trackerPlatform(_ raw: String?, mode: String) -> String? {
    guard let value = raw?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else { return nil }
    let place = mode.lowercased() == "ferry" ? "Wharf" : "Platform"
    if value.range(of: "\\b\(place)\\b", options: [.regularExpression, .caseInsensitive]) != nil { return value }
    if place == "Wharf", value.lowercased().hasPrefix("side") { return value }
    return "\(place) \(value)"
}

func trackerPlacePreposition(_ mode: String) -> String {
    mode.lowercased() == "ferry" ? "at" : "on"
}

struct WidgetSentenceRun: Equatable, Sendable {
    var text: String
    var strong = false
}

/// The Live Activity's sentence at rest: who leaves or arrives and when, where to stand, and the destination's time.
struct WidgetLockSentence: Equatable, Sendable {
    var subject: String
    var deadline: Millis?
    var instruction: [WidgetSentenceRun] = []
    var arrival: String?
}

func widgetLockSentence(_ content: WidgetContent) -> WidgetLockSentence {
    guard let answer = content.answer else {
        return WidgetLockSentence(subject: "New trip", instruction: [WidgetSentenceRun(text: "Choose where you start")])
    }
    guard let lead = content.lead, let last = lead.legs.last else {
        return WidgetLockSentence(subject: widgetNoServiceText(content), arrival: nil)
            .withRoute(answer)
    }
    let now = content.date
    let arrival = "\(last.to.shortName) about \(clockTime(lead.effectiveArrival))"
    if lead.cancelled {
        let cancelled = lead.legs.first { $0.cancelled } ?? lead.legs[0]
        return WidgetLockSentence(subject: "The \(clockTime(cancelled.departure)) from \(cancelled.from.shortName) is cancelled.")
    }
    let steps = widgetSteps(lead)
    guard let index = widgetNextStep(steps, now: now) else {
        return WidgetLockSentence(subject: last.to.shortName, instruction: [WidgetSentenceRun(text: clockTime(lead.effectiveArrival))])
    }
    let step = steps[index]
    switch step.kind {
    case .board:
        var instruction = [WidgetSentenceRun(text: "Go to ")]
        if let replaced = content.replaced, index == 0 {
            instruction = [WidgetSentenceRun(text: "\(clockTime(replaced.effectiveDeparture)) cancelled · next \(genericModeName(lead.mode))")]
        } else if let place = trackerPlatform(step.platform, mode: step.leg.mode) {
            instruction.append(WidgetSentenceRun(text: place, strong: true))
        } else {
            instruction.append(WidgetSentenceRun(text: step.station))
        }
        return WidgetLockSentence(subject: "\(widgetServiceName(step.leg)) leaves in ", deadline: step.time,
                                  instruction: instruction, arrival: arrival)
    case .getOff, .arrive:
        let instruction = trackerPlatform(step.platform, mode: step.leg.mode).map {
            [WidgetSentenceRun(text: "Get off \(trackerPlacePreposition(step.leg.mode)) "), WidgetSentenceRun(text: $0, strong: true)]
        } ?? [WidgetSentenceRun(text: "Get off at \(step.station)")]
        return WidgetLockSentence(subject: "\(step.station) in ", deadline: step.time, instruction: instruction,
                                  arrival: step.kind == .arrive ? nil : arrival)
    }
}

func widgetNoServiceText(_ content: WidgetContent) -> String {
    guard let board = content.board else { return "No saved board for this trip yet" }
    if board.offline && board.generatedAt <= 0 { return "No saved board for this trip yet" }
    return board.offline ? "No services on the last board we could load" : "No services in the next few hours"
}

private extension WidgetLockSentence {
    func withRoute(_ answer: WidgetAnswer) -> WidgetLockSentence {
        var copy = self
        copy.arrival = "\(answer.from.station.shortName) → \(answer.to.station.shortName)"
        return copy
    }
}

/// The header's status words for a followed journey; unfocused answers carry none.
struct WidgetStatus: Equatable, Sendable {
    var text: String?
    var pinned: Bool
    var warns: Bool
}

func widgetStatus(_ content: WidgetContent) -> WidgetStatus? {
    guard let focus = content.answer?.focus, let lead = content.lead else { return nil }
    if content.replaced != nil || lead.cancelled { return WidgetStatus(text: "Cancelled", pinned: false, warns: true) }
    if widgetNextStep(widgetSteps(lead), now: content.date) == nil { return nil }
    if lead.effectiveDeparture > content.date {
        return focus.pinned ? WidgetStatus(text: nil, pinned: true, warns: false) : WidgetStatus(text: "Running", pinned: false, warns: false)
    }
    return WidgetStatus(text: "Running", pinned: focus.pinned, warns: false)
}
