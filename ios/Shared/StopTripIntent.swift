import AppIntents
import Foundation

/// The Live Activity's Stop trip button. iOS runs it in the app process, whose controller registers `handler` at launch.
struct StopTripIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop trip"
    static var isDiscoverable = false
    @MainActor static var handler: ((UUID) async -> Void)?

    @Parameter(title: "Session") var session: String

    init() {}

    init(session: UUID) {
        self.session = session.uuidString
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        if let requested = UUID(uuidString: session) { await Self.handler?(requested) }
        return .result()
    }
}
