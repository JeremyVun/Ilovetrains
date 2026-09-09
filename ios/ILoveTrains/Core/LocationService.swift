import CoreLocation
import UIKit

@MainActor
protocol LocationProviding: AnyObject {
    var onPermission: ((Bool, Bool) -> Void)? { get set }
    var onFix: ((Fix) -> Void)? { get set }
    var onFailure: ((SetupLocationStatus) -> Void)? { get set }
    var isMonitoring: Bool { get }
    func refreshPermission()
    func openSettings()
    func request(prompt: Bool)
    func monitoringPermitted() async -> Bool
    func startMonitoring() -> Bool
    func stop()
}

@MainActor
final class LocationService: NSObject, LocationProviding, @preconcurrency CLLocationManagerDelegate {
    var onPermission: ((Bool, Bool) -> Void)?
    var onFix: ((Fix) -> Void)?
    var onFailure: ((SetupLocationStatus) -> Void)?
    private var manager: CLLocationManager?
    private var timeout: Task<Void, Never>?
    private var availabilityCheck: Task<Void, Never>?
    private var pending = false
    private var continuous = false

    var isMonitoring: Bool { pending && continuous && manager != nil }

    func refreshPermission() {
        let status = CLLocationManager().authorizationStatus
        onPermission?(status == .authorizedAlways || status == .authorizedWhenInUse, status == .denied || status == .restricted)
    }
    func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }
    func request(prompt: Bool) {
        guard !pending else { return }
        let current = CLLocationManager()
        let status = current.authorizationStatus
        let granted = status == .authorizedAlways || status == .authorizedWhenInUse
        onPermission?(granted, status == .denied || status == .restricted)
        guard prompt || granted else {
            if status == .denied || status == .restricted { onFailure?(.denied) }
            return
        }
        manager = current; pending = true; continuous = false
        // Core Location's device-wide availability check can block. Keep it off the UI thread.
        availabilityCheck = Task { [weak self] in
            let enabled = await Task.detached { CLLocationManager.locationServicesEnabled() }.value
            guard let self, !Task.isCancelled, self.manager === current, self.pending else { return }
            guard enabled else { self.fail(.servicesDisabled); return }
            let status = current.authorizationStatus
            let granted = status == .authorizedAlways || status == .authorizedWhenInUse
            self.onPermission?(granted, status == .denied || status == .restricted)
            guard prompt || granted else { self.fail(.denied); return }
            if status == .denied || status == .restricted {
                self.fail(.denied)
                if prompt { self.openSettings() }
                return
            }
            current.delegate = self
            current.desiredAccuracy = kCLLocationAccuracyHundredMeters
            if status == .notDetermined { current.requestWhenInUseAuthorization() }
            else { current.requestLocation(); self.scheduleTimeout() }
        }
    }
    func monitoringPermitted() async -> Bool {
        let enabled = await Task.detached { CLLocationManager.locationServicesEnabled() }.value
        let status = CLLocationManager().authorizationStatus
        let granted = status == .authorizedAlways || status == .authorizedWhenInUse
        onPermission?(granted, status == .denied || status == .restricted)
        return enabled && granted
    }
    func startMonitoring() -> Bool {
        let current = CLLocationManager()
        let status = current.authorizationStatus
        guard status == .authorizedAlways || status == .authorizedWhenInUse else { return false }
        stop()
        manager = current; pending = true; continuous = true
        current.delegate = self
        current.desiredAccuracy = kCLLocationAccuracyHundredMeters
        current.startUpdatingLocation()
        return true
    }
    func stop() {
        pending = false; continuous = false; timeout?.cancel(); timeout = nil
        availabilityCheck?.cancel(); availabilityCheck = nil
        manager?.stopUpdatingLocation(); manager?.delegate = nil; manager = nil
    }
    private func scheduleTimeout() {
        timeout?.cancel()
        timeout = Task { [weak self] in do { try await Task.sleep(for: .seconds(15)) } catch { return }; self?.fail(.unavailable) }
    }
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard manager === self.manager, pending else { return }
        let status = manager.authorizationStatus
        let granted = status == .authorizedWhenInUse || status == .authorizedAlways
        onPermission?(granted, status == .denied || status == .restricted)
        if granted {
            if continuous { manager.startUpdatingLocation() }
            else { manager.requestLocation(); scheduleTimeout() }
        }
        else if status != .notDetermined { fail(.denied) }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard manager === self.manager, pending, let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        let fix = Fix(lat: location.coordinate.latitude, lon: location.coordinate.longitude, at: location.timestamp.timeIntervalSince1970 * 1000, speed: location.speed >= 0 ? location.speed : nil, accuracyMetres: location.horizontalAccuracy)
        if !continuous { stop() }
        onFix?(fix)
    }
    private func fail(_ status: SetupLocationStatus) {
        stop(); onFailure?(status)
    }
    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        if manager === self.manager {
            if continuous { onFailure?(.unavailable) }
            else { fail(.unavailable) }
        }
    }
}
