import SwiftUI

enum SettingsLocationAction: Equatable {
    case turnOn, allow, openSettings, turnOff
}

struct SettingsLocationPresentation: Equatable {
    let subtitle: String
    let mark: String
    let action: SettingsLocationAction
    let warning: Bool
    let selected: Bool?

    init(useLocation: Bool, granted: Bool, denied: Bool) {
        if !useLocation {
            subtitle = "Location is not used"; mark = "TURN ON"; action = .turnOn; warning = false; selected = false
        } else if denied {
            subtitle = "Location is blocked"; mark = "OPEN SETTINGS ›"; action = .openSettings; warning = true; selected = nil
        } else if !granted {
            subtitle = "Location needs permission"; mark = "ALLOW"; action = .allow; warning = false; selected = nil
        } else {
            subtitle = "Nearby trips use location"; mark = "TURN OFF"; action = .turnOff; warning = false; selected = true
        }
    }
}

struct SettingsTransferLimitPresentation: Equatable {
    let subtitle: String
    let mark: String
    let next: TransferLimit

    init(limit: TransferLimit) {
        switch limit {
        case .two: subtitle = "Up to 2"; mark = "NO LIMIT"; next = .any
        case .any: subtitle = "No limit"; mark = "UP TO 2"; next = .two
        }
    }
}

struct SettingsView: View {
    @ObservedObject var model: TrainViewModel
    @State private var page: Page = .main
    @State private var homeQuery = ""
    private enum Page { case main, feedback }

    var body: some View {
        if model.state.selectingHome { homePicker }
        else if page == .feedback { feedback }
        else { main }
    }

    private var main: some View {
        SettingsShell(title: "Settings", backLabel: "Home", onBack: model.back) {
            SettingsMain(model: model) { page = .feedback }
        }
    }

    private var homePicker: some View {
        SettingsShell(title: "Home station", backLabel: "Settings", onBack: model.back,
                      rail: model.state.homeIsManual ? AnyView(ActionRail(text: "Use automatic home") { model.setHome(nil) }) : nil) {
            HomePickerContent(model: model, query: $homeQuery)
        }
    }

    private var feedback: some View {
        SettingsShell(title: "Send feedback", backLabel: "Settings", onBack: { page = .main },
                      rail: AnyView(ActionRail(text: model.state.feedbackSubmitting ? "Sending…" : "Send feedback",
                                              enabled: !model.feedbackDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.state.feedbackSubmitting) {
            model.feedback(text: model.feedbackDraft.trimmingCharacters(in: .whitespacesAndNewlines), category: model.feedbackCategory)
        })) {
            FeedbackContent(category: $model.feedbackCategory, message: $model.feedbackDraft)
        }
        .onChange(of: model.state.feedbackSucceeded) { _, succeeded in if succeeded { model.feedbackDraft = "" } }
    }
}

private struct SettingsShell<Content: View>: View {
    let title: String
    let backLabel: String
    let onBack: () -> Void
    var rail: AnyView? = nil
    @ViewBuilder let content: () -> Content
    @Environment(\.trainColors) private var colors

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 0) {
                BackControl(label: backLabel, action: onBack)
                Text(title).font(.system(size: 29, weight: .light)).padding(.top, 4).padding(.bottom, 12)
                TrainRule(heavy: true)
            }.padding(.horizontal, pagePadding)
            ScrollView { VStack(spacing: 0) { content() }.padding(.horizontal, pagePadding) }
                .scrollIndicators(.hidden)
            if let rail { rail }
        }
    }
}

private struct SettingsMain: View {
    @ObservedObject var model: TrainViewModel
    let showFeedback: () -> Void
    @Environment(\.trainColors) private var colors

    var body: some View {
        settingsSection("Personal")
        personalRow(icon: "location", title: "Use location", value: locationPresentation.subtitle,
                    state: locationPresentation.mark, id: "location-setting", warning: locationPresentation.warning,
                    markColor: colors.ink, selected: locationPresentation.selected) {
            switch locationPresentation.action {
            case .turnOn: model.setUseLocation(true)
            case .allow, .openSettings: model.requestLocation()
            case .turnOff: model.setUseLocation(false)
            }
        }
        personalRow(icon: "house", title: "Home", value: homeValue,
                    state: model.state.homeIsManual ? "Change  ›" : "Set  ›", id: "home-setting", action: model.chooseHome)

        Spacer().frame(height: 22); settingsSection("Services")
        HStack(spacing: 0) {
            serviceChoice("train", "Trains", icon: "tram.fill")
            serviceChoice("metro", "Metro", icon: "m.circle")
            serviceChoice("ferry", "Ferries", icon: "ferry.fill")
            serviceChoice("bus", "Buses", icon: "bus", available: false)
        }
        TrainRule()
        TrainLabel(text: model.state.enabledModes.isEmpty ? "No services selected. Turn one on to see trips." : "Trips use chosen services only.",
                   color: model.state.enabledModes.isEmpty ? colors.warning : colors.ink3, lines: 3)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 8)
        if model.state.transferLimitOffered {
            personalRow(title: "Transfer limit", value: transferLimitPresentation.subtitle,
                        state: transferLimitPresentation.mark, id: "transfer-limit-setting", markColor: colors.ink) {
                model.setTransferLimit(transferLimitPresentation.next)
            }
        }

