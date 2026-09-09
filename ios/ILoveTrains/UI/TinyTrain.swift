import SwiftUI

let tinyTrainCarCount = 8
let tinyTrainCarWidth: CGFloat = 40
let tinyTrainGap: CGFloat = 1
let tinyTrainLength = tinyTrainCarWidth * CGFloat(tinyTrainCarCount) + tinyTrainGap * CGFloat(tinyTrainCarCount - 1)

func tinyTrainCarBody(cab: Bool) -> Path {
    var shape = Path()
    shape.move(to: CGPoint(x: 0, y: 3))
    shape.addLine(to: CGPoint(x: cab ? 33 : 40, y: 3))
    if cab { shape.addLine(to: CGPoint(x: 40, y: 7)) }
    shape.addLine(to: CGPoint(x: 40, y: 15))
    shape.addLine(to: CGPoint(x: 0, y: 15))
    shape.closeSubpath()
    return shape
}

func tinyTrainCarOffset(_ index: Int, scale: CGFloat) -> CGFloat {
    CGFloat(index) * (tinyTrainCarWidth + tinyTrainGap) * scale
}

struct TinyTrainLane: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var systemReduceMotion
    @Environment(\.trainColors) private var colors
    @State private var started: Date?
    @State private var runID = 0
    var flag = false
    var flagOverride: Bool? = nil
    var onAvailabilityChange: (Bool) -> Void = { _ in }

    private var reduceMotion: Bool {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--tiny-train-reduced-motion") { return true }
        #endif
        return systemReduceMotion
    }

    private var previewFlag: Bool? {
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("--tiny-train") { return true }
        if arguments.contains("--calibration") || arguments.contains("--offline") { return false }
        #endif
        return nil
    }

    private var enabled: Bool { scenePhase == .active && (flagOverride ?? previewFlag ?? flag) }

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
                            let scale = reduceMotion ? min(1, size.width / tinyTrainLength) : 1
                            let left = reduceMotion
                                ? (size.width - tinyTrainLength * scale) / 2
                                : -tinyTrainLength - 4 + progress * (size.width + tinyTrainLength + 8)
                            context.clip(to: Path(CGRect(x: 0, y: 0, width: size.width, height: 18)))
                            for car in 0..<tinyTrainCarCount {
                                var carContext = context
                                carContext.translateBy(x: left + tinyTrainCarOffset(car, scale: scale), y: 0)
                                carContext.scaleBy(x: scale, y: scale)
                                if car == 0 {
                                    carContext.translateBy(x: tinyTrainCarWidth, y: 0)
                                    carContext.scaleBy(x: -1, y: 1)
                                }
                                drawCar(&carContext, cab: car == 0 || car == tinyTrainCarCount - 1)
                            }
                        }
                    }.allowsHitTesting(false).accessibilityHidden(true)
                }
            }
        }
        .frame(height: 44)
        .task(id: runID) {
            guard started != nil else { return }
            do { try await Task.sleep(for: .milliseconds(reduceMotion ? 650 : 2600)) }
            catch { return }
            started = nil
        }
        .onChange(of: enabled, initial: true) { _, value in
            if !value { started = nil }
            onAvailabilityChange(value)
        }
        .onChange(of: reduceMotion) { _, _ in started = nil }
        .onDisappear { started = nil; onAvailabilityChange(false) }
    }

    private func drawCar(_ context: inout GraphicsContext, cab: Bool) {
        func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> Path {
            Path(CGRect(x: x, y: y, width: w, height: h))
        }
        func color(_ hex: UInt) -> Color {
            Color(red: Double((hex >> 16) & 255) / 255, green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
        }
        let body = color(colors.dark ? 0xB6BAB8 : 0x9DA3A1)
        let window = color(colors.dark ? 0x4A3328 : 0x3B2A22)
        context.fill(tinyTrainCarBody(cab: cab), with: .color(body))
        let door = color(colors.dark ? 0xF9B928 : 0xE4A20C)
        for x in [5, 28] {
            context.fill(rect(CGFloat(x), 5, 6, 9), with: .color(door))
            context.fill(rect(CGFloat(x + 3), 5, 1, 9), with: .color(body.opacity(0.75)))
        }
        for y in [5, 10] { for x in [13, 18, 23] {
            context.fill(rect(CGFloat(x), CGFloat(y), 3, 2), with: .color(window))
        } }
        if cab {
            var nose = Path()
            nose.addLines([CGPoint(x: 33, y: 3), CGPoint(x: 35, y: 3), CGPoint(x: 40, y: 7),
                           CGPoint(x: 40, y: 15), CGPoint(x: 33, y: 15)]); nose.closeSubpath()
            context.fill(nose, with: .color(door))
            context.fill(rect(34, 5, 3, 4), with: .color(window))
            context.fill(rect(38, 12, 1, 1), with: .color(color(colors.dark ? 0xFFF1AE : 0xFFF3B3)))
        }
        for x in [7, 33] {
            context.fill(Path(ellipseIn: CGRect(x: Double(x) - 1.5, y: 14.5, width: 3, height: 3)), with: .color(color(0x201C1A)))
        }
    }
}
