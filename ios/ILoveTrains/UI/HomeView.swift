import SwiftUI

struct HomeView: View {
    @ObservedObject var model: TrainViewModel
    @Environment(\.trainColors) private var colors

    private var board: BoardData? { model.state.homeBoard ?? model.state.board }
    private var presentation: HomePresentation? {
        if let focus = model.state.focus {
            let alternatives = focus.alternatives ?? focus.board
            if focus.journey.cancelled, model.state.now < focus.journey.effectiveDeparture,
               let replacement = alternatives.journeys.first(where: {
                   journeyAllowed($0, modes: model.state.enabledModes) && !$0.cancelled
                       && $0.effectiveDeparture > focus.journey.effectiveDeparture
               }) {
                return HomePresentation(
                    journey: replacement,
                    board: alternatives,
                    alternatives: alternatives,
                    cancelledLeadTime: focus.journey.effectiveDeparture
                )
            }
            return HomePresentation(
                journey: focus.journey,
                board: focus.board,
                alternatives: alternatives,
                cancelledLeadTime: nil
            )
        }
        guard let board else { return nil }
        let retained = retainedHomeJourney(board, now: model.state.now)
        let firstFuture = retained ?? board.journeys.first { $0.effectiveDeparture >= model.state.now }
        let firstRunning = retained.flatMap { $0.cancelled ? nil : $0 }
            ?? board.journeys.first { !$0.cancelled && $0.effectiveDeparture >= model.state.now }
        guard let journey = firstRunning ?? firstFuture else { return nil }
        return HomePresentation(
            journey: journey,
            board: board,
            alternatives: nil,
            cancelledLeadTime: firstFuture?.cancelled == true && firstRunning != nil ? firstFuture?.effectiveDeparture : nil
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if let presentation {
                SmartHeader(
                    model: model,
                    board: presentation.board,
                    alternatives: presentation.alternatives,
                    journey: presentation.journey,
                    cancelledLeadTime: presentation.cancelledLeadTime
                )
            } else if !model.state.trips.isEmpty {
                SmartLoadingHeader(model: model, board: board)
            } else if model.state.totalTrips > 0 {
                VStack(alignment: .leading, spacing: 10) {
                    Text("No trips match your selected services.")
                        .font(.system(size: 20, weight: .light)).foregroundStyle(colors.ink2)
                    Button("Change settings", action: model.openSettings)
                        .buttonStyle(TrainTextButtonStyle(colors: colors)).accessibilityIdentifier("change-settings")
                }
                .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, pagePadding).padding(.vertical, 28)
                TrainRule(heavy: true)
            }

            List {
                TrainLabel(text: "My trips", color: colors.ink, size: 11)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 22).padding(.bottom, 10)
                    .padding(.horizontal, pagePadding).tripListRow(colors)
                ForEach(model.state.trips, id: \.id) { trip in
                    SavedTripRow(trip: trip, state: model.state, model: model).tripListRow(colors)
                }
                TrainLabel(text: "— End of trips")
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 14).padding(.bottom, 6)
                    .padding(.horizontal, pagePadding).tripListRow(colors)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .scrollIndicators(.hidden)
            .environment(\.defaultMinListRowHeight, 1)
            HomeFooter(model: model)
        }
    }
}

private extension View {
    func tripListRow(_ colors: TrainColors) -> some View {
        listRowInsets(EdgeInsets()).listRowSeparator(.hidden).listRowBackground(colors.ground)
    }
}

private struct HomePresentation {
    let journey: Journey
    let board: BoardData
    let alternatives: BoardData?
    let cancelledLeadTime: Millis?
}

private struct SmartLoadingHeader: View {
    @ObservedObject var model: TrainViewModel
    let board: BoardData?
    @Environment(\.trainColors) private var colors

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                TrainLabel(text: "Next train", color: colors.ink2, size: 11)
                Spacer(); FreshnessView(board: board, now: model.state.now)
            }.padding(.horizontal, pagePadding).frame(minHeight: 22)
            HStack {
                Text(copy).font(.system(size: 15, weight: .light)).foregroundStyle(colors.ink2)
                Spacer()
                if board?.error != nil {
                    Button("Update timetable", action: model.updateTimetable).buttonStyle(TrainTextButtonStyle(colors: colors))
                } else if model.state.enabledModes.isEmpty {
                    Button("Settings", action: model.openSettings).buttonStyle(TrainTextButtonStyle(colors: colors))
                }
            }.padding(.horizontal, pagePadding).frame(minHeight: 126)
            TrainRule(heavy: true)
        }
    }

    private var copy: String {
        if let error = board?.error { return error }
        if model.state.enabledModes.isEmpty { return "Turn on a service in Settings" }
        if model.state.refreshing { return "Getting the next trains…" }
        if board?.offline == true { return "No saved board for this trip yet" }
        return "No services in the next few hours"
    }
}

