import Foundation

let sydneyZone = TimeZone(identifier: "Australia/Sydney")!
var sydneyCalendar: Calendar { var c = Calendar(identifier: .gregorian); c.timeZone = sydneyZone; return c }
func clockTime(_ time: Double) -> String {
    let parts = sydneyCalendar.dateComponents([.hour, .minute], from: Date(timeIntervalSince1970: time / 1000))
    return String(format: "%02d:%02d", parts.hour ?? 0, parts.minute ?? 0)
}
func epochNow() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }
enum Screen: String, Codable, Sendable { case home, board, detail, setup, settings }
enum Appearance: String, Codable, CaseIterable, Sendable { case system, dark, light }
enum TransferLimit: String, Codable, CaseIterable, Sendable { case two, any }
let transferLimitFlagKey = "transferLimit"

struct AppState {
    var ready = false
    var screen: Screen = .home
    var trips: [SavedTrip] = []
    var totalTrips = 0
    var selectedTripId: String?
    var selectionPredicted = false
    var reverse = false
    var board: BoardData?
    var homeBoard: BoardData?
    var detail: Journey?
    var focus: FocusedJourney?
    var now = epochNow()
    var refreshing = false
    var appearance: Appearance = .system
    var enabledModes = allModes
    var transferLimit: TransferLimit = .two
    var flags: [String: Bool] = [:]
    var useLocation = true
    var locationGranted = false
    var locationDenied = false
    var distanceMetres: Int?
    var receipt: String?
    var home: Station?
    var homeIsManual = false
    var automaticHome: Station?
    var focusComplete = false
    var stations: [Station] = []
    var recentFrom: [Station] = []
    var recentTo: [Station] = []
    var setupFrom: Station?
    var setupTo: Station?
    var setupLocationStatus: SetupLocationStatus = .idle
    var nearbyStations: [Station] = []
    var nearestStation: Station?
    var justAddedTripId: String?
    var selectingHome = false
    var timetableStatus = "Opening offline timetable"
    var timetableUpdating = false
    var tripMetadata: [String: String] = [:]
    var feedbackSubmitting = false
    var feedbackSucceeded = false
    var message: String?
    var messageAutoDismiss = false
    var undoAvailable = false
    var earlierLoading = false
    var version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "1.0.0"
    var transferLimitOffered: Bool { flags[transferLimitFlagKey] == true }
    var selectedTrip: SavedTrip? { trips.first { $0.id == selectedTripId } }
    var shownBoard: BoardData? { screen == .home ? homeBoard ?? board : board }
}
