import SwiftUI

struct DetailView: View {
    @ObservedObject var model: TrainViewModel
    @Environment(\.trainColors) private var colors

    var body: some View {
        if let journey = model.state.detail, let first = journey.legs.first, let last = journey.legs.last {
            let focused = model.state.focus?.journey.key == journey.key
            let pinned = focused && model.state.focus?.pinned == true
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        BackControl(label: "\(first.from.shortName) departures", action: model.back)
                            .fixedSize(horizontal: true, vertical: false)
                        Spacer(minLength: 8)
                        FreshnessView(board: model.state.board, now: model.state.now)
                    }
                    TrainLabel(text: "Journey").padding(.top, 2)
                    (Text(first.from.shortName) + Text(" → ").foregroundColor(colors.ink3) + Text(last.to.shortName))
                        .font(.system(size: 29, weight: .light)).tracking(-0.72).lineLimit(3).minimumScaleFactor(0.75).padding(.top, 6)
                    Text(summary(journey)).font(.system(size: 14, weight: .light)).foregroundStyle(journey.cancelled ? colors.warning : colors.ink2)
                        .padding(.top, 7).padding(.bottom, 18)
                    TrainRule(heavy: true)
                }
                .padding(.horizontal, pagePadding)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
                GeometryReader { geometry in
                    ScrollView {
                        LazyVStack(spacing: 0) {
                            BoardRow(journey: journey, board: model.state.board, now: model.state.now, detail: true,
                                     figureOverride: !journey.cancelled
                                        ? arrivalFigure(focused ? model.state.arrival : nil, journey: journey, now: model.state.now)
                                            ?? directionFigureFor(journey, now: model.state.now) : nil)
                            if let instruction = arrivalInstruction(
                                focused ? model.state.arrival : nil,
                                destination: last.to.shortName
                            ) {
                                Text(instruction).font(.system(size: 15, weight: .regular)).foregroundStyle(colors.ink)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, pagePadding).padding(.vertical, 10)
                            }
                            JourneySteps(journey: journey, now: model.state.now, arrival: focused ? model.state.arrival : nil)
                            Spacer().frame(height: 12)
                        }
                    }
                    .scrollIndicators(.hidden)
                    .frame(width: geometry.size.width, height: geometry.size.height)
                }
                VStack(spacing: 0) {
                    TrainRule(heavy: true)
                    HStack(spacing: 10) {
                        Text(clockTime(journey.effectiveArrival)).font(.system(size: 19, weight: .light)).foregroundStyle(last.cancelled ? colors.ink3 : colors.ink).strikethrough(last.cancelled).tabular()
                        Text(last.to.shortName).font(.system(size: 14, weight: .light)).foregroundStyle(colors.ink2).lineLimit(1)
                        Spacer()
                        TrainLabel(text: last.cancelled ? "Journey cancelled"
                                   : (focused && (model.state.arrival?.state == .checkingArrival || model.state.arrival?.state == .arrivalUnconfirmed))
                                    ? "Last estimate"
                                    : platformText(last.toPlatform, mode: last.mode, full: true) ?? "Arrive",
                                   color: last.cancelled ? colors.warning : colors.ink3, lines: 2)
                    }.frame(minHeight: 52)
                }
                .padding(.horizontal, pagePadding)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
                if pinned || (!focused && !journey.cancelled) {
                    ActionRail(text: pinned ? "Unpin this \(genericModeName(first.mode))" : "Pin this \(genericModeName(first.mode))", minHeight: 66) {
                        if pinned { model.unpinJourney() } else { model.pinJourney(journey) }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                    .layoutPriority(1)
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 24) {
                BackControl(label: "Departures", action: model.back)
                Text("Journey unavailable").font(.system(size: 18)).foregroundStyle(colors.ink2)
                Spacer()
            }.padding(.horizontal, pagePadding)
        }
    }

    private func summary(_ journey: Journey) -> String {
        if let cancelled = journey.legs.first(where: \.cancelled) {
            return "The \(clockTime(cancelled.departure)) from \(cancelled.from.shortName) is cancelled."
        }
        if journey.legs.count == 1 { return "Direct · arrives \(clockTime(journey.effectiveArrival))" }
        return "\(journey.legs.count - 1) \(journey.legs.count == 2 ? "change" : "changes") · arrives \(clockTime(journey.effectiveArrival))"
    }
}

