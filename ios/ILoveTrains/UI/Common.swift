import SwiftUI

struct TrainLabel: View {
    let text: String
    var color: Color?
    var size: CGFloat = 10
    var alignment: TextAlignment = .leading
    var lines: Int? = nil
    @Environment(\.trainColors) private var colors

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: size, weight: .semibold))
            .tracking(size * 0.16)
            .foregroundStyle(color ?? colors.ink3)
            .multilineTextAlignment(alignment)
            .lineLimit(lines)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct TrainRule: View {
    var heavy = false
    @Environment(\.trainColors) private var colors
    var body: some View {
        Rectangle().fill(heavy ? colors.ink.opacity(0.82) : colors.rule)
            .frame(height: heavy ? 2 : 1)
    }
}

struct BackControl: View {
    let label: String
    let action: () -> Void
    @Environment(\.trainColors) private var colors

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: "chevron.left").font(.system(size: 16, weight: .light))
                TrainLabel(text: label, color: colors.ink2, size: 11, lines: 1)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("back")
    }
}

struct FreshnessView: View {
    let board: BoardData?
    let now: Millis
    @Environment(\.trainColors) private var colors

    var body: some View {
        if let board {
            let scheduled = board.source == "schedule"
            let live = board.isLive(now)
            let stale = !scheduled && !live
            let copy = freshnessText(board, now: now)
            HStack(spacing: 8) {
                Circle().fill(live ? colors.live : (stale || scheduled ? colors.warning : colors.ink3))
                    .frame(width: 5, height: 5)
                TrainLabel(text: copy, color: board.offline || scheduled ? colors.warning : colors.ink3)
            }
            .frame(minHeight: 36)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("freshness")
        }
    }
}

struct ActionRail: View {
    let text: String
    var enabled = true
    var minHeight: CGFloat = 64
    let action: () -> Void
    @Environment(\.trainColors) private var colors

    var body: some View {
        VStack(spacing: 0) {
            TrainRule(heavy: true)
            Button(action: action) {
                TrainLabel(text: text, color: enabled ? colors.ink : colors.ink3, size: 13)
                    .frame(maxWidth: .infinity, minHeight: minHeight, alignment: .leading)
                    .padding(.horizontal, pagePadding)
                    .contentShape(Rectangle())
            }
            .disabled(!enabled)
            .buttonStyle(.plain)
            .accessibilityIdentifier(text.lowercased().replacingOccurrences(of: " ", with: "-"))
        }
    }
}

struct LineChip: View {
    let line: String
    let mode: String
    var text: String? = nil
    var height: CGFloat = 22
    var horizontalPadding: CGFloat = 7
    @Environment(\.trainColors) private var colors

    var body: some View {
        Text((text ?? line).uppercased())
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(chipInk(line, mode: mode, colors: colors))
            .lineLimit(1)
            .padding(.horizontal, horizontalPadding)
            .frame(height: height)
            .background(lineColor(line, mode: mode, colors: colors, fill: true), in: RoundedRectangle(cornerRadius: lineChipCornerRadius))
    }
}

struct Figure {
    var value: String
    var unit = ""
    var provenance = ""
    var past = false
}

func figureUsesCompactType(_ figure: Figure) -> Bool {
    (figure.value + (figure.unit == "H" ? "H" : "")).count >= 3
}

let liveHorizonMinutes = 40

func staleRow(_ journey: Journey, board: BoardData?, now: Millis) -> Bool {
    board == nil || board?.offline == true || journey.retained == true || now - (board?.generatedAt ?? 0) > 90_000
}

// The feed's estimates stop earning the live register past the accuracy tracker's 40 minute bucket edge.
func beyondLiveHorizon(_ journey: Journey, board: BoardData?, now: Millis) -> Bool {
    guard journey.legs.first?.estimatedDeparture != nil, !journey.cancelled else { return false }
    guard let board, board.source == "live", !staleRow(journey, board: board, now: now) else { return false }
    guard minutesBetween(journey.departure, journey.effectiveDeparture) == 0 else { return false }
    return minutesBetween(now, journey.effectiveDeparture) > liveHorizonMinutes
}

