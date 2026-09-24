import SwiftUI
import WidgetKit

struct HomeTripEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
    /// Real time minus the content's clock; nonzero only for a seeded debug scenario.
    var clockOffset: Millis = 0
}

struct HomeTripProvider: TimelineProvider {
    var api = TransitAPI()

    func placeholder(in context: Context) -> HomeTripEntry {
        let now = Date()
        return HomeTripEntry(date: now, content: WidgetContent(date: now.millis))
    }

    func getSnapshot(in context: Context, completion: @escaping (HomeTripEntry) -> Void) {
        let api = api
        Task {
            let now = Date().millis
            let snapshot = readWidgetSnapshot(directory: widgetContainerURL()) ?? emptyWidgetSnapshot(now: now)
            #if DEBUG
            if let seed = WidgetDebugSeed.read() {
                completion(seed.entries(snapshot, realNow: now).first!)
                return
            }
            #endif
            // The gallery must answer at once, so its preview shows the app's own last board without asking the network.
            let sources = await widgetSources(snapshot, from: now, until: now, api: context.isPreview ? nil : api)
            completion(HomeTripEntry(date: Date(millis: now), content: widgetContent(snapshot, sources: sources, at: now)))
        }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HomeTripEntry>) -> Void) {
        let api = api
        Task {
            let now = Date().millis
            let snapshot = readWidgetSnapshot(directory: widgetContainerURL()) ?? emptyWidgetSnapshot(now: now)
            #if DEBUG
            if let seed = WidgetDebugSeed.read() {
                completion(Timeline(entries: seed.entries(snapshot, realNow: now), policy: .never))
                return
            }
            #endif
            let until = now + widgetTimelineHorizon
            let sources = await widgetSources(snapshot, from: now, until: until, api: api)
            let entries = widgetTimeline(snapshot, sources: sources, from: now, until: until)
                .map { HomeTripEntry(date: Date(millis: $0.date), content: $0) }
            completion(Timeline(entries: entries, policy: .after(Date(millis: now + widgetLiveRefresh))))
        }
    }
}

private func widgetSources(_ snapshot: WidgetSnapshot, from now: Millis, until: Millis, api: TransitAPI?) async -> [String: BoardData] {
    let requests = widgetRequests(snapshot, from: now, until: until)
    guard let api else {
        return Dictionary(requests.compactMap { request in request.fallback.map { (request.key, retainedOfflineBoard($0)) } },
                          uniquingKeysWith: { first, _ in first })
    }
    return await withTaskGroup(of: (String, BoardData).self) { group in
        for request in requests {
            group.addTask {
                let fetched = try? await api.departurePage(
                    from: request.from, to: request.to, modes: request.modes,
                    at: request.at, transferLimit: request.transferLimit, timeout: 10
                ).board
                return (request.key, widgetSource(request, fetched: fetched))
            }
        }
        var result: [String: BoardData] = [:]
        for await (key, board) in group { result[key] = board }
        return result
    }
}

#if DEBUG
/// A renderer check's scenario: its boards answer in place of the network, and its clock is mapped onto real time.
private struct WidgetDebugSeed: Decodable {
    var now: Millis
    var boards: [BoardData]

