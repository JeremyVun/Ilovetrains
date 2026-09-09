import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

@main
struct TravelTrackerWidgets: WidgetBundle {
    var body: some Widget {
        TravelTrackerLiveActivity()
    }
}

struct TravelTrackerLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TravelTrackerActivityAttributes.self) { context in
            TrackerLockScreen(context: context)
                .activityBackgroundTint(TrackerPalette.activityBackground)
                .activitySystemActionForegroundColor(.primary)
                .widgetURL(context.attributes.deepLinkURL)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TrackerIslandEvent(state: context.state, stale: context.isStale)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.cancelled || context.state.eventDeadline == nil {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(TrackerPalette.current.warning(context.state.cancelled))
                            .accessibilityLabel(context.state.headline.lead)
                    } else {
                        TrackerCountdown(state: context.state)
                            .font(.caption.monospacedDigit().weight(.semibold))
                            .foregroundStyle(TrackerPalette.current.warning(context.state.tightConnection))
                            .lineLimit(1)
                            .accessibilityLabel(TrackerCountdown.accessibilityText(state: context.state))
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    TrackerExpandedIsland(state: context.state, stale: context.isStale)
                }
            } compactLeading: {
                TrackerCompactService(state: context.state)
            } compactTrailing: {
                TrackerCompactTrailing(state: context.state)
            } minimal: {
                TrackerMinimal(state: context.state)
            }
            .widgetURL(context.attributes.deepLinkURL)
            .keylineTint(TrackerPalette.keyline(for: context.state))
        }
    }
}

private struct TrackerLockScreen: View {
    let context: ActivityViewContext<TravelTrackerActivityAttributes>

    var body: some View {
        ViewThatFits(in: .vertical) {
            TrackerCard(state: context.state, stale: context.isStale, condensed: false)
            TrackerCard(state: context.state, stale: context.isStale, condensed: true)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
        .frame(minHeight: 160, alignment: .topLeading)
        .background(TrackerPalette.current.background)
        .accessibilityElement(children: .combine)
    }
}

private struct TrackerCard: View {
    let state: TravelTrackerActivityAttributes.ContentState
    let stale: Bool
    let condensed: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var palette: TrackerPalette { .current }
    private var rowSpacing: CGFloat { condensed || dynamicTypeSize.isAccessibilitySize ? 4 : 7 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            TrackerHeadline(state: state)
                .font(condensed ? .headline : .title2)
                .foregroundStyle(palette.warning(state.cancelled || state.tightConnection))
                .lineLimit(2)
                .minimumScaleFactor(0.76)

            TrackerInstruction(state: state)
                .font(condensed ? .caption : .subheadline)
                .lineLimit(dynamicTypeSize.isAccessibilitySize ? 3 : 2)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, rowSpacing)

            TrackerContextRow(state: state, stale: stale)
                .padding(.top, rowSpacing / 2)

            Spacer(minLength: condensed ? 2 : 4)

            TrackerArrivalRow(state: state)

            if TrackerPalette.showsJourneyLine(state) {
                TrackerJourneyLine(state: state)
                    .padding(.top, condensed ? 5 : 8)
            }
        }
    }
}

private struct TrackerHeadline: View {
    let state: TravelTrackerActivityAttributes.ContentState

    var body: some View {
        Group {
            if state.eventDeadline != nil, !state.cancelled {
                Text(state.headline.lead)
                + TrackerCountdown.text(state: state).fontWeight(.bold)
                + Text(state.headline.tail)
            } else {
                Text(state.headline.lead)
                + Text(state.headline.emphasis ?? "").fontWeight(.bold)
                + Text(state.headline.tail)
            }
        }
        .monospacedDigit()
    }
}

private struct TrackerInstruction: View {
    let state: TravelTrackerActivityAttributes.ContentState

    var body: some View {
        state.instructionRuns.reduce(Text("")) { value, run in
            value + Text(run.text)
                .fontWeight(run.role == .platform ? .bold : .regular)
                .foregroundColor(run.role == .platform ? TrackerPalette.current.ink : TrackerPalette.current.quiet)
        }
        .accessibilityLabel(state.instruction)
    }
}

private struct TrackerContextRow: View {
    let state: TravelTrackerActivityAttributes.ContentState
    let stale: Bool
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var provenance: String? {
        if stale || state.provenance.caseInsensitiveCompare("Live") == .orderedSame {
            return state.staleProvenance
        }
        return state.provenance
    }