func figureFor(_ journey: Journey, board: BoardData?, now: Millis) -> Figure {
    let departure = journey.effectiveDeparture
    let stale = staleRow(journey, board: board, now: now)
    let minutes = minutesBetween(now, departure)
    if journey.cancelled { return Figure(value: "—", provenance: "Cancelled", past: minutes < 0) }
    if minutes < 0 {
        let elapsed = abs(minutes)
        return elapsed > 99
            ? Figure(value: "\(Int((Double(elapsed) / 60).rounded()))", unit: "H", provenance: "Ago", past: true)
            : Figure(value: "\(elapsed)", unit: "min", provenance: "Ago", past: true)
    }
    let liveRealtime = !stale && board?.source == "live" && journey.realtime
    let scheduledRegister = !liveRealtime || beyondLiveHorizon(journey, board: board, now: now)
    let late = minutesBetween(journey.departure, journey.effectiveDeparture)
    let provenance = late > 0 ? "\(late) min late" : (scheduledRegister ? "Scheduled" : (minutes == 0 ? "Departing" : ""))
    if minutes == 0 { return Figure(value: "Now", provenance: provenance) }
    if minutes > 99 { return Figure(value: "\(Int((Double(minutes) / 60).rounded()))", unit: "H", provenance: provenance) }
    return Figure(value: "\(minutes)", unit: "min", provenance: provenance)
}

func directionFigureFor(_ journey: Journey, now: Millis) -> Figure? {
    guard now >= journey.effectiveDeparture, now < journey.effectiveArrival else { return nil }
    for (index, leg) in journey.legs.enumerated() {
        let next = index + 1 < journey.legs.count ? journey.legs[index + 1] : nil
        let target: Millis
        if now < leg.effectiveArrival { target = leg.effectiveArrival }
        else if let next, now < next.effectiveDeparture { target = next.effectiveDeparture }
        else { continue }
        let minutes = max(0, minutesBetween(now, target))
        let provenance = next == nil ? "To go" : "To change"
        return minutes > 99
            ? Figure(value: "\(Int((Double(minutes) / 60).rounded()))", unit: "H", provenance: provenance)
            : Figure(value: "\(minutes)", unit: "min", provenance: provenance)
    }
    return nil
}

func arrivalFigure(_ arrival: ArrivalResult?, journey: Journey, now: Millis) -> Figure? {
    guard let arrival, arrival.state == .checkingArrival || arrival.state == .arrivalUnconfirmed else { return nil }
    if arrival.moving {
        let elapsed = max(0, Int(floor((now - journey.effectiveArrival) / 60_000)))
        return elapsed == 0
            ? Figure(value: "—", provenance: "Past estimate")
            : Figure(value: "\(elapsed)", unit: "min", provenance: "Past estimate")
    }
    return Figure(value: "—", provenance: "Last estimate")
}

func arrivalInstruction(_ arrival: ArrivalResult?, destination: String) -> String? {
    guard let arrival else { return nil }
    switch arrival.state {
    case .checkingArrival: return "Checking arrival at \(destination)."
    case .arrivalUnconfirmed where arrival.moving: return "Still on the way to \(destination)."
    case .arrivalUnconfirmed: return "Arrival time needs an update."
    default: return nil
    }
}

/// A recovery change names the service the rider now boards; the station name is never ellipsised.
func axisChangeLabel(_ journey: Journey, index: Int, recoveryChangeIndex: Int?, withLine: Bool = true) -> String {
    let leg = journey.legs[index], next = journey.legs[index + 1]
    let station = leg.to.id == next.from.id ? leg.to.shortName : "\(leg.to.shortName) → \(next.from.shortName)"
    guard recoveryChangeIndex.map({ index >= $0 }) ?? false else { return station.uppercased() }
    let service = withLine && !next.line.isEmpty ? "\(next.line) " : ""
    return "\(station) · \(service)\(clockTime(next.effectiveDeparture))".uppercased()
}

struct JourneyAxis: View {
    let journey: Journey
    var large = false
    var showCap = true
    var progress: Double? = nil
    var showProgressMarker = true
    var tinyTrain: Bool? = nil
    var recoveryChangeIndex: Int? = nil
    @State private var trainEnabled = false
    @Environment(\.trainColors) private var colors