private struct SmartHeader: View {
    @ObservedObject var model: TrainViewModel
    let board: BoardData
    let alternatives: BoardData?
    let journey: Journey
    let cancelledLeadTime: Millis?
    @Environment(\.trainColors) private var colors

    private var first: Leg { journey.legs[0] }
    private var focus: FocusedJourney? { model.state.focus }
    private var focused: Bool { focus != nil && cancelledLeadTime == nil }
    private var pinned: Bool { focused && focus?.pinned == true }
    private var departed: Bool { focused && model.state.now >= journey.effectiveDeparture }
    private var complete: Bool { model.state.focusComplete || model.state.now >= journey.effectiveArrival }
    private var late: Bool {
        focused ? focusJourneyIsLate(journey, board: board, now: model.state.now)
            : minutesBetween(journey.departure, journey.effectiveDeparture) > 0
    }
    private var statusWarning: Bool { status == "Cancelled" || status == "Running late" }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 6) {
                if pinned {
                    Button(action: model.unpinJourney) {
                        HStack(spacing: 5) {
                            if status == "Pinned" { Image(systemName: "pin.fill").font(.system(size: 12)) }
                            TrainLabel(text: status, color: statusWarning ? colors.warning : colors.ink2, size: 11)
                            if status != "Pinned" { Text("·").foregroundStyle(colors.ink3); Image(systemName: "pin.fill").font(.system(size: 12)); TrainLabel(text: "Pinned", color: colors.ink2, size: 11) }
                        }.frame(minHeight: 44)
                    }.buttonStyle(.plain).accessibilityIdentifier("unpin-home")
                } else {
                    TrainLabel(text: status, color: statusWarning ? colors.warning : colors.ink2, size: 11)
                }
                Spacer(); FreshnessView(board: board, now: model.state.now)
            }.padding(.horizontal, pagePadding).frame(minHeight: pinned ? 44 : 22)

            HStack(alignment: .top, spacing: 14) {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .lastTextBaseline, spacing: 2) {
                        Text(displayFigure.value).font(.system(size: figureUsesCompactType(displayFigure) ? 50 : 64, weight: .ultraLight))
                            .tracking(-2).foregroundStyle(late ? colors.warning : colors.ink).lineLimit(1).minimumScaleFactor(0.7)
                        Text(displayFigure.unit).font(.system(size: 12, weight: .medium)).foregroundStyle(colors.ink2)
                    }.tabular()
                    if !displayFigure.provenance.lowercased().contains("scheduled"), !displayFigure.provenance.isEmpty {
                        TrainLabel(text: displayFigure.provenance, color: (late || journey.cancelled) ? colors.warning : colors.ink3)
                    }
                }.frame(width: 104, alignment: .leading)
                HStack(alignment: .top, spacing: 8) {
                    endpoint(first.from.shortName, clockTime(journey.effectiveDeparture), arrival: false)
                    endpoint(journey.legs.last?.to.shortName ?? "", clockTime(journey.effectiveArrival), arrival: true)
                }
            }.padding(.horizontal, pagePadding).padding(.vertical, 10)

            JourneyAxis(journey: journey, large: true, showCap: !departed,
                        progress: departed && !complete ? (model.state.now - journey.effectiveDeparture) / max(1, journey.effectiveArrival - journey.effectiveDeparture) : nil, tinyTrain: true)
                .padding(.horizontal, pagePadding)

            Group {
                if cancelledLeadTime != nil {
                    TrainLabel(text: instruction, color: colors.warning, size: 11, lines: 2)
                } else {
                    Text(instruction).font(.system(size: 15, weight: departed ? .regular : .light))
                        .foregroundStyle(departed ? colors.ink : colors.ink2).lineLimit(2)
                }
            }.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, pagePadding).padding(.vertical, 8)

            if let receipt = model.state.receipt, !receipt.isEmpty {
                Text(receipt).font(.system(size: 15, weight: .light)).foregroundStyle(colors.ink2)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, pagePadding).padding(.vertical, 4)
            }
            if complete && focused {
                HStack(spacing: 20) {
                    TrainLabel(text: "Need to get back?")
                    Button("Show the way back", action: model.showReturn).buttonStyle(TrainTextButtonStyle(colors: colors))
                }.frame(maxWidth: .infinity, minHeight: 50, alignment: .leading).padding(.horizontal, pagePadding)
            }
            if !departed, let next = nextJourney {
                TrainRule().padding(.horizontal, pagePadding)
                Button { model.openJourney(next.journey) } label: {
                    HStack(spacing: 8) {
                        TrainLabel(text: "Next \(serviceModeName(next.journey.mode))", size: 9).frame(width: 96, alignment: .leading)
                        Text(nextServiceFigure(next.journey, board: next.board, now: model.state.now)).font(.system(size: 17, weight: .light)).foregroundStyle(colors.ink).tabular()
                        Spacer()
                        Text("\(clockTime(next.journey.effectiveDeparture)) → \(clockTime(next.journey.effectiveArrival))")
                            .font(.system(size: 15, weight: .light)).foregroundStyle(colors.ink3).tabular()
                        Image(systemName: "chevron.right").foregroundStyle(colors.ink3)
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).padding(.horizontal, pagePadding).accessibilityIdentifier("next-service")
            }
            TrainRule(heavy: true)
            if let focus, !focus.pinned {
                HStack {
                    Text("Going somewhere else?").font(.system(size: 15, weight: .light)).foregroundStyle(colors.ink2)
                    Spacer(); Button("Change", action: model.newTrip).buttonStyle(TrainTextButtonStyle(colors: colors))
                }.padding(.horizontal, pagePadding).frame(minHeight: 48)
                TrainRule()
            }
        }
    }

    private var status: String {
        if cancelledLeadTime != nil && focus != nil { return "Cancelled" }
        if focused, let focus { return focusStatus(focus, now: model.state.now, complete: complete) }
        if let retained = retainedHeaderStatus(board: board, journey: journey, hasFocus: focus != nil, now: model.state.now) {
            return retained
        }
        if let distance = model.state.distanceMetres, distance <= 200 { return "At \(first.from.shortName)" }
        if let distance = model.state.distanceMetres { return "\(distanceText(distance)) to \(first.from.shortName)" }
        return "Next \(genericModeName(first.mode))"
    }

    private var displayFigure: Figure {
        if departed && !complete {
            return directionFigureFor(journey, now: model.state.now) ?? figureFor(journey, board: board, now: model.state.now)
        }
        return figureFor(journey, board: board, now: model.state.now)
    }

    private var instruction: String {
        if let cancelledLeadTime { return "\(clockTime(cancelledLeadTime)) cancelled · next \(genericModeName(first.mode))" }
        if complete { return "The journey has finished" }
        if departed { return focusedInstruction(journey, now: model.state.now) }
        return first.headsign.isEmpty ? first.to.shortName : first.headsign
    }

    private var nextJourney: (journey: Journey, board: BoardData)? {
        let source = alternatives ?? board
        return source.journeys.first { candidate in
            journeyAllowed(candidate, modes: model.state.enabledModes) && !candidate.cancelled
                && candidate.effectiveDeparture > journey.effectiveDeparture &&
            !(candidate.departure == journey.departure && candidate.legs.first?.line == journey.legs.first?.line)
        }.map { (journey: $0, board: source) }
    }

    private func endpoint(_ station: String, _ time: String, arrival: Bool) -> some View {
        VStack(alignment: arrival ? .trailing : .leading, spacing: arrival ? 7 : 3) {
            Text(station).font(.system(size: 16, weight: .light)).foregroundStyle(arrival ? colors.ink2 : colors.ink)
                .lineLimit(2).minimumScaleFactor(0.72)
            Text(time).font(.system(size: arrival ? 20 : 25, weight: arrival ? .light : .regular))
                .foregroundStyle(arrival ? colors.ink2 : (late ? colors.warning : colors.ink)).tabular()
        }.frame(maxWidth: .infinity, alignment: arrival ? .trailing : .leading)
    }
}