    static func read() -> WidgetDebugSeed? {
        guard let url = widgetContainerURL()?.appendingPathComponent("widget-debug-seed.json"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? JSONDecoder().decode(WidgetDebugSeed.self, from: data)
    }

    func entries(_ snapshot: WidgetSnapshot, realNow: Millis) -> [HomeTripEntry] {
        let until = now + widgetTimelineHorizon
        let sources = Dictionary(widgetRequests(snapshot, from: now, until: until).map { request in
            let fetched = boards.first { $0.from.id == request.from.id && $0.to.id == request.to.id }
            return (request.key, widgetSource(request, fetched: fetched))
        }, uniquingKeysWith: { first, _ in first })
        let offset = realNow - now
        return widgetTimeline(snapshot, sources: sources, from: now, until: until)
            .map { HomeTripEntry(date: Date(millis: $0.date + offset), content: $0, clockOffset: offset) }
    }
}
#endif

private func emptyWidgetSnapshot(now: Millis) -> WidgetSnapshot {
    WidgetSnapshot(writtenAt: now, trips: [], schedule: [], modes: [], boards: [])
}

private extension Date {
    init(millis: Millis) { self.init(timeIntervalSince1970: millis / 1_000) }
    var millis: Millis { (timeIntervalSince1970 * 1_000).rounded() }
}

struct HomeTripWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: homeWidgetKind, provider: HomeTripProvider()) { entry in
            HomeTripView(content: entry.content, clockOffset: entry.clockOffset)
                .widgetURL(entry.content.answer == nil ? widgetSetupURL : widgetHomeURL)
        }
        .configurationDisplayName("Next train")
        .description("The next train for the trip you usually take at this time.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
        .contentMarginsDisabled()
    }
}

struct WidgetStyle {
    let colors: TrainColors
    /// Tinted, clear and lock renderings drop colour, so lines are named in text and fills are cut out.
    let monochrome: Bool

    func clock(_ journey: Journey, now: Millis, includesHorizon: Bool) -> Color {
        if journey.cancelled { return colors.ink3 }
        if widgetLateMinutes(journey) > 0 && journey.realtime { return colors.warning }
        return widgetScheduledOnly(journey, now: now, includesHorizon: includesHorizon) ? colors.ink2 : colors.ink
    }
}

struct HomeTripView: View {
    let content: WidgetContent
    var clockOffset: Millis = 0
    @Environment(\.widgetFamily) private var family
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetRenderingMode) private var renderingMode

    var body: some View {
        let style = WidgetStyle(colors: scheme == .light ? .lightPalette : .darkPalette, monochrome: renderingMode != .fullColor)
        Group {
            switch family {
            case .accessoryRectangular:
                TripLockView(content: content, clockOffset: clockOffset)
            case .systemMedium:
                TripMediumView(content: content, style: style)
                    .padding(EdgeInsets(top: 13, leading: 16, bottom: 12, trailing: 16))
            default:
                TripSmallView(content: content, style: style)
                    .padding(EdgeInsets(top: 14, leading: 15, bottom: 14, trailing: 15))
            }
        }
        .containerBackground(for: .widget) {
            family == .accessoryRectangular ? Color.clear : style.colors.ground
        }
    }
}

private func riding(_ content: WidgetContent) -> Bool {
    guard let lead = content.lead, content.answer?.focus != nil, content.replaced == nil else { return false }
    return content.date > lead.effectiveDeparture
}

private struct TripSmallView: View {
    let content: WidgetContent
    let style: WidgetStyle

