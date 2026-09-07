import SwiftUI

struct BoardView: View {
    @ObservedObject var model: TrainViewModel
    @Environment(\.trainColors) private var colors

    var body: some View {
        VStack(spacing: 0) {
            BoardMast(board: model.state.board, now: model.state.now, back: model.back)
            if let board = model.state.board {
                boardBody(board)
            } else {
                TrainLabel(text: model.state.refreshing ? "Opening timetable" : "Timetable unavailable")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }

    private func boardBody(_ board: BoardData) -> some View {
        let visible = board.journeys
        let past = visible.filter { $0.effectiveDeparture < model.state.now }
        let future = visible.filter { $0.effectiveDeparture >= model.state.now }
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    ForEach(past) { journey in
                        BoardRow(journey: journey, board: board, now: model.state.now) { model.openJourney(journey) }
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        TrainLabel(text: "Now · \(clockTime(model.state.now))", color: colors.ink, size: 11)
                            .padding(.top, 9)
                    }.frame(maxWidth: .infinity, minHeight: 32, alignment: .topLeading).padding(.horizontal, pagePadding).id("now")
                    ForEach(future) { journey in
                        BoardRow(journey: journey, board: board, now: model.state.now) { model.openJourney(journey) }
                    }
                    if visible.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(board.error ?? (board.offline ? "No services on the last board we could load" : "No services in the next few hours"))
                                .font(.system(size: 16, weight: .light)).foregroundStyle(board.error == nil ? colors.ink2 : colors.warning)
                            if board.error != nil {
                                Button("Update timetable", action: model.updateTimetable).buttonStyle(TrainTextButtonStyle(colors: colors))
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, pagePadding).padding(.vertical, 22)
                    } else {
                        VStack(alignment: .leading, spacing: 8) {
                            TrainLabel(text: visible.count == 6 ? "— Six services shown" : "— End of board")
                            if visible.count <= 3 {
                                Text("Nothing scheduled after \(visible.last.map { clockTime($0.effectiveDeparture) } ?? clockTime(model.state.now)).")
                                    .font(.system(size: 14, weight: .light)).foregroundStyle(colors.ink3)
                            }
                        }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, pagePadding).padding(.vertical, 15)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .refreshable { model.earlier() }
            .onAppear { if !past.isEmpty { proxy.scrollTo("now", anchor: .top) } }
        }
    }
}

private struct BoardMast: View {
    let board: BoardData?
    let now: Millis
    let back: () -> Void
    @Environment(\.trainColors) private var colors

    var body: some View {
        VStack(spacing: 0) {
            HStack { BackControl(label: "Home", action: back); Spacer(); FreshnessView(board: board, now: now) }
            if let board {
                HStack(spacing: 9) {
                    Text(board.from.shortName).frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 0) { Rectangle().fill(colors.rule2).frame(height: 1); Text("›").foregroundStyle(colors.ink3) }.frame(width: 44)
                    Text(board.to.shortName).frame(maxWidth: .infinity, alignment: .trailing).multilineTextAlignment(.trailing)
                }
                .font(.system(size: 25, weight: .light)).lineLimit(3).minimumScaleFactor(0.72).frame(minHeight: 69)
            } else { Spacer().frame(height: 56) }
            TrainRule(heavy: true)
        }.padding(.horizontal, pagePadding).padding(.top, 8)
    }
}

struct BoardRow: View {
    let journey: Journey
    let board: BoardData?
    let now: Millis
    var detail = false
    var figureOverride: Figure? = nil
    var action: (() -> Void)? = nil
    @Environment(\.trainColors) private var colors

    var body: some View {
        let fig = figureOverride ?? figureFor(journey, board: board, now: now)
        let late = minutesBetween(journey.departure, journey.effectiveDeparture) > 0
        let stale = board == nil || board?.offline == true || journey.retained == true || now - (board?.generatedAt ?? 0) > 90_000
        let content = HStack(spacing: 14) {
            VStack(alignment: .trailing, spacing: 4) {
                HStack(alignment: .lastTextBaseline, spacing: 2) {
                    Text(fig.value).font(.system(size: figureUsesCompactType(fig) ? 28 : 40, weight: .ultraLight)).tracking(-1.5)
                    if !fig.unit.isEmpty { Text(fig.unit).font(.system(size: 12, weight: .medium)) }
                }.foregroundStyle(figureColor(fig, late: late, stale: stale)).tabular().lineLimit(1)
                TrainLabel(text: fig.provenance, color: (late && !fig.past || journey.cancelled) ? colors.warning : colors.ink3,
                           size: 9, alignment: .trailing, lines: fig.provenance == "Last known" ? 2 : 1)
                    .frame(minHeight: fig.provenance == "Last known" ? 24 : 12)
            }.frame(width: detail ? 69 : 72, alignment: .trailing)
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .lastTextBaseline, spacing: 7) {
                    Text(clockTime(journey.effectiveDeparture)).foregroundStyle(late && journey.realtime ? colors.warning : journey.cancelled ? colors.ink3 : colors.ink)
                        .strikethrough(journey.cancelled)
                    if late && journey.effectiveDeparture != journey.departure {
                        Text(clockTime(journey.departure)).font(.system(size: 13, weight: .light)).foregroundStyle(colors.ink3).strikethrough()
                    }
                    Spacer()
                    Text(clockTime(journey.effectiveArrival)).font(.system(size: 16, weight: .light)).foregroundStyle(colors.ink3).strikethrough(journey.cancelled)
                    if journey.cancelled { TrainLabel(text: "Cancelled", color: colors.warning, size: 9) }
                }.font(.system(size: 18, weight: .light)).tabular()
                JourneyAxis(journey: journey).compositingGroup()
                    .opacity(journey.cancelled ? 0.3 : 1).padding(.top, 6)
                Text(journey.legs.first?.headsign.nonEmpty ?? journey.legs.first?.to.shortName ?? "")
                    .font(.system(size: 13, weight: .light)).foregroundStyle(colors.ink3).lineLimit(1).padding(.top, 6)
            }.frame(maxWidth: .infinity)
        }
        .padding(.horizontal, pagePadding).padding(.vertical, 9)
        .frame(maxWidth: .infinity, minHeight: detail ? 100 : 96).contentShape(Rectangle())
        Group {
            if let action {
                Button(action: action) { content }.buttonStyle(.plain)
            } else {
                content
            }
        }
        .accessibilityLabel("\(clockTime(journey.effectiveDeparture)) to \(clockTime(journey.effectiveArrival)), \(journey.legs.first?.headsign ?? "service")")
        .accessibilityIdentifier("service-\(Int(journey.departure))")
        TrainRule()
    }

    private func figureColor(_ figure: Figure, late: Bool, stale: Bool) -> Color {
        if journey.cancelled || figure.past { return colors.ink3 }
        if late { return colors.warning }
        if stale || !journey.realtime { return colors.ink2 }
        return colors.ink
    }

}

private extension String {
    var nonEmpty: String? { isEmpty ? nil : self }
}
