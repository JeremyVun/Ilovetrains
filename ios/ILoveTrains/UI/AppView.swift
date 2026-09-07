import SwiftUI

private let feedbackSuccessMessage = "Feedback sent. Thank you."

struct TrainAppView: View {
    @ObservedObject var model: TrainViewModel

    var body: some View {
        TrainTheme(appearance: model.state.appearance) {
            TrainAppContent(model: model)
        }
    }
}

private struct TrainAppContent: View {
    @ObservedObject var model: TrainViewModel
    @Environment(\.trainColors) private var colors

    var body: some View {
        ZStack(alignment: .bottom) {
            Group {
                if !model.state.ready {
                    VStack(alignment: .leading, spacing: 10) {
                        TrainLabel(text: "ilovetrains", color: colors.ink, size: 11)
                        Text(model.state.timetableStatus)
                            .font(.system(size: 16, weight: .light))
                            .foregroundStyle(colors.ink2)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .padding(pagePadding)
                    .accessibilityIdentifier("loading-screen")
                } else {
                    switch model.state.screen {
                    case .home: HomeView(model: model)
                    case .board: BoardView(model: model)
                    case .detail: DetailView(model: model)
                    case .setup:
                        if model.state.selectingHome { SettingsView(model: model) }
                        else { SetupView(model: model) }
                    case .settings: SettingsView(model: model)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            if model.state.ready, let message = model.state.message {
                let undo = model.state.undoAvailable
                Button(action: undo ? model.undoDelete : model.dismissMessage) {
                    HStack(spacing: 12) {
                        Text(message).font(.system(size: 14, weight: .regular)).lineLimit(undo ? 1 : nil)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        TrainLabel(text: undo ? "Undo" : "Dismiss", color: colors.ground)
                    }
                    .foregroundStyle(colors.ground)
                    .padding(.horizontal, pagePadding)
                    .frame(maxWidth: .infinity, minHeight: 52)
                    .background(colors.ink)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(undo ? "message-undo" : "message-dismiss")
                .task(id: message) {
                    guard message == feedbackSuccessMessage else { return }
                    try? await Task.sleep(for: .seconds(4))
                    guard !Task.isCancelled, model.state.message == message else { return }
                    model.dismissMessage()
                }
            }
        }
        .background(colors.ground.ignoresSafeArea())
    }
}