    var body: some View {
        Group {
            if let answer = content.answer {
                if let lead = content.lead, riding(content) {
                    ViewThatFits(in: .vertical) {
                        SmallRidingView(content: content, lead: lead, style: style, showsFollowingStep: true)
                        SmallRidingView(content: content, lead: lead, style: style, showsFollowingStep: false)
                    }
                } else if let lead = content.lead {
                    SmallLeadView(content: content, answer: answer, lead: lead, style: style)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        WidgetRoute(answer: answer, size: 12.5, color: style.colors.ink2, style: style)
                        Spacer(minLength: 6)
                        WidgetMessage(text: widgetNoServiceText(content), size: 14, style: style)
                        FreshnessLine(freshness: content.freshness, style: style).padding(.top, 8)
                    }
                }
            } else {
                EmptyTripView(style: style)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct SmallLeadView: View {
    let content: WidgetContent
    let answer: WidgetAnswer
    let lead: Journey
    let style: WidgetStyle

    private var colors: TrainColors { style.colors }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let status = widgetStatus(content) {
                StatusLine(status: status, style: style).padding(.bottom, 5)
            }
            WidgetRoute(answer: answer, size: 12.5, color: colors.ink2, style: style)
            if let replaced = content.replaced {
                WidgetLabel(text: "\(clockTime(replaced.effectiveDeparture)) cancelled", color: colors.warning).padding(.top, 7)
            }
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(clockTime(lead.effectiveDeparture))
                    .font(.system(size: 40, weight: widgetScheduledOnly(lead, now: content.date, includesHorizon: false) ? .ultraLight : .thin))
                    .tracking(-1.4)
                    .foregroundStyle(style.clock(lead, now: content.date, includesHorizon: false))
                    .strikethrough(lead.cancelled)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 2)
                if !lead.cancelled {
                    CountdownText(countdown: widgetCountdown(to: lead.effectiveDeparture, now: content.date), size: 15, style: style)
                }
            }
            .monospacedDigit()
            .padding(.top, content.replaced == nil ? 6 : 2)
            LeadNote(journey: lead, now: content.date, style: style)
            Spacer(minLength: 4)
            PlaceLine(lead: lead, style: style)
            FreshnessLine(freshness: content.freshness, style: style).padding(.top, 7)
        }
    }
}

private struct SmallRidingView: View {
    let content: WidgetContent
    let lead: Journey
    let style: WidgetStyle
    let showsFollowingStep: Bool

    private var colors: TrainColors { style.colors }

    var body: some View {
        let steps = widgetSteps(lead)
        let index = widgetNextStep(steps, now: content.date)
        let step = steps[index ?? steps.count - 1]
        VStack(alignment: .leading, spacing: 0) {
            if let status = widgetStatus(content) {
                StatusLine(status: status, style: style)
            }
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(clockTime(step.time))
                    .font(.system(size: 40, weight: .thin)).tracking(-1.4)
                    .foregroundStyle(index == nil ? colors.ink2 : colors.ink)
                    .lineLimit(1).minimumScaleFactor(0.8)
                Spacer(minLength: 2)
                if index != nil {
                    CountdownText(countdown: widgetCountdown(to: step.time, now: content.date), size: 15, style: style)
                }
            }
            .monospacedDigit()
            .padding(.top, 5)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                WidgetLabel(text: stepWord(step, headsign: false), color: colors.ink2)
                Text(step.station).font(.system(size: 14, weight: .light)).foregroundStyle(colors.ink)
                    .lineLimit(1).minimumScaleFactor(0.8)
            }
            .padding(.top, 3)
            Spacer(minLength: 4)
            if let place = stepPlace(step) {
                HStack(spacing: 6) {
                    if style.monochrome { LineName(leg: step.leg, style: style) }
                    WidgetChip(text: place, leg: step.leg, style: style, height: 17, padding: 5)
                }
            }
            if showsFollowingStep, let index, index + 1 < steps.count {
                let next = steps[index + 1]
                HStack(spacing: 6) {
                    Text(clockTime(next.time)).font(.system(size: 13, weight: .light)).foregroundStyle(colors.ink2).monospacedDigit()
                    WidgetLabel(text: stepWord(next, headsign: false), color: colors.ink3)
                    if let chip = transferPlatformText(next.platform, mode: next.leg.mode) {
                        WidgetChip(text: chip, leg: next.leg, style: style)
                    }
                }
                .padding(.top, 5)
            }
            FreshnessLine(freshness: content.freshness, style: style).padding(.top, 6)
        }
    }
}

private struct TripMediumView: View {
    let content: WidgetContent
    let style: WidgetStyle

    private var colors: TrainColors { style.colors }