    var body: some View {
        if let first = journey.legs.first {
            JourneyAxisLayout(journey: journey, large: large, progress: progress) {
                if showCap, let title = departurePlatformText(first.fromPlatform, mode: first.mode) {
                    LineChip(line: first.line, mode: first.mode, text: title,
                             height: large ? 24 : 22, horizontalPadding: large ? 10 : 7)
                        .fixedSize().layoutValue(key: AxisItemKey.self, value: .cap)
                }
                // Paint the entire time axis before any text-bearing marker.
                ForEach(Array(journey.legs.enumerated()), id: \.offset) { index, leg in
                    UnevenRoundedRectangle(topLeadingRadius: 0, bottomLeadingRadius: 0,
                        bottomTrailingRadius: index == journey.legs.count - 1 ? 3 : 0,
                        topTrailingRadius: index == journey.legs.count - 1 ? 3 : 0)
                        .fill(lineColor(leg.line, mode: leg.mode, colors: colors, fill: true))
                        .layoutValue(key: AxisItemKey.self, value: .ride(index))
                    if index < journey.legs.count - 1 {
                        Rectangle().fill(changeState(index) == .tight ? colors.warning : colors.rule)
                            .layoutValue(key: AxisItemKey.self, value: .dwell(index))
                    }
                }
                if progress != nil {
                    Rectangle().fill(colors.ground.opacity(0.62))
                        .layoutValue(key: AxisItemKey.self, value: .travelled)
                        .zIndex(1)
                }
                if let tinyTrain {
                    TinyTrainLane(flag: tinyTrain, onAvailabilityChange: { trainEnabled = $0 }).layoutValue(key: AxisItemKey.self, value: .tinyTrain)
                }
                ForEach(Array(journey.legs.dropLast().enumerated()), id: \.offset) { index, leg in
                    let next = journey.legs[index + 1]
                    if journey.legs.count <= 2 || index == 0,
                       let platform = transferPlatformText(leg.toPlatform, mode: leg.mode) {
                        pin(leg, platform: platform)
                            .layoutValue(key: AxisItemKey.self, value: .alight(index))
                    }
                    if let platform = transferPlatformText(next.fromPlatform, mode: next.mode) {
                        pin(next, platform: platform)
                            .layoutValue(key: AxisItemKey.self, value: .board(index))
                    }
                    ViewThatFits(in: .horizontal) {
                        stationLabel(axisChangeLabel(journey, index: index, recoveryChangeIndex: recoveryChangeIndex))
                        stationLabel(axisChangeLabel(journey, index: index, recoveryChangeIndex: recoveryChangeIndex, withLine: false))
                    }
                    .layoutValue(key: AxisItemKey.self, value: .station(index))
                    if completedTransfer(index) {
                        if journey.legs.count <= 2 || index == 0,
                           transferPlatformText(leg.toPlatform, mode: leg.mode) != nil {
                            RoundedRectangle(cornerRadius: lineChipCornerRadius).fill(colors.ground.opacity(0.62))
                                .layoutValue(key: AxisItemKey.self, value: .completedAlight(index))
                                .zIndex(3)
                        }
                        if transferPlatformText(next.fromPlatform, mode: next.mode) != nil {
                            RoundedRectangle(cornerRadius: lineChipCornerRadius).fill(colors.ground.opacity(0.62))
                                .layoutValue(key: AxisItemKey.self, value: .completedBoard(index))
                                .zIndex(3)
                        }
                    }
                }
                if progress != nil, showProgressMarker {
                    Image(systemName: "triangle.fill").font(.system(size: 13))
                        .foregroundStyle(colors.ink3).rotationEffect(.degrees(180))
                        .layoutValue(key: AxisItemKey.self, value: .progress)
                }
            }
            .accessibilityElement(children: trainEnabled ? .contain : .ignore)
            .accessibilityLabel("Journey from \(first.from.shortName) to \(journey.legs.last?.to.shortName ?? first.to.shortName)")
        }
    }

    private func completedTransfer(_ index: Int) -> Bool {
        guard let progress else { return false }
        let duration = max(1, journey.effectiveArrival - journey.effectiveDeparture)
        let inferred = journey.effectiveDeparture + progress * duration
        return inferred >= journey.legs[index + 1].effectiveDeparture
    }

    private func changeState(_ index: Int) -> ConnectionState {
        connectionState(journey.legs[index], journey.legs[index + 1],
                        recovery: recoveryChangeIndex.map { index >= $0 } ?? false)
    }

    private func stationLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10, weight: .semibold)).tracking(0.6)
            .foregroundStyle(colors.ink2).multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func pin(_ leg: Leg, platform: String) -> some View {
        LineChip(line: leg.line, mode: leg.mode, text: platform,
                 height: large ? 24 : 22, horizontalPadding: 5)
            .fixedSize()
            .zIndex(2)
    }
}

extension View {
    func tabular() -> some View { monospacedDigit() }
}
