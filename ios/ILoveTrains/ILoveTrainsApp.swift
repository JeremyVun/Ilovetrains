import SwiftUI

@main
struct ILoveTrainsApp: App {
    @StateObject private var model = TrainViewModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            TrainAppView(model: model)
                .preferredColorScheme(model.state.appearance == .system ? nil : model.state.appearance == .dark ? .dark : .light)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { model.resume() } else if phase == .background { model.pause() }
                }
                .onAppear { if scenePhase == .active { model.resume() } }
                .onOpenURL { model.openTracker($0) }
        }
    }
}