    var body: some View {
        if state.connection != nil || provenance != nil {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                if let connection = state.connection {
                    Text(connection)
                        .foregroundStyle(TrackerPalette.current.warning(state.tightConnection))
                }
                Spacer(minLength: 4)
                if let provenance {
                    Text(provenance)
                        .multilineTextAlignment(.trailing)
                }
            }
            .font(.caption2)
            .foregroundStyle(TrackerPalette.current.quiet)
            .lineLimit(dynamicTypeSize.isAccessibilitySize ? 2 : 1)
            .minimumScaleFactor(0.82)
            .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct TrackerArrivalRow: View {
    let state: TravelTrackerActivityAttributes.ContentState

    private var etaText: String {
        guard state.arrivalCancelled else { return state.etaText }
        let planned = state.etaText.replacingOccurrences(of: "about ", with: "planned ", options: .caseInsensitive)
        return "Cancelled · \(planned)"
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(state.destination)
                .lineLimit(1)
            Spacer(minLength: 6)
            Text(etaText)
                .fontWeight(state.arrivalCancelled ? .semibold : .regular)
                .foregroundStyle(TrackerPalette.current.warning(state.arrivalCancelled))
                .lineLimit(1)
                .monospacedDigit()
        }
        .font(.caption)
        .foregroundStyle(TrackerPalette.current.quiet)
        .minimumScaleFactor(0.78)
        .accessibilityElement(children: .combine)
    }
}

private struct TrackerExpandedIsland: View {
    let state: TravelTrackerActivityAttributes.ContentState
    let stale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TrackerInstruction(state: state)
                .font(.subheadline)
                .lineLimit(2)
                .minimumScaleFactor(0.78)

            TrackerContextRow(state: state, stale: stale)
            TrackerArrivalRow(state: state)
            if TrackerPalette.showsJourneyLine(state) {
                TrackerJourneyLine(state: state)
                    .padding(.horizontal, 6)
            }
        }
        .padding(.top, 2)
        .accessibilityElement(children: .combine)
    }
}

private struct TrackerIslandEvent: View {
    let state: TravelTrackerActivityAttributes.ContentState
    let stale: Bool

    private var eventName: String {
        var value = state.headline.lead.trimmingCharacters(in: .whitespacesAndNewlines)
        for suffix in [" leaves in", " in"] where value.hasSuffix(suffix) {
            value.removeLast(suffix.count)
            break
        }
        return value.isEmpty ? state.destination : value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(eventName)
                .font(.caption.weight(.semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.72)
            if stale {
                Text("Last updated")
                    .font(.caption2)
                    .foregroundStyle(TrackerPalette.current.quiet)
                    .lineLimit(1)
            }
        }
        .foregroundStyle(TrackerPalette.current.warning(state.cancelled))
        .padding(.leading, 10)
        .padding(.top, 4)
    }
}

private struct TrackerCompactService: View {
    let state: TravelTrackerActivityAttributes.ContentState

    var body: some View {
        HStack(spacing: 3) {
            Image(systemName: TrackerPalette.vehicleSymbol(for: state))
                .imageScale(.small)
            if let line = TrackerPalette.activeLine(for: state), !line.isEmpty {
                Text(line)
                    .font(.caption2.weight(.bold))
                    .lineLimit(1)
            }
        }
        .foregroundStyle(TrackerPalette.current.warning(state.cancelled))
        .accessibilityLabel(TrackerPalette.compactAccessibilityLabel(for: state))
    }
}

private struct TrackerCompactTrailing: View {
    let state: TravelTrackerActivityAttributes.ContentState

    var body: some View {
        if state.cancelled || state.eventKind == .missedConnection || state.eventDeadline == nil {
            Image(systemName: state.cancelled || state.eventKind == .missedConnection
                ? "exclamationmark.triangle.fill"
                : "arrow.right")
                .foregroundStyle(TrackerPalette.current.warning(
                    state.cancelled || state.eventKind == .missedConnection
                ))
                .accessibilityLabel(state.headline.lead)
        } else {
            TrackerCountdown(state: state)
                .font(.caption.monospacedDigit().weight(.semibold))
                .foregroundStyle(TrackerPalette.current.warning(state.tightConnection))
                .lineLimit(1)
                .accessibilityLabel(TrackerCountdown.accessibilityText(state: state))
        }
    }
}

private struct TrackerMinimal: View {
    let state: TravelTrackerActivityAttributes.ContentState

    var body: some View {
        Image(systemName: state.cancelled || state.eventKind == .missedConnection
            ? "exclamationmark.triangle.fill"
            : TrackerPalette.vehicleSymbol(for: state))
            .foregroundStyle(TrackerPalette.current.warning(
                state.cancelled || state.eventKind == .missedConnection
            ))
            .accessibilityLabel(TrackerPalette.compactAccessibilityLabel(for: state))
    }
}

private struct TrackerCountdown: View {
    let state: TravelTrackerActivityAttributes.ContentState

    var body: some View {
        Self.text(state: state)
    }

    static func text(state: TravelTrackerActivityAttributes.ContentState) -> Text {
        #if DEBUG
        if let fixed = state.debugStaticCountdown {
            return Text(fixed)
        }
        #endif
        guard let deadline = state.eventDeadline else {
            return Text(state.headline.emphasis ?? "")
        }
        return Text(timerInterval: state.timerStart...deadline, countsDown: true)
    }

    static func accessibilityText(state: TravelTrackerActivityAttributes.ContentState) -> Text {
        Text(state.headline.lead) + text(state: state) + Text(state.headline.tail)
    }
}