    var body: some View {
        Group {
            if let answer = content.answer {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if riding(content), let status = widgetStatus(content) {
                            StatusLine(status: status, style: style)
                        } else {
                            WidgetRoute(answer: answer, size: 13, color: colors.ink, style: style)
                        }
                        Spacer(minLength: 6)
                        if let freshness = content.freshness {
                            WidgetLabel(text: freshness.text, color: freshness.warns ? colors.warning : colors.ink3)
                                .lineLimit(1).fixedSize()
                        }
                    }
                    if riding(content), let lead = content.lead {
                        MediumSteps(lead: lead, now: content.date, style: style).padding(.top, 5)
                    } else if !content.rows.isEmpty {
                        MediumBoard(content: content, style: style).padding(.top, 5)
                    } else {
                        Spacer(minLength: 6)
                        WidgetMessage(text: widgetNoServiceText(content), size: 15, style: style)
                    }
                }
            } else {
                EmptyTripView(style: style)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private let mediumRowHeight: CGFloat = 38

private struct MediumBoard: View {
    let content: WidgetContent
    let style: WidgetStyle

    var body: some View {
        let rows = content.rows
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, journey in
                if index > 0 { RowRule(style: style) }
                BoardRowView(
                    journey: journey,
                    now: content.date,
                    lead: journey.key == content.lead?.key,
                    pinned: journey.key == content.lead?.key && content.answer?.focus?.pinned == true && content.replaced == nil,
                    style: style
                )
                .frame(height: mediumRowHeight)
            }
            // A board that ran out says so; a followed service or a saved board may simply not know what comes next.
            if rows.count < 3, content.answer?.focus == nil, content.board?.offline == false, let last = rows.last {
                VStack(alignment: .leading, spacing: 2) {
                    WidgetLabel(text: "— End of board", color: style.colors.ink3)
                    Text("Nothing scheduled after \(clockTime(last.effectiveDeparture)).")
                        .font(.system(size: 13, weight: .light)).foregroundStyle(style.colors.ink3)
                }
                .padding(.top, 8)
            }
            Spacer(minLength: 0)
        }
    }
}

private struct BoardRowView: View {
    let journey: Journey
    let now: Millis
    let lead: Bool
    let pinned: Bool
    let style: WidgetStyle

    private var colors: TrainColors { style.colors }

