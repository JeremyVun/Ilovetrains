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
            let copy: String = {
                if scheduled {
                    return "Offline · timetable"
                }
                if board.offline { return "Offline · last updated \(ageText(now - board.generatedAt)) ago" }
                if stale { return "Last updated \(ageText(now - board.generatedAt)) ago" }
                if live { return "Live" }
                return "Updated \(ageText(now - board.generatedAt)) ago"
            }()
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

func ageText(_ age: Millis) -> String {
    if age < 60_000 { return "\(max(0, Int(age / 1_000)))s" }
    if age < 3_600_000 { return "\(Int(age / 60_000))m" }
    return "\(Int(age / 3_600_000))h"
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

let lineChipCornerRadius: CGFloat = 3

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

func minutesBetween(_ from: Millis, _ to: Millis) -> Int {
    Int(to / 60_000) - Int(from / 60_000)
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

func figureFor(_ journey: Journey, board: BoardData?, now: Millis) -> Figure {
    let departure = journey.effectiveDeparture
    let stale = board == nil || board?.offline == true || journey.retained == true || now - (board?.generatedAt ?? 0) > 90_000
    let minutes = minutesBetween(now, departure)
    if journey.cancelled { return Figure(value: "—", provenance: "Cancelled", past: minutes < 0) }
    if minutes < 0 {
        let elapsed = abs(minutes)
        return elapsed > 99
            ? Figure(value: "\(Int((Double(elapsed) / 60).rounded()))", unit: "H", provenance: "Ago", past: true)
            : Figure(value: "\(elapsed)", unit: "min", provenance: "Ago", past: true)
    }
    let liveRealtime = !stale && board?.source == "live" && journey.realtime
    let late = minutesBetween(journey.departure, journey.effectiveDeparture)
    let provenance = late > 0 ? "\(late) min late" : (!liveRealtime ? "Scheduled" : (minutes == 0 ? "Departing" : ""))
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

struct JourneyAxis: View {
    let journey: Journey
    var large = false
    var showCap = true
    var progress: Double? = nil
    var tinyTrain = false
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
                        Rectangle().fill(!journey.cancelled && minutesBetween(leg.effectiveArrival, journey.legs[index + 1].effectiveDeparture) < 5 ? colors.warning : colors.rule)
                            .layoutValue(key: AxisItemKey.self, value: .dwell(index))
                    }
                }
                if tinyTrain {
                    TinyTrainLane(onAvailabilityChange: { trainEnabled = $0 }).layoutValue(key: AxisItemKey.self, value: .tinyTrain)
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
                    Text((leg.to.id == next.from.id ? leg.to.shortName : "\(leg.to.shortName) → \(next.from.shortName)").uppercased())
                        .font(.system(size: 10, weight: .semibold)).tracking(0.6)
                        .foregroundStyle(colors.ink2).multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                        .layoutValue(key: AxisItemKey.self, value: .station(index))
                }
                if progress != nil {
                    Image(systemName: "triangle.fill").font(.system(size: 13))
                        .foregroundStyle(colors.ink3).rotationEffect(.degrees(180))
                        .layoutValue(key: AxisItemKey.self, value: .progress)
                }
            }
            .accessibilityElement(children: trainEnabled ? .contain : .ignore)
            .accessibilityLabel("Journey from \(first.from.shortName) to \(journey.legs.last?.to.shortName ?? first.to.shortName)")
        }
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