        Spacer().frame(height: 22); settingsSection("Appearance")
        HStack(spacing: 0) {
            ForEach([Appearance.system, .light, .dark], id: \.self) { appearanceChoice($0) }
        }
        TrainRule()

        Spacer().frame(height: 22); TrainRule()
        secondaryRow("Send feedback", value: "›", id: "send-feedback", action: showFeedback)
        secondaryRow("Offline timetable", value: model.state.timetableStatus, id: "update-timetable",
                     enabled: !model.state.timetableUpdating, action: model.updateTimetable)
        secondaryRow("Version \(model.state.version)", value: "", id: "version")
        Spacer().frame(height: 18)
    }

    private var locationPresentation: SettingsLocationPresentation {
        SettingsLocationPresentation(useLocation: model.state.useLocation,
                                     granted: model.state.locationGranted,
                                     denied: model.state.locationDenied)
    }
    private var transferLimitPresentation: SettingsTransferLimitPresentation {
        SettingsTransferLimitPresentation(limit: model.state.transferLimit)
    }
    private var homeValue: String {
        guard let home = model.state.home else { return "Automatic" }
        return model.state.homeIsManual ? home.shortName : "Automatic — \(home.shortName)"
    }
    private func settingsSection(_ text: String) -> some View {
        VStack(spacing: 7) { TrainLabel(text: text).frame(maxWidth: .infinity, alignment: .leading); TrainRule() }.padding(.top, 14)
    }
    private func personalRow(icon: String? = nil, title: String, value: String, state: String, id: String,
                             warning: Bool = false, markColor: Color? = nil, selected: Bool? = nil,
                             action: @escaping () -> Void) -> some View {
        VStack(spacing: 0) {
            Button(action: action) {
                HStack(spacing: 12) {
                    if let icon { Image(systemName: icon).font(.system(size: 23, weight: .light)).foregroundStyle(colors.ink2).frame(width: 28) }
                    VStack(alignment: .leading, spacing: 4) {
                        Text(title).font(.system(size: 17, weight: .regular)).foregroundStyle(colors.ink)
                        Text(value).font(.system(size: 12, weight: .light)).foregroundStyle(warning ? colors.warning : colors.ink2)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    TrainLabel(text: state, color: markColor ?? colors.ink2)
                        .fixedSize(horizontal: true, vertical: false)
                        .layoutPriority(1)
                }.padding(.vertical, 10).frame(minHeight: 72).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(title), \(value), \(state)")
            .accessibilityValue(selected.map { $0 ? "On" : "Off" } ?? "")
            .accessibilityIdentifier(id)
            .accessibilityAddTraits(selected == nil ? .isButton : .isToggle)
            .accessibilityAddTraits(selected == true ? .isSelected : [])
            TrainRule()
        }
    }
    private func serviceChoice(_ mode: String, _ label: String, icon: String, available: Bool = true) -> some View {
        let enabled = model.state.enabledModes.contains(mode)
        return Button { if available { model.setMode(mode: mode, enabled: !enabled) } } label: {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 25)).frame(height: 27)
                TrainLabel(text: label, color: available ? colors.ink : colors.ink3, size: 12)
                TrainLabel(text: enabled ? "On" : "Off", color: enabled ? colors.ink : colors.ink3, size: 9)
            }.foregroundStyle(enabled && available ? colors.ink : colors.ink3).frame(maxWidth: .infinity, minHeight: 86)
                .overlay(alignment: .leading) { if mode != "train" { Rectangle().fill(colors.rule).frame(width: 1) } }
        }.buttonStyle(.plain).disabled(!available).accessibilityIdentifier("service-\(mode)").accessibilityAddTraits(enabled ? .isSelected : [])
    }
    private func appearanceChoice(_ appearance: Appearance) -> some View {
        let selected = model.state.appearance == appearance
        return Button { model.setAppearance(appearance) } label: {
            VStack(spacing: 7) {
                AppearancePreview(appearance: appearance)
                TrainLabel(text: appearance.rawValue, color: selected ? colors.ink : colors.ink2, size: 12)
                if appearance == .system { TrainLabel(text: "Follow device", color: selected ? colors.ink : colors.ink3, size: 9) }
                else { Spacer().frame(height: 11) }
            }.frame(maxWidth: .infinity, minHeight: 86)
                .overlay(alignment: .leading) { if appearance != .system { Rectangle().fill(colors.rule).frame(width: 1) } }
                .overlay(alignment: .topTrailing) { if selected { Image(systemName: "checkmark").font(.system(size: 12)).padding(8) } }
        }.buttonStyle(.plain).accessibilityIdentifier("appearance-\(appearance.rawValue)").accessibilityAddTraits(selected ? .isSelected : [])
    }
    private func secondaryRow(_ title: String, value: String, id: String, enabled: Bool = true, action: (() -> Void)? = nil) -> some View {
        VStack(spacing: 0) {
            Button { action?() } label: {
                HStack {
                    Text(title).font(.system(size: 14, weight: .light)).foregroundStyle(colors.ink2)
                    Spacer(); Text(value).font(.system(size: 11, weight: .light)).foregroundStyle(colors.ink3).multilineTextAlignment(.trailing).lineLimit(2)
                }.frame(minHeight: 52).contentShape(Rectangle())
            }.buttonStyle(.plain).disabled(action == nil || !enabled).accessibilityIdentifier(id)
            TrainRule()
        }
    }
}