func retainedHeaderStatus(board: BoardData, journey: Journey, hasFocus: Bool, now: Millis) -> String? {
    !hasFocus && board.offline && journey.retained == true && journey.effectiveDeparture < now ? "Last shown" : nil
}

private struct SavedTripRow: View {
    let trip: SavedTrip
    let state: AppState
    @ObservedObject var model: TrainViewModel
    @Environment(\.trainColors) private var colors

    var body: some View {
        VStack(spacing: 0) {
        Button { model.openTrip(id: trip.id) } label: {
            HStack(spacing: 13) {
                HStack(spacing: 3) {
                    ForEach(Array(lines.prefix(3)), id: \.self) { code in
                        Rectangle().fill(lineColor(code, mode: code.hasPrefix("F") ? "ferry" : "train", colors: colors, fill: true)).frame(width: 3)
                    }
                }.frame(width: 15, height: 52)
                VStack(spacing: 6) {
                    HStack(spacing: 6) {
                        if let first = lines.first {
                            LineChip(line: first, mode: first.hasPrefix("F") ? "ferry" : "train", height: 20, horizontalPadding: 5)
                        }
                        Text(trip.from.shortName).lineLimit(2)
                        Text("→").foregroundStyle(colors.ink3)
                        if lines.count > 1, let last = lines.last {
                            LineChip(line: last, mode: last.hasPrefix("F") ? "ferry" : "train", height: 20, horizontalPadding: 5)
                        }
                        Text(trip.to.shortName).lineLimit(2)
                    }.font(.system(size: 19, weight: .light)).foregroundStyle(colors.ink).frame(maxWidth: .infinity, alignment: .leading)
                    HStack(spacing: 8) {
                        if justAdded {
                            (Text("Just added").font(.system(size: 12)).italic()
                             + Text(justAddedDistance.isEmpty ? "" : " · \(justAddedDistance.uppercased())")
                                .font(.system(size: 10, weight: .semibold)).tracking(1.4))
                                .foregroundStyle(colors.ink3).lineLimit(2)
                        } else {
                            TrainLabel(text: summary, color: highlighted ? colors.ink2 : colors.ink3, lines: 2)
                        }
                        Spacer(); TrainLabel(text: "Departures", color: colors.ink2); Image(systemName: "chevron.right").font(.system(size: 13)).foregroundStyle(colors.ink3)
                    }
                }
            }.padding(.vertical, 10).frame(maxWidth: .infinity, minHeight: 72).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu { Button("Delete trip", role: .destructive) { model.deleteTrip(id: trip.id) } }
        .accessibilityLabel("\(trip.from.shortName) to \(trip.to.shortName), \(summary)")
        .accessibilityIdentifier("trip-\(trip.id)")
        TrainRule()
        }
        .padding(.horizontal, pagePadding)
        .swipeActions(edge: .trailing, allowsFullSwipe: true) {
            Button("Delete", role: .destructive) { model.deleteTrip(id: trip.id) }
        }
    }

    private var lines: [String] { trip.lines }
    private var highlighted: Bool { state.focus?.tripId == trip.id || state.selectedTripId == trip.id }
    private var justAdded: Bool {
        state.justAddedTripId == trip.id && state.selectedTripId == trip.id
            && state.selectionPredicted && state.focus == nil
    }
    private var justAddedDistance: String {
        (state.tripMetadata[trip.id] ?? "").components(separatedBy: " · ").first { $0.hasSuffix(" away") } ?? ""
    }
    private var summary: String {
        if justAdded { return ["Just added", justAddedDistance].filter { !$0.isEmpty }.joined(separator: " · ") }
        let status = state.focus.flatMap { focus in
            focus.tripId == trip.id
                ? savedTripFocusStatus(focus, now: state.now, complete: state.focusComplete)
                : nil
        } ?? (state.selectedTripId == trip.id ? "Shown above" : "")
        return [status, state.tripMetadata[trip.id] ?? ""].filter { !$0.isEmpty }.joined(separator: " · ").isEmpty
            ? "Saved trip" : [status, state.tripMetadata[trip.id] ?? ""].filter { !$0.isEmpty }.joined(separator: " · ")
    }
}

func savedTripFocusStatus(_ focus: FocusedJourney, now: Millis, complete: Bool) -> String {
    let status = focusStatus(focus, now: now, complete: complete)
    return focus.pinned && status != "Pinned" ? "\(status) · Pinned" : status
}

func focusStatus(_ focus: FocusedJourney, now: Millis, complete: Bool) -> String {
    if complete || now >= focus.journey.effectiveArrival { return "Trip over" }
    if focus.journey.cancelled { return "Cancelled" }
    if focusJourneyIsLate(focus.journey, board: focus.board, now: now) { return "Running late" }
    if focus.pinned, now < focus.journey.effectiveDeparture { return "Pinned" }
    return "Running"
}

func focusJourneyIsLate(_ journey: Journey, board: BoardData, now: Millis) -> Bool {
    guard board.source == "live", !board.offline, journey.retained != true,
          (0...90_000).contains(now - board.generatedAt) else { return false }
    let leg = journey.legs.first { now < $0.effectiveArrival } ?? journey.legs.last
    guard let leg, leg.estimatedDeparture != nil else { return false }
    return minutesBetween(leg.departure, leg.effectiveDeparture) > 0
}

private struct HomeFooter: View {
    @ObservedObject var model: TrainViewModel
    @Environment(\.trainColors) private var colors
    var body: some View {
        VStack(spacing: 0) {
            TrainRule(heavy: true)
            HStack(spacing: 0) {
                footerButton("plus", "New trip", "new-trip", model.newTrip)
                footerButton("gearshape", "Settings", "settings", model.openSettings)
            }.padding(.horizontal, pagePadding)
        }
    }
    private func footerButton(_ icon: String, _ label: String, _ id: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 9) { Image(systemName: icon).font(.system(size: 20, weight: .light)); TrainLabel(text: label, color: colors.ink, size: 12) }
                .frame(maxWidth: .infinity, minHeight: 56, alignment: id == "new-trip" ? .leading : .trailing).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier(id)
    }
}

