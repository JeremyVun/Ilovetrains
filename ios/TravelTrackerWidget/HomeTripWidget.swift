import SwiftUI
import WidgetKit

struct HomeTripEntry: TimelineEntry {
    let date: Date
    let content: WidgetContent
}

struct HomeTripProvider: TimelineProvider {
    var api = TransitAPI()

    func placeholder(in context: Context) -> HomeTripEntry {
        let now = Date()
        return HomeTripEntry(date: now, content: WidgetContent(date: now.millis, answer: nil, board: nil, next: nil, following: [], provenance: nil))
    }

    func getSnapshot(in context: Context, completion: @escaping (HomeTripEntry) -> Void) {
        let now = Date().millis
        let snapshot = readWidgetSnapshot(directory: widgetContainerURL()) ?? emptyWidgetSnapshot(now: now)
        let sources = Dictionary(widgetRequests(snapshot, from: now, until: now).compactMap { request in
            widgetSource(request, fetched: nil).map { (request.key, $0) }
        }, uniquingKeysWith: { first, _ in first })
        let content = widgetContent(snapshot, sources: sources, at: now)
        completion(HomeTripEntry(date: Date(millis: now), content: content))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<HomeTripEntry>) -> Void) {
        let api = api
        Task {
            let now = Date().millis
            let snapshot = readWidgetSnapshot(directory: widgetContainerURL()) ?? emptyWidgetSnapshot(now: now)
            let until = now + widgetTimelineHorizon
            let requests = widgetRequests(snapshot, from: now, until: until)
            let sources = await withTaskGroup(of: (String, BoardData?).self) { group in
                for request in requests {
                    group.addTask {
                        let fetched = try? await api.departurePage(
                            from: request.from, to: request.to, modes: request.modes,
                            at: request.at, transferLimit: request.transferLimit, timeout: 10
                        ).board
                        return (request.key, widgetSource(request, fetched: fetched))
                    }
                }
                var result: [String: BoardData] = [:]
                for await (key, board) in group { result[key] = board }
                return result
            }
            let entries = widgetTimeline(snapshot, sources: sources, from: now, until: until)
                .map { HomeTripEntry(date: Date(millis: $0.date), content: $0) }
            completion(Timeline(entries: entries, policy: .after(Date(millis: now + widgetLiveRefresh))))
        }
    }
}

private func emptyWidgetSnapshot(now: Millis) -> WidgetSnapshot {
    WidgetSnapshot(writtenAt: now, trips: [], schedule: [], modes: [], boards: [])
}

private extension Date {
    init(millis: Millis) { self.init(timeIntervalSince1970: millis / 1_000) }
    var millis: Millis { (timeIntervalSince1970 * 1_000).rounded() }
}

struct HomeTripWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: homeWidgetKind, provider: HomeTripProvider()) { entry in
            HomeTripPlaceholderView(content: entry.content)
                .containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("ilovetrains")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}

/// Temporary: prints the answer until the visual build replaces it.
struct HomeTripPlaceholderView: View {
    let content: WidgetContent
    @Environment(\.widgetFamily) private var family

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                Text(line).lineLimit(1).minimumScaleFactor(0.6)
            }
        }
        .font(.caption)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private var lines: [String] {
        guard let answer = content.answer else { return ["New trip"] }
        var lines = ["\(answer.from.station.shortName) → \(answer.to.station.shortName)"]
        if answer.focus?.pinned == true { lines.append("Pinned") }
        if let next = content.next {
            let later = family == .systemMedium ? content.following.map { clockTime($0.effectiveDeparture) } : []
            lines.append(([clockTime(next.effectiveDeparture)] + later).joined(separator: " · "))
        } else if content.board == nil {
            lines.append("No saved board for this trip yet")
        } else {
            lines.append(content.board?.offline == true ? "No services on the last board we could load" : "No services in the next few hours")
        }
        if family != .accessoryRectangular, let provenance = content.provenance { lines.append(provenance) }
        return lines
    }
}
