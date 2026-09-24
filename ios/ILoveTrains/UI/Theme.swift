import SwiftUI

let pagePadding: CGFloat = 22

private struct TrainColorsKey: EnvironmentKey {
    static let defaultValue = TrainColors.darkPalette
}

extension EnvironmentValues {
    var trainColors: TrainColors {
        get { self[TrainColorsKey.self] }
        set { self[TrainColorsKey.self] = newValue }
    }
}

struct TrainTheme<Content: View>: View {
    let appearance: Appearance
    @ViewBuilder var content: () -> Content
    @Environment(\.colorScheme) private var systemScheme

    private var usesDark: Bool {
        switch appearance {
        case .system: systemScheme == .dark
        case .dark: true
        case .light: false
        }
    }

    var body: some View {
        let palette = usesDark ? TrainColors.darkPalette : TrainColors.lightPalette
        content()
            .environment(\.trainColors, palette)
            .foregroundStyle(palette.ink)
            .background(palette.ground)
            .preferredColorScheme(appearance == .system ? nil : (usesDark ? .dark : .light))
    }
}
