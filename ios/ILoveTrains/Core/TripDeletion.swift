import Foundation

let defaultUndoWindow: Duration = .seconds(4)

struct PendingDeletion: Equatable {
    let trip: SavedTrip
    let index: Int
    let history: [ViewEvent]
    let focus: FocusedJourney?
    let lastAnswer: LastAnswer?
    let lastTripId: String?
}

func deletionMessage(_ trip: SavedTrip) -> String { "\(trip.from.shortName) → \(trip.to.shortName) deleted" }

extension UserData {
    func beginningDeletion(of id: String) -> (UserData, PendingDeletion)? {
        guard let index = trips.firstIndex(where: { $0.id == id }) else { return nil }
        let pending = PendingDeletion(
            trip: trips[index], index: index, history: history.filter { $0.tripId == id },
            focus: focus?.tripId == id ? focus : nil, lastAnswer: lastAnswer?.tripId == id ? lastAnswer : nil,
            lastTripId: lastTripId == id ? lastTripId : nil
        )
        var remaining = self
        remaining.trips.remove(at: index)
        remaining.history.removeAll { $0.tripId == id }
        if remaining.focus?.tripId == id { remaining.focus = nil }
        if remaining.lastAnswer?.tripId == id { remaining.lastAnswer = nil }
        if remaining.lastTripId == id { remaining.lastTripId = nil }
        return (remaining, pending)
    }

    func restoring(_ pending: PendingDeletion) -> UserData {
        let pair = Set([pending.trip.from.id, pending.trip.to.id])
        if trips.contains(where: { $0.id == pending.trip.id || Set([$0.from.id, $0.to.id]) == pair }) { return self }
        var restored = self
        restored.trips.insert(pending.trip, at: min(pending.index, trips.count))
        restored.history = Array((history + pending.history).suffix(500))
        restored.focus = focus ?? pending.focus
        restored.lastAnswer = lastAnswer ?? pending.lastAnswer
        restored.lastTripId = lastTripId ?? pending.lastTripId
        return restored
    }
}
