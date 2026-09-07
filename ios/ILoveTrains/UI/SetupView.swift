import SwiftUI

struct SetupView: View {
    @ObservedObject var model: TrainViewModel
    @Environment(\.trainColors) private var colors
    @State private var query = ""
    @FocusState private var focusedField: Field?
    private enum Field { case from, to }

    private var from: Station? { model.state.setupFrom }
    private var to: Station? { model.state.setupTo }
    private var selectingFrom: Bool { from == nil }
    private var selectingTo: Bool { from != nil && to == nil }
    private var recent: [Station] { selectingFrom ? model.state.recentFrom : model.state.recentTo }
    private var matches: [Station] {
        guard query.count >= 3 else { return [] }
        return model.state.stations.filter { $0.id != from?.id && !$0.modes.isDisjoint(with: model.state.enabledModes) }
            .map { ($0, fuzzyScore($0.name, query)) }.filter { $0.1 > 0 }
            .sorted { $0.1 > $1.1 }.prefix(8).map(\.0)
    }

    var body: some View {
        VStack(spacing: 0) {
            if !model.state.trips.isEmpty {
                BackControl(label: "Home", action: model.back).frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, pagePadding)
            }
            VStack(alignment: .leading, spacing: 0) {
                Text("New trip").font(.system(size: 29, weight: .light)).padding(.top, model.state.trips.isEmpty ? 10 : 2).padding(.bottom, 12)
                TrainRule(heavy: true)
            }.padding(.horizontal, pagePadding)
            ScrollView {
                LazyVStack(spacing: 0) {
                    setupField(label: "From", station: from, placeholder: "Origin station", field: .from)
                    setupField(label: "To", station: to, placeholder: "Destination station", field: .to)
                    if selectingFrom && query.isEmpty && model.state.useLocation && !model.state.locationGranted && !model.state.locationDenied {
                        sectionLabel("Nearby")
                        resultButton("Use my location", detail: nil, id: "use-location", action: model.requestLocation)
                    }
                    if (selectingFrom || selectingTo) && query.isEmpty && !recent.isEmpty {
                        sectionLabel("You searched before")
                        ForEach(Array(recent.filter { $0.id != from?.id && !$0.modes.isDisjoint(with: model.state.enabledModes) }.prefix(6))) { station in stationResult(station) }
                    } else if (selectingFrom || selectingTo) && (1...2).contains(query.count) {
                        TrainLabel(text: "Type at least three letters").frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16)
                    } else if (selectingFrom || selectingTo) && query.count >= 3 && matches.isEmpty {
                        TrainLabel(text: query.count <= 4 ? "No match yet · keep typing" : "No stations match", color: colors.warning)
                            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 16)
                    } else if !matches.isEmpty {
                        sectionLabel("Matches")
                        ForEach(matches) { station in stationResult(station) }
                    }
                }.padding(.horizontal, pagePadding)
            }.scrollIndicators(.hidden)
            if let from, let to {
                ActionRail(text: "Save trip") { model.saveTrip(from: from, to: to) }
            } else if selectingTo && query.isEmpty {
                ActionRail(text: "Choose where you’re going", enabled: false) { }
            } else if selectingFrom && query.isEmpty {
                ActionRail(text: "Choose where you’re leaving from", enabled: false) { }
            }
        }
        .onAppear { focusedField = selectingFrom ? .from : .to }
        .onChange(of: from?.id) { _, _ in query = ""; focusedField = selectingFrom ? .from : .to }
        .onChange(of: to?.id) { _, _ in query = "" }
    }

    private func setupField(label: String, station: Station?, placeholder: String, field: Field) -> some View {
        let active = field == .from ? selectingFrom : selectingTo
        return VStack(alignment: .leading, spacing: 6) {
            TrainLabel(text: label)
            if active {
                TextField(placeholder, text: $query)
                    .textInputAutocapitalization(.words).autocorrectionDisabled()
                    .submitLabel(.search).focused($focusedField, equals: field)
                    .font(.system(size: 20, weight: .regular)).foregroundStyle(colors.ink).tint(colors.ink)
                    .frame(minHeight: 44)
                    .onSubmit {
                        if let first = matches.first { choose(first) }
                    }
                    .accessibilityIdentifier("\(label.lowercased())-station-search")
            } else {
                Button {
                    if field == .from { model.clearSetupFrom() } else { model.clearSetupTo() }
                } label: {
                    Text(station?.shortName ?? placeholder).font(.system(size: 20, weight: station == nil ? .light : .regular))
                        .foregroundStyle(station == nil ? colors.ink3 : colors.ink).frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }.buttonStyle(.plain).accessibilityIdentifier("\(label.lowercased())-station")
            }
            TrainRule()
        }.padding(.top, 15).frame(minHeight: 72)
    }

    private func sectionLabel(_ text: String) -> some View {
        TrainLabel(text: text).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 18).padding(.bottom, 4)
    }
    private func stationResult(_ station: Station) -> some View {
        resultButton(station.shortName, detail: station.modes.sorted().joined(separator: " · "), id: "station-\(station.id)") { choose(station) }
    }
    private func resultButton(_ title: String, detail: String?, id: String, action: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            Button(action: action) {
                HStack {
                    Text(title).font(.system(size: 18, weight: .light)).foregroundStyle(colors.ink)
                    Spacer(); if let detail { TrainLabel(text: detail) }
                }.frame(minHeight: 56).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier(id)
            TrainRule()
        }
    }
    private func choose(_ station: Station) {
        if selectingFrom { model.chooseSetupFrom(station) } else { model.chooseSetupTo(station) }
    }
}

func fuzzyScore(_ value: String, _ query: String) -> Int {
    let hay = value.lowercased(), needle = query.lowercased().trimmingCharacters(in: .whitespaces)
    guard !needle.isEmpty else { return 0 }
    if let range = hay.range(of: needle) { return 10_000 - hay.distance(from: hay.startIndex, to: range.lowerBound) * 10 - hay.count }
    var index = hay.startIndex, gaps = 0
    for character in needle {
        guard let next = hay[index...].firstIndex(of: character) else { return 0 }
        gaps += hay.distance(from: index, to: next); index = hay.index(after: next)
    }
    return 1_000 - gaps * 10 - hay.count
}
