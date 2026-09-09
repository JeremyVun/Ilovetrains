import SwiftUI

enum AxisItem: Equatable {
    case cap, ride(Int), dwell(Int), alight(Int), board(Int), station(Int), travelled
    case completedAlight(Int), completedBoard(Int), progress, tinyTrain
}

struct AxisItemKey: LayoutValueKey {
    static let defaultValue = AxisItem.cap
}

/// Measured labels may move or wrap; service times never move to make room.
struct JourneyAxisGeometry {
    var frames: [CGRect]
    var size: CGSize

    init(journey: Journey, large: Bool, progress: Double?, width: CGFloat,
         items: [AxisItem], sizes: [CGSize]) {
        let width = max(1, width)
        let chipHeight: CGFloat = large ? 24 : 22
        let barHeight: CGFloat = large ? 14 : 7
        let capWidth = items.firstIndex(of: .cap).map { sizes[$0].width } ?? 0
        let axisWidth = max(1, width - capWidth)
        let duration = max(1, journey.effectiveArrival - journey.effectiveDeparture)
        func x(_ instant: Millis) -> CGFloat {
            capWidth + axisWidth * min(1, max(0, (instant - journey.effectiveDeparture) / duration))
        }
        var boxes = Array(repeating: CGRect.zero, count: items.count)
        var pins: [Int] = []
        var labels: [Int] = []
        for (i, item) in items.enumerated() {
            switch item {
            case .cap:
                boxes[i] = CGRect(x: 0, y: 0, width: capWidth, height: chipHeight)
            case .ride(let leg):
                let start = x(journey.legs[leg].effectiveDeparture)
                boxes[i] = CGRect(x: start, y: (chipHeight - barHeight) / 2,
                                  width: max(0, x(journey.legs[leg].effectiveArrival) - start), height: barHeight)
            case .dwell(let leg):
                let start = x(journey.legs[leg].effectiveArrival)
                boxes[i] = CGRect(x: start, y: (chipHeight - barHeight) / 2,
                                  width: max(0, x(journey.legs[leg + 1].effectiveDeparture) - start), height: barHeight)
            case .alight(let leg), .board(let leg):
                let alighting = item == .alight(leg)
                let anchor = x(alighting ? journey.legs[leg].effectiveArrival : journey.legs[leg + 1].effectiveDeparture)
                let left = alighting ? anchor - sizes[i].width : anchor
                boxes[i] = CGRect(x: min(max(capWidth, left), width - sizes[i].width), y: 0,
                                  width: sizes[i].width, height: chipHeight)
                pins.append(i)
            case .station:
                labels.append(i)
            case .travelled:
                boxes[i] = CGRect(
                    x: capWidth,
                    y: (chipHeight - barHeight) / 2,
                    width: axisWidth * min(1, max(0, progress ?? 0)),
                    height: barHeight
                )
            case .completedAlight(_), .completedBoard(_):
                break
            case .tinyTrain:
                boxes[i] = CGRect(x: capWidth, y: (chipHeight - barHeight) / 2 - 18, width: axisWidth, height: 44)
            case .progress:
                let center = capWidth + axisWidth * min(1, max(0, progress ?? 0))
                boxes[i] = CGRect(x: center - 6.5, y: -11, width: 13, height: 9)
            }
        }
        // Keep marker text intact when a short ride crowds its neighbours.
        // Overflow uses another marker lane rather than shrinking a glyph.
        var lanes: [[Int]] = [[]]
        var used: CGFloat = 0
        for index in pins {
            let required = boxes[index].width + (lanes[lanes.count - 1].isEmpty ? 0 : 3)
            if used + required > axisWidth, !lanes[lanes.count - 1].isEmpty {
                lanes.append([]); used = 0
            }
            lanes[lanes.count - 1].append(index)
            used += boxes[index].width + (used == 0 ? 0 : 3)
        }
        for (lane, indices) in lanes.enumerated() {
            var right = capWidth - 3
            for index in indices {
                boxes[index].origin.x = max(boxes[index].minX, right + 3)
                boxes[index].origin.y = CGFloat(lane) * (chipHeight + 3)
                right = boxes[index].maxX
            }
            var edge = width
            for index in indices.reversed() {
                boxes[index].origin.x = min(boxes[index].minX, edge - boxes[index].width)
                edge = boxes[index].minX - 3
            }
        }
        for (index, item) in items.enumerated() {
            switch item {
            case let .completedAlight(leg):
                if let source = items.firstIndex(of: .alight(leg)) { boxes[index] = boxes[source] }
            case let .completedBoard(leg):
                if let source = items.firstIndex(of: .board(leg)) { boxes[index] = boxes[source] }
            default:
                break
            }
        }
        for (index, item) in items.enumerated() {
            guard case .ride(let leg) = item else { continue }
            let logicalStart = boxes[index].minX
            let logicalEnd = boxes[index].maxX
            let board = items.firstIndex(of: .board(leg - 1)).map { boxes[$0] }.flatMap { $0.minY == 0 ? $0 : nil }
            let alight = items.firstIndex(of: .alight(leg)).map { boxes[$0] }.flatMap { $0.minY == 0 ? $0 : nil }
            let paintedStart = board.map { marker -> CGFloat in
                let inset = min(lineChipCornerRadius, marker.width / 2)
                return min(marker.maxX - inset, max(marker.minX + inset, logicalStart))
            } ?? logicalStart
            let paintedEnd = alight.map { marker -> CGFloat in
                let inset = min(lineChipCornerRadius, marker.width / 2)
                return min(marker.maxX - inset, max(marker.minX + inset, logicalEnd))
            } ?? logicalEnd
            boxes[index].origin.x = paintedStart
            boxes[index].size.width = max(0, paintedEnd - paintedStart)
        }
        let markerBottom = max(chipHeight, pins.map { boxes[$0].maxY }.max() ?? 0)
        var placed: [CGRect] = []
        for index in labels {
            guard case .station(let leg) = items[index] else { continue }
            let midpoint = x((journey.legs[leg].effectiveArrival + journey.legs[leg + 1].effectiveDeparture) / 2)
            let labelWidth = min(width, sizes[index].width)
            var box = CGRect(x: max(0, min(width - labelWidth, midpoint - labelWidth / 2)),
                             y: markerBottom + 4, width: labelWidth, height: sizes[index].height)
            for prior in placed where box.minX < prior.maxX + 6 && box.maxX > prior.minX - 6 {
                if box.minY < prior.maxY + 6 { box.origin.y = prior.maxY + 6 }
            }
            boxes[index] = box; placed.append(box)
        }
        frames = boxes
        size = CGSize(width: width, height: max(large ? 42 : 22, boxes.enumerated().filter { items[$0.offset] != .tinyTrain }.map { $0.element.maxY }.max() ?? 0))
    }
}

struct JourneyAxisLayout: Layout {
    let journey: Journey
    let large: Bool
    let progress: Double?

    private func geometry(width: CGFloat, subviews: Subviews) -> JourneyAxisGeometry {
        let items = subviews.map { $0[AxisItemKey.self] }
        let sizes = subviews.map { view in
            if case .station = view[AxisItemKey.self] {
                return view.sizeThatFits(ProposedViewSize(width: width, height: nil))
            }
            return view.sizeThatFits(.unspecified)
        }
        return JourneyAxisGeometry(journey: journey, large: large, progress: progress,
                                   width: width, items: items, sizes: sizes)
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        geometry(width: proposal.width ?? 320, subviews: subviews).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let layout = geometry(width: bounds.width, subviews: subviews)
        for (index, view) in subviews.enumerated() {
            let frame = layout.frames[index]
            view.place(at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                       anchor: .topLeading, proposal: ProposedViewSize(frame.size))
        }
    }
}
