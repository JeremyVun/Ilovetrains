import SwiftUI

struct TinyTrainFlags: Decodable {
    let tinyTrain: Bool
    private enum CodingKeys: String, CodingKey { case tinyTrain = "tiny_train" }
    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        tinyTrain = (try? values.decode(Bool.self, forKey: .tinyTrain)) ?? false
    }
}

func fetchTinyTrainFlag(session: URLSession = .shared) async -> Bool {
    var request = URLRequest(url: URL(string: "https://ilovetrains.jeremyvun.com/api/v1/flags")!,
                             cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 3)
    request.httpShouldHandleCookies = false
    request.setValue("application/json", forHTTPHeaderField: "Accept")
    request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
    do {
        let (data, response) = try await session.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 65_536 else { return false }
        return try JSONDecoder().decode(TinyTrainFlags.self, from: data).tinyTrain
    } catch { return false }
}

struct TinyTrainLane: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.trainColors) private var colors
    @State private var enabled = false
    @State private var started: Date?
    @State private var runID = 0
    var flagOverride: Bool? = nil
    var onAvailabilityChange: (Bool) -> Void = { _ in }

    private var previewFlag: Bool? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--tiny-train") { return true }
        if arguments.contains("--calibration") || arguments.contains("--offline") { return false }
        #endif
        return nil
    }

    var body: some View {
        ZStack {
            if enabled {
                Button {
                    guard started == nil else { return }
                    started = Date(); runID += 1
                } label: { Color.clear.frame(maxWidth: .infinity, maxHeight: .infinity).contentShape(Rectangle()) }
                    .buttonStyle(.plain).accessibilityLabel("Run a tiny train")
                    .accessibilityIdentifier("tiny-train-trigger")
                    .accessibilityValue(started == nil ? "Ready" : "Running")
                if let started {
                    TimelineView(.animation(paused: reduceMotion)) { timeline in
                        Canvas { context, size in
                            let progress = min(1, max(0, timeline.date.timeIntervalSince(started) / 2.6))
                            let left = reduceMotion ? (size.width - 197) / 2 : -201 + progress * (size.width + 205)
                            context.clip(to: Path(CGRect(x: 0, y: 0, width: size.width, height: 18)))
                            for car in 0..<6 {
                                var carContext = context
                                carContext.translateBy(x: left + CGFloat(car * 33), y: 0)
                                drawCar(&carContext, lead: car == 5)
                            }
                        }
                    }.allowsHitTesting(false).accessibilityHidden(true)
                }
            }
        }
        .frame(height: 44)
        .task(id: scenePhase) {
            enabled = false; started = nil
            guard scenePhase == .active else { return }
            while !Task.isCancelled {
                let value: Bool
                if let override = flagOverride ?? previewFlag { value = override }
                else { value = await fetchTinyTrainFlag() }
                guard !Task.isCancelled else { return }
                enabled = value
                if !value { started = nil }
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
            }
        }
        .task(id: runID) {
            guard started != nil else { return }
            do { try await Task.sleep(for: .milliseconds(reduceMotion ? 650 : 2600)) }
            catch { return }
            started = nil
        }
        .onChange(of: enabled) { _, value in onAvailabilityChange(value) }
        .onChange(of: reduceMotion) { _, _ in started = nil }
        .onDisappear { started = nil; enabled = false; onAvailabilityChange(false) }
    }

    private func drawCar(_ context: inout GraphicsContext, lead: Bool) {
        func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> Path {
            Path(CGRect(x: x, y: y, width: w, height: h))
        }
        func color(_ hex: UInt) -> Color {
            Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
        }
        let body = color(colors.dark ? 0xB6BAB8 : 0x9DA3A1)
        let window = color(colors.dark ? 0x4A3328 : 0x3B2A22)
        var shape = Path()
        shape.move(to: CGPoint(x: 1, y: 3)); shape.addLine(to: CGPoint(x: lead ? 25 : 31, y: 3))
        if lead { shape.addLine(to: CGPoint(x: 31, y: 7)) }
        shape.addLines([CGPoint(x: 31, y: 15), CGPoint(x: 1, y: 15)]); shape.closeSubpath()
        context.fill(shape, with: .color(body))
        for y in [5, 9] { for x in [4, 9, 14, 19] {
            context.fill(rect(CGFloat(x), CGFloat(y), 3, 2), with: .color(y == 5 ? window : color(colors.dark ? 0x2A1D18 : 0x241713)))
        } }
        if lead {
            var nose = Path()
            nose.addLines([CGPoint(x: 24, y: 3), CGPoint(x: 26, y: 3), CGPoint(x: 31, y: 7),
                           CGPoint(x: 31, y: 15), CGPoint(x: 24, y: 15)]); nose.closeSubpath()
            context.fill(nose, with: .color(color(colors.dark ? 0xF9B928 : 0xE4A20C)))
            context.fill(rect(25, 5, 3, 4), with: .color(window))
            context.fill(rect(29, 12, 1, 1), with: .color(color(colors.dark ? 0xFFF1AE : 0xFFF3B3)))
        } else { context.fill(rect(25, 5, 3, 8), with: .color(color(colors.dark ? 0x939896 : 0x747B79))) }
        for x in [7, 25] {
            context.fill(Path(ellipseIn: CGRect(x: Double(x) - 1.5, y: 14.5, width: 3, height: 3)), with: .color(color(0x201C1A)))
        }
    }
}
