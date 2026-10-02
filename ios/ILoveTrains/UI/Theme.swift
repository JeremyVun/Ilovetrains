import SwiftUI

/// The web's `@media (max-width: 375px)` sizes (ui.md): narrow phones give the type more room.
struct PhoneSizes: Equatable {
    var pageMargin: CGFloat = 22
    var homeFigureColumn: CGFloat = 104
    var homeFigure: CGFloat = 64
    var homeWideFigure: CGFloat = 50
    var homeStationName: CGFloat = 16
    var boardTitle: CGFloat = 25
    var boardTitleGap: CGFloat = 9
    var boardTitleArrow: CGFloat = 44
    var capPadding: CGFloat = 7
    var pinPadding: CGFloat = 5
    var pinMinWidth: CGFloat? = nil
}

extension PhoneSizes {
    static let narrow = PhoneSizes(
        pageMargin: 18, homeFigureColumn: 92, homeFigure: 56, homeWideFigure: 44, homeStationName: 15,
        boardTitle: 24, boardTitleGap: 7, boardTitleArrow: 40, capPadding: 6, pinPadding: 4, pinMinWidth: 17
    )

    init(windowWidth: CGFloat) { self = windowWidth <= 375 ? .narrow : PhoneSizes() }
}

private struct TrainColorsKey: EnvironmentKey {
    static let defaultValue = TrainColors.darkPalette
}

private struct PhoneSizesKey: EnvironmentKey {
    static let defaultValue = PhoneSizes()
}

extension EnvironmentValues {
    var trainColors: TrainColors {
        get { self[TrainColorsKey.self] }
        set { self[TrainColorsKey.self] = newValue }
    }

    var phoneSizes: PhoneSizes {
        get { self[PhoneSizesKey.self] }
        set { self[PhoneSizesKey.self] = newValue }
    }
}

private struct PagePadding: ViewModifier {
    let edges: Edge.Set
    @Environment(\.phoneSizes) private var sizes

    func body(content: Content) -> some View { content.padding(edges, sizes.pageMargin) }
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