    var body: some View {
        let late = widgetLateMinutes(journey)
        let scheduled = widgetScheduledOnly(journey, now: now, includesHorizon: true)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 9) {
                Text(clockTime(journey.effectiveDeparture))
                    .font(.system(size: 21, weight: scheduled ? .ultraLight : lead ? .light : .thin))
                    .tracking(-0.6)
                    .foregroundStyle(style.clock(journey, now: now, includesHorizon: true))
                    .strikethrough(journey.cancelled)
                    .lineLimit(1)
                    .frame(width: 58, alignment: .leading)
                HStack(alignment: .firstTextBaseline, spacing: 2) {
                    if pinned {
                        Image(systemName: "pin.fill").font(.system(size: 11)).foregroundStyle(colors.ink2)
                    }
                    if journey.cancelled {
                        Text("—").font(.system(size: 15, weight: .light)).foregroundStyle(colors.ink3)
                    } else {
                        CountdownText(countdown: widgetCountdown(to: journey.effectiveDeparture, now: now), size: 15, style: style)
                    }
                }
                .frame(width: 54, alignment: .leading)
                if style.monochrome {
                    WidgetLabel(text: orderedLineCodes(journey).joined(separator: " "), color: colors.ink2).lineLimit(1).fixedSize()
                }
                JourneyBar(journey: journey, style: style)
                    .opacity(journey.cancelled ? 0.3 : 1)
                Text(clockTime(journey.effectiveArrival))
                    .font(.system(size: 15, weight: .light))
                    .foregroundStyle(journey.cancelled ? colors.ink3 : colors.ink2)
                    .strikethrough(journey.cancelled)
                    .lineLimit(1)
                    .fixedSize()
                    .frame(minWidth: 40, alignment: .trailing)
            }
            .monospacedDigit()
            if journey.cancelled || late > 0 || scheduled {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    Group {
                        if late > 0, !journey.cancelled {
                            Text(clockTime(journey.departure)).font(.system(size: 11, weight: .light))
                                .foregroundStyle(colors.ink3).strikethrough().monospacedDigit()
                        } else {
                            Color.clear.frame(height: 1)
                        }
                    }
                    .frame(width: 58, alignment: .leading)
                    WidgetLabel(
                        text: journey.cancelled ? "Cancelled" : late > 0 ? "\(late) min late" : "Scheduled",
                        color: journey.cancelled || late > 0 ? colors.warning : colors.ink3
                    )
                    .lineLimit(1)
                }
            }
        }
        .frame(maxHeight: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct MediumSteps: View {
    let lead: Journey
    let now: Millis
    let style: WidgetStyle

    private var colors: TrainColors { style.colors }

    var body: some View {
        let steps = widgetSteps(lead)
        let next = widgetNextStep(steps, now: now) ?? steps.count
        let start = max(0, min(next - 1, steps.count - 4))
        let shown = Array(steps.enumerated()).dropFirst(start).prefix(4)
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(shown), id: \.offset) { index, step in
                if index > start { RowRule(style: style) }
                let done = index < next
                HStack(alignment: .center, spacing: 9) {
                    Text(clockTime(step.time))
                        .font(.system(size: 21, weight: index == next ? .light : .thin)).tracking(-0.6)
                        .foregroundStyle(done ? colors.ink3 : colors.ink)
                        .lineLimit(1)
                        .frame(width: 58, alignment: .leading)
                    Group {
                        if index == next {
                            CountdownText(countdown: widgetCountdown(to: step.time, now: now), size: 15, style: style)
                        } else {
                            Color.clear.frame(height: 1)
                        }
                    }
                    .frame(width: 54, alignment: .leading)
                    StepWords(step: step, first: index == 0, done: done, style: style)
                    Spacer(minLength: 4)
                    if let chip = transferPlatformText(step.platform, mode: step.leg.mode) {
                        WidgetChip(text: chip, leg: step.leg, style: style).opacity(done ? 0.38 : 1)
                    }
                }
                .monospacedDigit()
                .frame(maxHeight: .infinity)
            }
        }
    }
}

private struct StepWords: View {
    let step: WidgetStep
    let first: Bool
    let done: Bool
    let style: WidgetStyle

    var body: some View {
        let colors = style.colors
        if step.kind == .board, !first {
            ViewThatFits(in: .horizontal) {
                WidgetLabel(text: stepWord(step, headsign: true), color: done ? colors.ink3 : colors.ink2).lineLimit(1).fixedSize()
                WidgetLabel(text: stepWord(step, headsign: false), color: done ? colors.ink3 : colors.ink2).lineLimit(1)
            }
        } else {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                WidgetLabel(text: stepWord(step, headsign: false), color: done ? colors.ink3 : colors.ink2).lineLimit(1).fixedSize()
                Text(step.station).font(.system(size: 13, weight: .light))
                    .foregroundStyle(done ? colors.ink3 : colors.ink).lineLimit(1).minimumScaleFactor(0.85)
            }
        }
    }
}

private struct TripLockView: View {
    let content: WidgetContent
    let clockOffset: Millis