private struct AppearancePreview: View {
    let appearance: Appearance
    @Environment(\.trainColors) private var colors
    var body: some View {
        HStack(spacing: 0) {
            ForEach(appearance == .system ? [false, true] : [appearance == .dark], id: \.self) { dark in
                ZStack {
                    (dark ? TrainColors.darkPalette.ground : TrainColors.lightPalette.ground)
                    VStack(spacing: 5) {
                        Rectangle().fill(dark ? TrainColors.darkPalette.ink : TrainColors.lightPalette.ink).frame(height: 2)
                        Rectangle().fill(dark ? TrainColors.darkPalette.ink : TrainColors.lightPalette.ink).frame(height: 2)
                    }.padding(.horizontal, 5)
                }
            }
        }.frame(width: 39, height: 25).overlay(Rectangle().stroke(colors.rule2, lineWidth: 1))
    }
}

private struct HomePickerContent: View {
    @ObservedObject var model: TrainViewModel
    @Binding var query: String
    @Environment(\.trainColors) private var colors
    private var results: [Station] {
        guard query.count >= 2 else { return [] }
        return model.state.stations.map { ($0, fuzzyScore($0.name, query)) }.filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }.prefix(8).map(\.0)
    }
    var body: some View {
        TrainLabel(text: "Home station").frame(maxWidth: .infinity, alignment: .leading).padding(.top, 16)
        TextField("Station name", text: $query).font(.system(size: 20)).frame(minHeight: 52).accessibilityIdentifier("home-station-search")
        TrainRule()
        if query.count == 1 { Text("Type at least two letters.").font(.system(size: 14)).foregroundStyle(colors.ink2).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 14) }
        if query.count >= 2 && results.isEmpty { Text("No matching stations.").font(.system(size: 14)).foregroundStyle(colors.warning).frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 14) }
        if !results.isEmpty { TrainLabel(text: "Matches").frame(maxWidth: .infinity, alignment: .leading).padding(.top, 18).padding(.bottom, 4) }
        ForEach(results) { station in
            Button { model.setHome(station) } label: {
                HStack { Text(station.shortName).font(.system(size: 18, weight: .light)); Spacer(); TrainLabel(text: station.modes.sorted().joined(separator: " · ")) }
                    .frame(minHeight: 64).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("home-station-\(station.id)")
            TrainRule()
        }
    }
}

private struct FeedbackContent: View {
    @Binding var category: String
    @Binding var message: String
    @Environment(\.trainColors) private var colors
    @FocusState private var focused: Bool
    var body: some View {
        TrainLabel(text: "Category").frame(maxWidth: .infinity, alignment: .leading).padding(.top, 14).padding(.bottom, 7); TrainRule()
        HStack(spacing: 0) {
            ForEach(["problem", "suggestion", "other"], id: \.self) { value in
                Button { category = value } label: {
                    VStack(spacing: 4) { TrainLabel(text: value, color: category == value ? colors.ink : colors.ink3); TrainLabel(text: category == value ? "●" : "○", color: category == value ? colors.ink : colors.ink3) }
                        .frame(maxWidth: .infinity, minHeight: 56)
                }.buttonStyle(.plain).accessibilityIdentifier("feedback-\(value)").accessibilityAddTraits(category == value ? .isSelected : [])
            }
        }; TrainRule()
        TrainLabel(text: "Message", color: focused ? colors.ink : colors.ink3).frame(maxWidth: .infinity, alignment: .leading).padding(.top, 16)
        ZStack(alignment: .topLeading) {
            if message.isEmpty { Text("What happened?").font(.system(size: 18)).foregroundStyle(colors.ink3).padding(.top, 9) }
            TextEditor(text: $message).scrollContentBackground(.hidden).font(.system(size: 18, weight: .light)).foregroundStyle(colors.ink)
                .focused($focused).padding(.horizontal, -5).accessibilityIdentifier("feedback-message")
        }.frame(minHeight: 150)
        TrainRule(heavy: focused)
        Text("Don’t include personal details.").font(.system(size: 14, weight: .light)).foregroundStyle(colors.ink2)
            .frame(maxWidth: .infinity, alignment: .leading).padding(.vertical, 14)
    }
}
