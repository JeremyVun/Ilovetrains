import SwiftUI

/// The web's page margin (ui.md): narrow phones give the type more room instead of smaller type.
func pageMargin(windowWidth: CGFloat) -> CGFloat { windowWidth <= 375 ? 18 : 22 }

private struct TrainColorsKey: EnvironmentKey {
    static let defaultValue = TrainColors.darkPalette
}

private struct PageMarginKey: EnvironmentKey {
    static let defaultValue: CGFloat = 22
}

extension EnvironmentValues {
    var trainColors: TrainColors {
        get { self[TrainColorsKey.self] }
        set { self[TrainColorsKey.self] = newValue }
    }

    var pageMargin: CGFloat {
        get { self[PageMarginKey.self] }
        set { self[PageMarginKey.self] = newValue }
    }
}

private struct PagePadding: ViewModifier {
    let edges: Edge.Set
    @Environment(\.pageMargin) private var margin

    func body(content: Content) -> some View { content.padding(edges, margin) }
}

extension View {
    func pagePadding(_ edges: Edge.Set = .horizontal) -> some View { modifier(PagePadding(edges: edges)) }
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