    var body: some View {
        let sentence = widgetLockSentence(content)
        let footer = content.freshness.flatMap { $0.warns ? $0.text : nil } ?? sentence.arrival
        VStack(alignment: .leading, spacing: 1) {
            headline(sentence)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
            if !sentence.instruction.isEmpty {
                sentence.instruction.reduce(Text("")) { text, run in
                    text + Text(run.text).fontWeight(run.strong ? .bold : .regular)
                }
                .font(.system(size: 13))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            }
            if let footer {
                Text(footer).font(.system(size: 13)).foregroundStyle(.secondary)
                    .lineLimit(1).minimumScaleFactor(0.85)
            }
        }
        .monospacedDigit()
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private func headline(_ sentence: WidgetLockSentence) -> Text {
        guard let deadline = sentence.deadline else { return Text(sentence.subject) }
        let end = Date(timeIntervalSince1970: (deadline + clockOffset) / 1_000)
        let start = min(Date(timeIntervalSince1970: (content.date + clockOffset) / 1_000), end)
        return Text(sentence.subject) + Text(timerInterval: start...end, countsDown: true)
    }
}

private struct EmptyTripView: View {
    let style: WidgetStyle

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 5) {
                Image(systemName: "plus").font(.system(size: 11, weight: .semibold))
                WidgetLabel(text: "New trip", color: style.colors.ink2)
            }
            .foregroundStyle(style.colors.ink2)
            Text("Choose where you start").font(.system(size: 17, weight: .light)).foregroundStyle(style.colors.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

private struct WidgetMessage: View {
    let text: String
    let size: CGFloat
    let style: WidgetStyle

    var body: some View {
        Text(text).font(.system(size: size, weight: .light)).foregroundStyle(style.colors.ink2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// The app's letterspaced label idiom at the widget floor of 11 pt, tracked tighter so a freshness line fits a small tile.
private struct WidgetLabel: View {
    let text: String
    let color: Color

    var body: some View {
        Text(text.uppercased())
            .font(.system(size: 11, weight: .semibold))
            .tracking(0.66)
            .foregroundStyle(color)
            .monospacedDigit()
    }
}

private struct StatusLine: View {
    let status: WidgetStatus
    let style: WidgetStyle

    var body: some View {
        let colors = style.colors
        HStack(spacing: 5) {
            if let text = status.text {
                WidgetLabel(text: text, color: status.warns ? colors.warning : colors.ink2)
                if status.pinned { Text("·").font(.system(size: 11)).foregroundStyle(colors.ink3) }
            }
            if status.pinned {
                Image(systemName: "pin.fill").font(.system(size: 11)).foregroundStyle(colors.ink2)
                WidgetLabel(text: "Pinned", color: colors.ink2)
            }
        }
        .lineLimit(1)
    }
}

private struct WidgetRoute: View {
    let answer: WidgetAnswer
    let size: CGFloat
    let color: Color
    let style: WidgetStyle

    var body: some View {
        let forms = widgetRouteForms(from: answer.from.station.shortName, to: answer.to.station.shortName)
        ViewThatFits(in: .horizontal) {
            ForEach(forms.indices, id: \.self) { index in
                line(forms[index]).lineLimit(1).fixedSize()
            }
            // Past the last rule the names scale toward the floor and may wrap between words, never ellipsise.
            line(forms[forms.count - 1]).lineLimit(2).minimumScaleFactor(11 / size)
        }
        .font(.system(size: size, weight: .light))
        .foregroundStyle(color)
    }

    private func line(_ form: (from: String, to: String)) -> Text {
        Text(form.from) + Text(" → ").foregroundColor(style.colors.ink3) + Text(form.to)
    }
}

private struct CountdownText: View {
    let countdown: WidgetCountdown
    let size: CGFloat
    let style: WidgetStyle

    var body: some View {
        (Text(countdown.value).font(.system(size: size, weight: .regular)).foregroundColor(style.colors.ink)
            + Text(countdown.unit.isEmpty ? "" : " \(countdown.unit)").font(.system(size: 11, weight: .medium)).foregroundColor(style.colors.ink2))
            .lineLimit(1)
            .fixedSize()
            .monospacedDigit()
    }
}

private struct LeadNote: View {
    let journey: Journey
    let now: Millis
    let style: WidgetStyle

    var body: some View {
        let colors = style.colors
        let late = widgetLateMinutes(journey)
        if journey.cancelled {
            WidgetLabel(text: "Cancelled", color: colors.warning).padding(.top, 4)
        } else if late > 0 {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Text(clockTime(journey.departure)).font(.system(size: 12, weight: .light))
                    .foregroundStyle(colors.ink3).strikethrough().monospacedDigit()
                WidgetLabel(text: "\(late) min late", color: colors.warning)
            }
            .padding(.top, 4)
        } else if widgetScheduledOnly(journey, now: now, includesHorizon: false) {
            WidgetLabel(text: "Scheduled", color: colors.ink3).padding(.top, 4)
        }
    }
}

/// The boarding cap and the arrival clock, sharing a line when both fit.
private struct PlaceLine: View {
    let lead: Journey
    let style: WidgetStyle

    var body: some View {
        let first = lead.legs[0]
        let place = departurePlatformText(first.fromPlatform, mode: first.mode)
        // A thin space keeps the cap and the arrival on one line of a 164 pt tile at the 11 pt floor.
        let arrival = Text("→\u{2009}\(clockTime(lead.effectiveArrival))")
            .font(.system(size: 13, weight: .light))
            .foregroundStyle(lead.cancelled ? style.colors.ink3 : style.colors.ink2)
            .strikethrough(lead.cancelled)
            .monospacedDigit()
            .lineLimit(1)
            .fixedSize()
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                cap(place, first)
                Spacer(minLength: 5)
                arrival
            }
            VStack(alignment: .leading, spacing: 5) {
                cap(place, first)
                arrival.frame(maxWidth: .infinity, alignment: .trailing)
            }
        }
    }

    private func cap(_ place: String?, _ leg: Leg) -> some View {
        HStack(spacing: 6) {
            if style.monochrome { LineName(leg: leg, style: style) }
            if let place {
                WidgetChip(text: place, leg: leg, style: style, height: 17)
            }
        }
    }
}

private struct LineName: View {
    let leg: Leg
    let style: WidgetStyle

    var body: some View {
        Text(widgetServiceName(leg)).font(.system(size: 13, weight: .semibold)).foregroundStyle(style.colors.ink)
            .lineLimit(1).fixedSize()
    }
}

private struct FreshnessLine: View {
    let freshness: WidgetFreshness?
    let style: WidgetStyle

    var body: some View {
        if let freshness {
            WidgetLabel(text: freshness.text, color: freshness.warns ? style.colors.warning : style.colors.ink3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

private struct RowRule: View {
    let style: WidgetStyle

    var body: some View {
        Rectangle().fill(style.colors.rule).frame(height: 1).padding(.horizontal, -16)
    }
}

/// A filled platform label; monochrome renderings punch its text out of the fill so it survives the loss of colour.
private struct WidgetChip: View {
    let text: String
    let leg: Leg
    let style: WidgetStyle
    var height: CGFloat = 16
    var padding: CGFloat = 4

    var body: some View {
        let label = Text(text.uppercased()).font(.system(size: 11, weight: .bold)).lineLimit(1).fixedSize()
        if style.monochrome {
            label.hidden()
                .padding(.horizontal, padding)
                .frame(minWidth: height, minHeight: height, maxHeight: height)
                .background(RoundedRectangle(cornerRadius: lineChipCornerRadius).fill(style.colors.ink))
                .overlay(label.blendMode(.destinationOut))
                .compositingGroup()
                .widgetAccentable()
        } else {
            label
                .foregroundStyle(chipInk(leg.line, mode: leg.mode, colors: style.colors))
                .padding(.horizontal, padding)
                .frame(minWidth: height, minHeight: height, maxHeight: height)
                .background(lineColor(leg.line, mode: leg.mode, colors: style.colors, fill: true),
                            in: RoundedRectangle(cornerRadius: lineChipCornerRadius))
        }
    }
}

/// Each row's journey on its own time axis: rides in line colour, changes as gaps, platforms as numeral chips.
private struct JourneyBar: View {
    let journey: Journey
    let style: WidgetStyle

    private let height: CGFloat = 16

    var body: some View {
        GeometryReader { proxy in
            let layout = JourneyBarLayout(journey: journey, width: proxy.size.width)
            ZStack(alignment: .topLeading) {
                ForEach(Array(layout.segments.enumerated()), id: \.offset) { _, segment in
                    Rectangle()
                        .fill(segmentColor(segment))
                        .frame(width: max(0, segment.width), height: 4)
                        .offset(x: segment.x, y: (height - 4) / 2)
                        .widgetAccentable(segment.leg != nil)
                }
                ForEach(Array(layout.chips.enumerated()), id: \.offset) { _, chip in
                    WidgetChip(text: chip.text, leg: chip.leg, style: style, height: height)
                        .frame(width: chip.width)
                        .offset(x: chip.x)
                }
            }
        }
        .frame(height: height)
    }

    private func segmentColor(_ segment: JourneyBarLayout.Segment) -> Color {
        guard let leg = segment.leg else { return segment.tight ? style.colors.warning : style.colors.rule2 }
        return style.monochrome ? style.colors.ink : lineColor(leg.line, mode: leg.mode, colors: style.colors, fill: true)
    }
}

private struct JourneyBarLayout {
    struct Segment {
        var x: CGFloat
        var width: CGFloat
        var leg: Leg?
        var tight = false
    }

    struct Chip {
        var text: String
        var leg: Leg
        var x: CGFloat
        var width: CGFloat
    }

    var segments: [Segment] = []
    var chips: [Chip] = []

    init(journey: Journey, width: CGFloat) {
        guard let first = journey.legs.first else { return }
        let start = journey.effectiveDeparture
        let span = max(1, journey.effectiveArrival - start)
        func x(_ time: Millis) -> CGFloat { min(width, max(0, CGFloat((time - start) / span) * width)) }
        let states = connectionStates(journey.legs)
        for (index, leg) in journey.legs.enumerated() {
            segments.append(Segment(x: x(leg.effectiveDeparture), width: x(leg.effectiveArrival) - x(leg.effectiveDeparture), leg: leg))
            if index + 1 < journey.legs.count {
                let next = journey.legs[index + 1]
                segments.append(Segment(x: x(leg.effectiveArrival), width: x(next.effectiveDeparture) - x(leg.effectiveArrival),
                                        tight: states[index] == .tight && !journey.cancelled))
            }
        }
        var edge: CGFloat = 0
        func place(_ raw: String?, _ leg: Leg, at anchor: CGFloat, trailing: Bool) {
            guard let text = transferPlatformText(raw, mode: leg.mode) else { return }
            let chipWidth = max(16, CGFloat(text.count) * 7 + 8)
            let x = min(max(trailing ? anchor - chipWidth : anchor, edge), max(0, width - chipWidth))
            chips.append(Chip(text: text, leg: leg, x: x, width: chipWidth))
            edge = x + chipWidth + 1
        }
        place(first.fromPlatform, first, at: 0, trailing: false)
        for index in journey.legs.indices.dropLast() {
            let leg = journey.legs[index], next = journey.legs[index + 1]
            // As the app's axis: a two-change journey hides the second change's alighting pin.
            if journey.legs.count <= 2 || index == 0 {
                place(leg.toPlatform, leg, at: x(leg.effectiveArrival), trailing: true)
            }
            place(next.fromPlatform, next, at: x(next.effectiveDeparture), trailing: false)
        }
    }
}

private func stepWord(_ step: WidgetStep, headsign: Bool) -> String {
    switch step.kind {
    case .board:
        let service = "Board \(widgetServiceName(step.leg))"
        return headsign && !step.leg.headsign.isEmpty ? "\(service) · \(step.leg.headsign)" : service
    case .getOff: return "Get off"
    case .arrive: return "Arrive"
    }
}

private func stepPlace(_ step: WidgetStep) -> String? {
    step.kind == .board
        ? departurePlatformText(step.platform, mode: step.leg.mode)
        : platformText(step.platform, mode: step.leg.mode, full: true)
}
