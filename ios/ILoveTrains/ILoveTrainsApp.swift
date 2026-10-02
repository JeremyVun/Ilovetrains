import SwiftUI

@main
struct ILoveTrainsApp: App {
    @StateObject private var model: TrainViewModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        #if DEBUG
        if let url = ProcessInfo.processInfo.environment[analyticsURLEnvironmentKey] { Analytics.shared.capture(to: url) }
        #endif
        // A Live Activity button can launch the app with no scene, so the controller cannot wait for the view.
        let model = TrainViewModel()
        _model = StateObject(wrappedValue: model)
        StopTripIntent.handler = { [weak model] session in await model?.stopTrip(session: session) }
    }

    var body: some Scene {
        WindowGroup {
            TrainAppView(model: model)
                .preferredColorScheme(model.state.appearance == .system ? nil : model.state.appearance == .dark ? .dark : .light)
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active {
                        model.resume()
                    } else if phase == .background {
                        model.pause()
                        Analytics.shared.flushInBackground()
                    }
                }
                .onAppear { if scenePhase == .active { model.resume() } }
                .onOpenURL { model.openURL($0) }
        }
    }
}