private struct TrackerJourneyLine: View {
    let state: TravelTrackerActivityAttributes.ContentState
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    var body: some View {
        ZStack {
            GeometryReader { proxy in
                ForEach(Array(state.segments.enumerated()), id: \.offset) { _, segment in
                    let start = min(1, max(0, segment.startFraction))
                    let end = min(1, max(start, segment.endFraction))
                    Rectangle()
                        .fill(TrackerPalette.segmentColor(segment, lowLuminance: isLuminanceReduced))
                        .frame(width: max(0, proxy.size.width * (end - start)), height: 7)
                        .offset(x: proxy.size.width * start)
                }
            }
            .frame(height: 7)
            .background(TrackerPalette.current.rule, in: Capsule())
            .clipShape(Capsule())

            TrackerProgress(state: state)
        }
        .frame(height: 11)
        .accessibilityHidden(true)
    }
}

private struct TrackerProgress: View {
    let state: TravelTrackerActivityAttributes.ContentState

    var body: some View {
        ProgressView(value: min(1, max(0, state.progress)))
            .progressViewStyle(TrackerMarkerProgressStyle())
    }
}

private struct TrackerMarkerProgressStyle: ProgressViewStyle {
    func makeBody(configuration: Configuration) -> some View {
        GeometryReader { proxy in
            let progress = min(1, max(0, configuration.fractionCompleted ?? 0))
            Circle()
                .fill(TrackerPalette.current.ink)
                .overlay(Circle().stroke(TrackerPalette.current.background, lineWidth: 2))
                .frame(width: 11, height: 11)
                .offset(x: max(0, proxy.size.width - 11) * progress)
        }
        .frame(height: 11)
    }
}

private struct TrackerPalette {
    var background: Color
    var ink: Color
    var quiet: Color
    var rule: Color
    var warning: Color

    static let current = TrackerPalette(
        background: dynamicColor(light: 0xFAF9F5, dark: 0x202327),
        ink: dynamicColor(light: 0x14120E, dark: 0xF4F5F7),
        quiet: dynamicColor(light: 0x5C5B58, dark: 0xADB0B4),
        rule: dynamicColor(light: 0x14120E, dark: 0xF4F5F7).opacity(0.22),
        warning: dynamicColor(light: 0xBF3418, dark: 0xFF7A5C)
    )

    func warning(_ active: Bool) -> Color {
        active ? warning : ink
    }

    static let activityBackground = current.background

    private static func dynamicColor(light: UInt, dark: UInt) -> Color {
        Color(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .light ? light : dark)
        })
    }

    static func segmentColor(
        _ segment: TravelTrackerActivityAttributes.Segment,
        lowLuminance: Bool = false
    ) -> Color {
        guard segment.kind == .ride, let color = segment.colorHex else {
            return current.quiet.opacity(lowLuminance ? 0.42 : 0.22)
        }
        return Color(hex: UInt(color))
    }

    static func keyline(for state: TravelTrackerActivityAttributes.ContentState) -> Color {
        if state.cancelled || state.tightConnection { return current.warning }
        return activeRide(for: state).map { segmentColor($0) } ?? current.quiet
    }

    static func activeLine(for state: TravelTrackerActivityAttributes.ContentState) -> String? {
        activeRide(for: state)?.line
    }

    static func vehicleSymbol(for state: TravelTrackerActivityAttributes.ContentState) -> String {
        let mode = activeRide(for: state)?.mode?.lowercased()
        switch mode {
        case "ferry": return "ferry.fill"
        case "metro": return "tram.fill"
        default: return "train.side.front.car"
        }
    }

    static func compactAccessibilityLabel(for state: TravelTrackerActivityAttributes.ContentState) -> String {
        if let line = activeLine(for: state), !line.isEmpty {
            return "\(line) travel tracker"
        }
        return "Travel tracker"
    }

    static func showsJourneyLine(_ state: TravelTrackerActivityAttributes.ContentState) -> Bool {
        state.stage != .missedTransfer
            && state.eventKind != .missedConnection
            && !state.segments.isEmpty
            && !state.segments.contains { $0.endFraction < $0.startFraction }
    }

    private static func activeRide(
        for state: TravelTrackerActivityAttributes.ContentState
    ) -> TravelTrackerActivityAttributes.Segment? {
        let rides = state.segments.filter { $0.kind == .ride }
        if state.stage == .boarding || state.stage == .transfer {
            return rides.first { $0.startFraction >= state.progress - 0.000_001 } ?? rides.last
        }
        return rides.first {
            state.progress >= $0.startFraction - 0.000_001
                && state.progress < $0.endFraction - 0.000_001
        } ?? rides.last
    }
}

private extension Color {
    init(hex: UInt) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}

private extension UIColor {
    convenience init(hex: UInt) {
        self.init(
            red: CGFloat((hex >> 16) & 0xff) / 255,
            green: CGFloat((hex >> 8) & 0xff) / 255,
            blue: CGFloat(hex & 0xff) / 255,
            alpha: 1
        )
    }
}
