import ActivityKit
import Foundation

struct TravelTrackerActivityAttributes: ActivityAttributes, Codable, Hashable {
    struct FocusIdentity: Codable, Hashable {
        var tripId: String
        var reverse: Bool
        var serviceKey: String
    }

    struct ContentState: Codable, Hashable {
        var generation: Int
        var stage: Stage
        var eventKind: EventKind
        var headline: Headline
        var instruction: String
        var instructionRuns: [TextRun]
        var platforms: [Platform]
        var connection: String?
        var tightConnection: Bool
        var destination: String
        var eta: Date
        var etaText: String
        var timerStart: Date
        var eventDeadline: Date?
        var journeyStart: Date
        var journeyEnd: Date
        var segments: [Segment]
        var progress: Double
        var provenance: String
        var staleProvenance: String
        var nextBoundary: Date
        var staleDate: Date
        var cancelled: Bool
        var arrivalCancelled: Bool
        #if DEBUG
        var debugStaticCountdown: String? = nil
        #endif
    }

    enum Stage: String, Codable, Hashable {
        case boarding, ride, transfer, final, missedTransfer
    }

    enum EventKind: String, Codable, Hashable {
        case departure, arrival, cancellation, missedConnection
    }

    enum TextRunRole: String, Codable, Hashable {
        case plain, platform
    }

    struct TextRun: Codable, Hashable {
        var text: String
        var role: TextRunRole
    }

    struct Headline: Codable, Hashable {
        var lead: String
        var emphasis: String?
        var tail: String
    }

    enum PlatformRole: String, Codable, Hashable {
        case alight, board
    }

    struct Platform: Codable, Hashable {
        var role: PlatformRole
        var legIndex: Int
        var mode: String
        var stationName: String
        var label: String
    }

    enum SegmentKind: String, Codable, Hashable {
        case ride, gap
    }

    struct Segment: Codable, Hashable {
        var kind: SegmentKind
        var legIndex: Int
        var line: String?
        var mode: String?
        var colorHex: UInt32?
        var startFraction: Double
        var endFraction: Double
    }

    var sessionId: UUID
    var focus: FocusIdentity
    var deepLinkURL: URL
}
