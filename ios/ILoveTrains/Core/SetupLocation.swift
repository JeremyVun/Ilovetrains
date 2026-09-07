import Foundation

// Transient setup state. Coordinates and accuracy are never persisted.
enum SetupLocationStatus {
    case idle, locating, denied, unavailable, servicesDisabled, noNearby, chooseStation
    var message: String? {
        switch self {
        case .idle: nil
        case .locating: "Finding your location…"
        case .denied: "Location permission wasn’t granted. You can search for a station."
        case .unavailable: "Couldn’t get your location. Try again or search for a station."
        case .servicesDisabled: "Location Services are off. Turn them on in Settings or search for a station."
        case .noNearby: "No stations found nearby. Search for your starting station."
        case .chooseStation: "Choose your starting station. Your location isn’t precise enough to pick one."
        }
    }
}
struct SetupLocationChoice {
    var stations: [Station]
    var automatic: Station?
}
func setupLocationChoice(stations: [Station], modes: Set<String>, fix: Fix) -> SetupLocationChoice {
    let accuracy = fix.accuracyMetres.flatMap { $0.isFinite && $0 >= 0 ? $0 : nil }
    let radius = 2_000 + min(accuracy ?? 3_000, 3_000)
    let nearby = stations.filter { !$0.modes.isDisjoint(with: modes) }
        .map { ($0, distanceMetres(fix, $0)) }.filter { $0.1 <= radius }.sorted { $0.1 < $1.1 }
    var automatic: Station?
    if let accuracy, accuracy <= 200, let first = nearby.first, first.1 <= 2_000,
       (nearby.dropFirst().first?.1 ?? .infinity) - first.1 > 2 * accuracy { automatic = first.0 }
    return SetupLocationChoice(stations: Array(nearby.prefix(3).map(\.0)), automatic: automatic)
}
