import CoreLocation
import UIKit

@MainActor
final class LocationService: NSObject, @preconcurrency CLLocationManagerDelegate {
    var onPermission: ((Bool, Bool) -> Void)?
    var onFix: ((Fix) -> Void)?
    private var manager: CLLocationManager?
    private var timeout: Task<Void, Never>?
    private var pending = false

    func refreshPermission() {
        let status = CLLocationManager().authorizationStatus
        onPermission?(status == .authorizedAlways || status == .authorizedWhenInUse, status == .denied || status == .restricted)
    }
    func request(prompt: Bool) {
        stop()
        let current = CLLocationManager()
        let status = current.authorizationStatus
        onPermission?(status == .authorizedAlways || status == .authorizedWhenInUse, status == .denied || status == .restricted)
        if status == .denied || status == .restricted {
            if prompt, let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            return
        }
        guard prompt || status == .authorizedAlways || status == .authorizedWhenInUse else { return }
        manager = current; pending = true; current.delegate = self
        current.desiredAccuracy = kCLLocationAccuracyHundredMeters
        if status == .notDetermined { current.requestWhenInUseAuthorization() }
        else { current.requestLocation(); scheduleTimeout() }
    }
    func stop() {
        pending = false; timeout?.cancel(); timeout = nil
        manager?.stopUpdatingLocation(); manager?.delegate = nil; manager = nil
    }
    private func scheduleTimeout() {
        timeout?.cancel()
        timeout = Task { [weak self] in do { try await Task.sleep(for: .seconds(15)) } catch { return }; self?.stop() }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager === self.manager, pending else { return }
        let status = manager.authorizationStatus
        let granted = status == .authorizedWhenInUse || status == .authorizedAlways
        onPermission?(granted, status == .denied || status == .restricted)
        if granted { manager.requestLocation(); scheduleTimeout() }
        else if status != .notDetermined { stop() }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard manager === self.manager, pending, let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        let fix = Fix(lat: location.coordinate.latitude, lon: location.coordinate.longitude, at: location.timestamp.timeIntervalSince1970 * 1000, speed: location.speed >= 0 ? location.speed : nil)
        stop(); onFix?(fix)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if manager === self.manager { stop() }
    }
}
