import SwiftUI

let pagePadding: CGFloat = 22

struct TrainColors {
    let ground: Color
    let ink: Color
    let ink2: Color
    let ink3: Color
    let rule: Color
    let rule2: Color
    let warning: Color
    let live: Color
    let dark: Bool

    static let darkPalette = TrainColors(
        ground: Color(hex: 0x0A0B0D), ink: Color(hex: 0xF4F5F7),
        ink2: Color(hex: 0xF4F5F7).opacity(0.66), ink3: Color(hex: 0xF4F5F7).opacity(0.46),
        rule: Color(hex: 0xF4F5F7).opacity(0.10), rule2: Color(hex: 0xF4F5F7).opacity(0.20),
        warning: Color(hex: 0xFF7A5C), live: Color(hex: 0x4ADE80), dark: true
    )

    static let lightPalette = TrainColors(
        ground: Color(hex: 0xFAF9F5), ink: Color(hex: 0x14120E),
        ink2: Color(hex: 0x4E4C48), ink3: Color(hex: 0x706E6A),
        rule: Color(hex: 0x14120E).opacity(0.11), rule2: Color(hex: 0x14120E).opacity(0.25),
        warning: Color(hex: 0xBF3418), live: Color(hex: 0x0F7A4A), dark: false
    )
}

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

private let darkLineColors: [String: UInt] = [
    "T1": 0xF99D1C, "T2": 0x0098CD, "T3": 0xF37021, "T4": 0x005AA3,
    "T5": 0xC4258F, "T7": 0x6F818E, "T8": 0x00954C, "T9": 0xD11F2F,
    "M1": 0x168388, "BMT": 0xF99D1C, "CCN": 0xD11F2F, "SCO": 0x0098CD,
    "SHL": 0x00954C, "HUN": 0x833134, "FERRY": 0x5AB031,
]

private let lightLineColors: [String: UInt] = [
    "T1": 0xA46204, "T2": 0x0079A3, "T3": 0xBD4D0A, "T4": 0x005AA3,
    "T5": 0xC4258F, "T7": 0x62727E, "T8": 0x008041, "T9": 0xD11F2F,
    "M1": 0x157B7F, "BMT": 0xA46204, "CCN": 0xD11F2F, "SCO": 0x0079A3,
    "SHL": 0x008041, "HUN": 0x833134, "FERRY": 0x428024,
]

func lineColor(_ line: String, mode: String, colors: TrainColors, fill: Bool = false) -> Color {
    let key = mode.lowercased() == "ferry" ? "FERRY" : line.uppercased()
    if !colors.dark, fill, key == "T1" || key == "BMT" { return Color(hex: 0xF99D1C) }
    return Color(hex: (colors.dark ? darkLineColors : lightLineColors)[key] ?? 0x6F818E)
}

func chipInk(_ line: String, mode: String, colors: TrainColors) -> Color {
    guard colors.dark else { return colors.ground }
    let key = mode.lowercased() == "ferry" ? "FERRY" : line.uppercased()
    return ["T4", "T5", "T9", "CCN", "HUN"].contains(key) ? colors.ink : colors.ground
}

extension Color {
    init(hex: UInt) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255
        )
    }
}