private struct JourneySteps: View {
    let journey: Journey
    let now: Millis
    let arrival: ArrivalResult?
    var body: some View {
        if let first = journey.legs.first {
            DetailStep(time: clockTime(first.effectiveDeparture), station: first.from.shortName, platform: first.fromPlatform,
                       leg: first, action: "Board \(first.line) · \(first.headsign)", done: now > first.effectiveDeparture,
                       heavyDivider: journey.legs.count > 1)
            ForEach(Array(zip(journey.legs, journey.legs.dropFirst()).enumerated()), id: \.offset) { _, pair in
                ChangeStep(before: pair.0, after: pair.1)
            }
            if let last = journey.legs.last {
                DetailStep(time: clockTime(last.effectiveArrival), station: last.to.shortName, platform: last.toPlatform,
                           leg: last, action: last.cancelled ? "Arrive · journey cancelled" : "Arrive",
                           done: arrival.map { $0.state == .arrived } ?? (now >= last.effectiveArrival))
            }
        }
    }
}

private struct ChangeStep: View {
    let before: Leg
    let after: Leg
    @Environment(\.trainColors) private var colors
    private var wait: Int { minutesBetween(before.effectiveArrival, after.effectiveDeparture) }
    private var cancelled: Bool { before.cancelled || after.cancelled }
    private var station: String { before.to.id == after.from.id ? before.to.shortName : "\(before.to.shortName) → \(after.from.shortName)" }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 14) {
                VStack(alignment: .trailing, spacing: 3) {
                    Text(cancelled ? clockTime(after.effectiveDeparture) : "\(wait) min").font(.system(size: 17, weight: .light)).strikethrough(cancelled).tabular()
                    TrainLabel(text: cancelled ? "Cancelled" : "Change", color: wait < 5 || cancelled ? colors.warning : colors.ink3, size: 9)
                }.foregroundStyle(wait < 5 || cancelled ? colors.warning : colors.ink2).frame(width: 69)
                VStack(alignment: .leading, spacing: 7) {
                    Text(station).font(.system(size: 22, weight: .light)).foregroundStyle(cancelled ? colors.ink3 : colors.ink).strikethrough(cancelled)
                    HStack(alignment: .top, spacing: 7) {
                        if let platform = platformText(before.toPlatform, mode: before.mode) { LineChip(line: before.line, mode: before.mode, text: platform) }
                        TrainLabel(text: "Get off →", color: wait < 5 ? colors.warning : colors.ink3)
                        if let platform = platformText(after.fromPlatform, mode: after.mode) { LineChip(line: after.line, mode: after.mode, text: platform) }
                        TrainLabel(text: boardingCopy, color: wait < 5 ? colors.warning : colors.ink3, lines: 3)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }.padding(.horizontal, pagePadding).padding(.vertical, 10).frame(minHeight: 82)
            TrainRule(heavy: true).padding(.horizontal, pagePadding)
        }
    }
    private var boardingCopy: String {
        "Board \(after.line) · \(after.headsign)" + (platformText(after.fromPlatform, mode: after.mode, full: true).map { " · \($0)" } ?? "")
    }
}

private struct DetailStep: View {
    let time: String
    let station: String
    let platform: String?
    let leg: Leg
    let action: String
    let done: Bool
    var heavyDivider = false
    @Environment(\.trainColors) private var colors

    var body: some View {
        HStack(spacing: 14) {
            Text(time).font(.system(size: 17, weight: .light)).foregroundStyle(leg.cancelled ? colors.ink3 : colors.ink2)
                .strikethrough(leg.cancelled).tabular().frame(width: 69, alignment: .trailing)
            VStack(alignment: .leading, spacing: 5) {
                Text(station).font(.system(size: 17, weight: .regular)).foregroundStyle(done || leg.cancelled ? colors.ink2 : colors.ink).strikethrough(leg.cancelled)
                HStack(spacing: 7) {
                    if let platform = platformText(platform, mode: leg.mode) { LineChip(line: leg.line, mode: leg.mode, text: platform, height: 21, horizontalPadding: 5) }
                    TrainLabel(text: action, color: leg.cancelled ? colors.warning : colors.ink3, lines: 3)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }.padding(.horizontal, pagePadding).frame(minHeight: 72)
        TrainRule(heavy: heavyDivider).padding(.horizontal, pagePadding)
    }
}