struct TrainTextButtonStyle: ButtonStyle {
    let colors: TrainColors
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11, weight: .semibold))
            .tracking(1.76)
            .textCase(.uppercase)
            .foregroundStyle(colors.ink)
            .opacity(configuration.isPressed ? 0.6 : 1).frame(minHeight: 44)
    }
}

func genericModeName(_ mode: String) -> String { mode == "ferry" ? "ferry" : "train" }
func serviceModeName(_ mode: String) -> String { allModes.contains(mode) ? mode : "service" }
func nextServiceFigure(_ journey: Journey, board: BoardData, now: Millis) -> String {
    let figure = figureFor(journey, board: board, now: now)
    guard !figure.value.isEmpty else { return "" }
    return figure.unit == "min" ? "\(figure.value) min" : figure.value + figure.unit
}
func distanceText(_ metres: Int) -> String {
    if metres < 1_000 { return "\(max(10, Int((Double(metres) / 10).rounded()) * 10)) m" }
    if metres < 10_000 { return String(format: "%.1f km", Double(metres) / 1_000) }
    return "\(Int((Double(metres) / 1_000).rounded())) km"
}
private func focusedInstruction(_ journey: Journey, now: Millis) -> String {
    for (before, after) in zip(journey.legs, journey.legs.dropFirst()) {
        if now < before.effectiveArrival {
            let wait = minutesBetween(before.effectiveArrival, after.effectiveDeparture)
            return wait < 5 ? "Tight change · \(wait) min\(placeClause(before.toPlatform, mode: before.mode))"
                : "Get off at \(before.to.shortName)\(placeClause(before.toPlatform, mode: before.mode))"
        }
        if now < after.effectiveDeparture {
            let wait = max(0, minutesBetween(now, after.effectiveDeparture))
            return wait < 5 ? "Tight change · \(wait) min\(placeClause(after.fromPlatform, mode: after.mode))"
                : "Change at \(after.from.shortName)\(placeClause(after.fromPlatform, mode: after.mode))"
        }
    }
    return "Stay on to \(journey.legs.last?.to.shortName ?? "destination")"
}
private func placeClause(_ raw: String?, mode: String) -> String {
    platformText(raw, mode: mode, full: true).map { " · \($0)" } ?? ""
}
