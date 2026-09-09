import XCTest
import CoreLocation

final class TravelTrackerFlowTests: XCTestCase {
    private let bundle = "com.ilovetrains.ios"
    private let springboardBundle = "com.apple.springboard"
    private let competitorBundle = "com.codex.ilovetrains.trackerprobe.competitor"

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    override func tearDownWithError() throws {
        guard (testRun?.failureCount ?? 0) > 0 else { return }
        attach(XCUIScreen.main.screenshot(), name: "failure-screen")
        attachText(XCUIApplication(bundleIdentifier: springboardBundle).debugDescription, name: "failure-springboard")
        attachText(XCUIApplication(bundleIdentifier: bundle).debugDescription, name: "failure-app")
    }

    @MainActor
    func testCaptureSystemSurfaces() {
        let scheme = environment("TRACKER_SCHEME", fallback: "dark")
        let surfaces = environmentList("TRACKER_SURFACES", fallback: ["notification-center", "compact", "expanded"])
        let cases = environmentList("TRACKER_CASES", fallback: [CaptureCase.ride.rawValue])
        let requested = cases.compactMap(CaptureCase.init(rawValue:))
        XCTAssertEqual(requested.count, cases.count, "TRACKER_CASES contains an unknown case")
        var domain = UUID().uuidString

        for captureCase in requested {
            var app = launch(["--tracker-case", captureCase.rawValue], domain: domain)
            assertStatus(app, contains: ["activities=1", "focus=tracker-mascot"])
            acceptLiveActivityPromptIfPresent()
            app.terminate()

            if surfaces.contains("notification-center") {
                showNotificationCenter()
                for _ in 0..<2 {
                    guard acceptLiveActivityPromptIfPresent() else { break }
                    Thread.sleep(forTimeInterval: 1)
                    domain = UUID().uuidString
                    app = launch(["--tracker-case", captureCase.rawValue], domain: domain)
                    assertStatus(app, contains: ["activities=1", "focus=tracker-mascot"])
                    app.terminate()
                    showNotificationCenter()
                }
                let stem = "tracker-\(captureCase.rawValue)-\(scheme)-notification-center"
                let card = assertNotificationCard()
                attachBounds(card.frame, name: stem + "-card-bounds")
                attachSystem(name: stem)
                app.activate()
            }

            guard captureCase == .ride else { continue }
            if surfaces.contains("compact") {
                app.terminate()
                let springboard = XCUIApplication(bundleIdentifier: springboardBundle)
                springboard.activate()
                assertSystemContains(["T8", "Central"])
                attachSystem(name: "tracker-ride-\(scheme)-island-compact")
            }
            if surfaces.contains("expanded") {
                app.terminate()
                let springboard = XCUIApplication(bundleIdentifier: springboardBundle)
                springboard.activate()
                springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).press(forDuration: 1.5)
                assertSystemContains(["Central", "Platform 21", "Platform 26", "Kellyville", "05:46"])
                attachSystem(name: "tracker-ride-\(scheme)-island-expanded")
            }
            if environment("TRACKER_MINIMAL_COMPETITOR", fallback: "0") == "1" {
                let competitor = XCUIApplication(bundleIdentifier: competitorBundle)
                competitor.launchArguments = ["start"]
                competitor.launch()
                XCTAssertTrue(competitor.wait(for: .runningForeground, timeout: 5))
                competitor.terminate()
                XCUIApplication(bundleIdentifier: springboardBundle).activate()
                assertSystemContains(["T8"])
                attachSystem(name: "tracker-ride-\(scheme)-island-minimal")
            }
        }
    }

    @MainActor
    func testWallClockStaleBoundaryAndForegroundLifecycle() {
        let domain = UUID().uuidString
        var app = launch(["--tracker-debug", "wall-start"], domain: domain)
        var initial = assertStatus(app, contains: ["stage=ride", "activities=1"])
        app.terminate()

        showNotificationCenter()
        for _ in 0..<2 {
            guard acceptLiveActivityPromptIfPresent() else { break }
            Thread.sleep(forTimeInterval: 1)
            app = launch(["--tracker-debug", "wall-start"], domain: domain)
            initial = assertStatus(app, contains: ["stage=ride", "activities=1"])
            app.terminate()
            showNotificationCenter()
        }
        let publishedAt = Date()
        let activityId = statusField("activity", in: initial)
        XCTAssertNotNil(activityId)
        assertNotificationCard()
        attachSystem(name: "tracker-lifecycle-before-stale")
        let staleDeadline = publishedAt.addingTimeInterval(75)
        while Date() < staleDeadline { Thread.sleep(forTimeInterval: 0.5) }
        assertNotificationCard()
        attachSystem(name: "tracker-lifecycle-after-stale-boundary")
        let lateStaleDeadline = publishedAt.addingTimeInterval(105)
        while Date() < lateStaleDeadline { Thread.sleep(forTimeInterval: 0.5) }
        assertNotificationCard()
        attachSystem(name: "tracker-lifecycle-late-stale-boundary")

        app = launch(["--tracker-debug", "inspect"], domain: domain)
        let recovered = assertStatus(app, contains: ["state=stale", "stage=ride", "activities=1"])
        XCTAssertEqual(statusField("activity", in: recovered), activityId)
        app = launch(["--tracker-debug", "foreground-transfer"], domain: domain)
        assertStatus(app, contains: ["stage=transfer", "activities=1"])
        app.terminate()
        showNotificationCenter()
        assertNotificationCard()
        attachSystem(name: "tracker-lifecycle-foreground-transfer")

        app = launch(["--tracker-debug", "foreground-end"], domain: domain)
        assertStatus(app, contains: ["activities=0"])
        app.terminate()
        showNotificationCenter()
        waitForNotificationCardAbsence()
        attachSystem(name: "tracker-lifecycle-ended")
    }

    @MainActor
    func testAutomaticTravelModeStartsTracker() {
        let location = CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: -33.9000, longitude: 151.1900),
            altitude: 0,
            horizontalAccuracy: 20,
            verticalAccuracy: 20,
            course: 0,
            speed: 10,
            timestamp: Date()
        )
        XCUIDevice.shared.location = XCUILocation(location: location)
        defer { XCUIDevice.shared.location = nil }
        let domain = UUID().uuidString
        let app = XCUIApplication(bundleIdentifier: bundle)
        app.resetAuthorizationStatus(for: .location)
        app.launchArguments = ["--offline", "--tracker-debug", "production-inference"]
        app.launchEnvironment["ILOVETRAINS_TEST_DOMAIN"] = domain
        app.launch()
        assertStatus(app, contains: ["focus=none", "activities=0"])
        let locationAction = app.buttons["use-location"]
        XCTAssertTrue(locationAction.waitForExistence(timeout: 8))
        locationAction.tap()
        let allow = XCUIApplication(bundleIdentifier: springboardBundle).buttons["Allow While Using App"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5))
        allow.tap()
        assertStatus(app, contains: ["focus=inferred", "pinned=false", "activities=1"])
        app.terminate()
        app.resetAuthorizationStatus(for: .location)
    }

    @MainActor
    func testGuardedOverdueFocusSurvivesRealLocationAndColdResume() {
        XCUIDevice.shared.location = XCUILocation(location: CLLocation(
            coordinate: CLLocationCoordinate2D(latitude: -33.9, longitude: 151.19),
            altitude: 0, horizontalAccuracy: 20, verticalAccuracy: 20,
            course: 0, speed: 10, timestamp: Date()
        ))
        defer { XCUIDevice.shared.location = nil }
        let domain = UUID().uuidString
        var app = XCUIApplication(bundleIdentifier: bundle)
        app.resetAuthorizationStatus(for: .location)
        app = launch(["--tracker-debug", "production-inference"], domain: domain)
        app.buttons["use-location"].tap()
        let allow = XCUIApplication(bundleIdentifier: springboardBundle).buttons["Allow While Using App"]
        XCTAssertTrue(allow.waitForExistence(timeout: 5))
        allow.tap()
        assertStatus(app, contains: ["focus=inferred", "activities=1"])
        app = launch(["--tracker-debug", "guarded-overdue"], domain: domain)
        assertStatus(app, contains: ["focus=guarded-overdue", "arrival=arrivalUnconfirmed", "guard=true", "rides=0", "monitoring=true", "activities=1"])
        let deadline = Date().addingTimeInterval(17)
        while Date() < deadline { Thread.sleep(forTimeInterval: 0.5) }
        assertStatus(app, contains: ["arrival=arrivalUnconfirmed", "rides=0", "monitoring=true", "activities=1"])
        attach(XCUIScreen.main.screenshot(), name: "commute-guarded-overdue")
        app.terminate()
        showNotificationCenter()
        acceptLiveActivityPromptIfPresent()
        app = launch(["--tracker-debug", "guarded-resume"], domain: domain)
        assertStatus(app, contains: ["focus=guarded-overdue", "arrival=arrivalUnconfirmed", "guard=true", "rides=0", "monitoring=true", "activities=1"])
        attach(XCUIScreen.main.screenshot(), name: "commute-guarded-cold-resume")
        app.terminate()
        app.resetAuthorizationStatus(for: .location)
    }

    @MainActor
    func testDismissalReplacementAndColdTap() {
        let domain: String? = nil
        var app = launch(["--tracker-debug", "dismiss-start"], domain: domain)
        let original = assertStatus(app, contains: ["activities=1", "focus=dismiss-original"])
        let staleSession = try! XCTUnwrap(statusField("session", in: original))
        app.terminate()
        showNotificationCenter()
        let card = assertNotificationCard()
        card.swipeLeft()
        let clear = XCUIApplication(bundleIdentifier: springboardBundle).buttons.matching(
            NSPredicate(format: "label IN[c] %@", ["Clear", "Remove"])
        ).firstMatch
        if clear.waitForExistence(timeout: 2) { clear.tap() }
        waitForNotificationCardAbsence()

        app = launch(["--tracker-debug", "inspect"], domain: domain)
        assertStatus(app, contains: ["activities=0", "focus=dismiss-original", "suppressed=dismissed"])
        app.terminate()
        app = launch(["--tracker-debug", "inspect"], domain: domain)
        assertStatus(app, contains: ["activities=0", "focus=dismiss-original", "suppressed=dismissed"])

        app = launch(["--tracker-debug", "replacement"], domain: domain)
        assertStatus(app, contains: ["activities=1", "focus=replacement"])
        let staleURL = try! XCTUnwrap(URL(string: "ilovetrains://tracker?session=\(staleSession)"))
        app.open(staleURL)
        assertStatus(app, contains: ["focus=replacement", "screen=home"])
        app.terminate()

        showNotificationCenter()
        let replacementCard = assertNotificationCard()
        replacementCard.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 8), "Live Activity tap did not cold launch the app")
        XCTAssertTrue(app.staticTexts["JOURNEY"].waitForExistence(timeout: 8), "Live Activity tap did not open journey detail")
        XCTAssertTrue(app.staticTexts["Mascot → Rouse Hill"].waitForExistence(timeout: 8),
                      "cold-launched detail lost the replacement journey")
    }

    @MainActor
    func testLiveActivityDenialPreservesFocus() throws {
        guard environment("TRACKER_EXPECT_PERMISSION_PROMPT", fallback: "0") == "1" else {
            throw XCTSkip("Requires a fresh app install and TRACKER_EXPECT_PERMISSION_PROMPT=1")
        }
        let domain = UUID().uuidString
        let app = launch(["--tracker-debug", "permission-start"], domain: domain, awaitReady: false)
        let system = XCUIApplication(bundleIdentifier: springboardBundle)
        XCTAssertTrue(app.descendants(matching: .any)["tracker-driver-status"].waitForExistence(timeout: 12))
        app.terminate()
        showNotificationCenter()
        let deny = system.buttons.matching(NSPredicate(
            format: "label IN[c] %@", ["Don’t Allow", "Don't Allow", "Not Now"]
        )).firstMatch
        XCTAssertTrue(deny.waitForExistence(timeout: 5), "fresh install did not present Live Activities denial control")
        attachSystem(name: "tracker-permission-first-use")
        deny.tap()

        let relaunched = launch(["--tracker-debug", "inspect"], domain: domain)
        assertStatus(relaunched, contains: ["focus=permission-focus", "activities=0"])
        XCTAssertFalse(deny.waitForExistence(timeout: 2), "Live Activity permission prompt repeated after denial")
    }

    @MainActor
    private func launch(_ arguments: [String], domain: String?, awaitReady: Bool = true) -> XCUIApplication {
        let app = XCUIApplication()
        app.terminate()
        app.launchArguments = ["--offline"] + arguments
        if let domain { app.launchEnvironment["ILOVETRAINS_TEST_DOMAIN"] = domain }
        app.launch()
        if awaitReady {
            XCTAssertTrue(app.descendants(matching: .any)["tracker-driver-status"].waitForExistence(timeout: 12),
                          "tracker driver status is missing")
        }
        return app
    }

    @MainActor
    @discardableResult
    private func assertStatus(_ app: XCUIApplication, contains required: [String]) -> String {
        let status = app.descendants(matching: .any)["tracker-driver-status"]
        XCTAssertTrue(status.waitForExistence(timeout: 12), "tracker driver status is missing")
        let deadline = Date().addingTimeInterval(12)
        var observed = statusText(status)
        while !required.allSatisfy({ observed.localizedCaseInsensitiveContains($0) }), Date() < deadline {
            Thread.sleep(forTimeInterval: 0.1)
            observed = statusText(status)
        }
        for fragment in required {
            XCTAssertTrue(observed.localizedCaseInsensitiveContains(fragment), "tracker status lost '\(fragment)': \(observed)")
        }
        return observed
    }

    private func statusText(_ element: XCUIElement) -> String {
        [element.label, element.value as? String].compactMap { $0 }.joined(separator: " ")
    }

    private func statusField(_ name: String, in status: String) -> String? {
        status.split(whereSeparator: { $0 == " " || $0 == "|" })
            .first { $0.hasPrefix("\(name)=") }
            .map { String($0.dropFirst(name.count + 1)) }
    }

    @discardableResult
    private func acceptLiveActivityPromptIfPresent() -> Bool {
        let system = XCUIApplication(bundleIdentifier: springboardBundle)
        let allow = system.buttons.matching(NSPredicate(
            format: "label IN[c] %@", ["Allow", "Always Allow", "Allow Live Activities"]
        )).firstMatch
        guard allow.waitForExistence(timeout: 2.5) else { return false }
        allow.tap()
        return true
    }

    private func showNotificationCenter() {
        let springboard = XCUIApplication(bundleIdentifier: springboardBundle)
        springboard.activate()
        let start = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.01))
        let end = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.15, dy: 0.72))
        start.press(forDuration: 0.08, thenDragTo: end)
        Thread.sleep(forTimeInterval: 1.5)
    }

    private func notificationCard() -> XCUIElement? {
        let candidates = XCUIApplication(bundleIdentifier: springboardBundle).buttons
            .matching(identifier: "ListCell").allElementsBoundByIndex
            .filter {
                $0.label.isEmpty && $0.frame.minY > 100 &&
                    $0.frame.width > 350 && $0.frame.height > 100
            }
        return candidates.max { $0.frame.minY < $1.frame.minY }
    }

    @discardableResult
    private func assertNotificationCard() -> XCUIElement {
        let deadline = Date().addingTimeInterval(8)
        var matched = notificationCard()
        while matched == nil, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.2)
            matched = notificationCard()
        }
        guard let card = matched else {
            XCTFail("ActivityKit card is missing from Notification Center")
            return XCUIApplication(bundleIdentifier: springboardBundle).buttons["missing-activity-card"]
        }
        XCTAssertGreaterThan(card.frame.width, 350)
        XCTAssertGreaterThan(card.frame.height, 140)
        return card
    }

    private func waitForNotificationCardAbsence() {
        let deadline = Date().addingTimeInterval(8)
        while notificationCard() != nil, Date() < deadline { Thread.sleep(forTimeInterval: 0.2) }
        XCTAssertNil(notificationCard(), "dismissed ActivityKit card remains in Notification Center")
    }

    private func assertSystemContains(_ required: [String], timeout: TimeInterval = 8) {
        let deadline = Date().addingTimeInterval(timeout)
        var observed = systemDescription()
        while !required.allSatisfy({ observed.localizedCaseInsensitiveContains($0) }), Date() < deadline {
            Thread.sleep(forTimeInterval: 0.2)
            observed = systemDescription()
        }
        for fragment in required {
            XCTAssertTrue(observed.localizedCaseInsensitiveContains(fragment), "system surface lost '\(fragment)'\n\(observed)")
        }
    }

    private func waitForSystemAbsence(_ fragment: String) {
        let deadline = Date().addingTimeInterval(8)
        while systemDescription().localizedCaseInsensitiveContains(fragment), Date() < deadline {
            Thread.sleep(forTimeInterval: 0.2)
        }
        XCTAssertFalse(systemDescription().localizedCaseInsensitiveContains(fragment), "system surface still contains '\(fragment)'")
    }

    private func systemElement(containing fragment: String) -> XCUIElement {
        XCUIApplication(bundleIdentifier: springboardBundle).descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] %@", fragment)).firstMatch
    }

    private func systemDescription() -> String {
        XCUIApplication(bundleIdentifier: springboardBundle).debugDescription
    }

    private func attachSystem(name: String) {
        attach(XCUIScreen.main.screenshot(), name: name)
        attachText(systemDescription(), name: name + "-ax")
    }

    private func attach(_ screenshot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachText(_ value: String, name: String) {
        let attachment = XCTAttachment(string: value)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func attachBounds(_ frame: CGRect, name: String) {
        let value = String(
            format: "{\"x\":%.3f,\"y\":%.3f,\"width\":%.3f,\"height\":%.3f,\"scale\":3}",
            frame.minX, frame.minY, frame.width, frame.height
        )
        attachText(value, name: name)
    }

    private func environment(_ name: String, fallback: String) -> String {
        ProcessInfo.processInfo.environment[name].flatMap { $0.isEmpty ? nil : $0 } ?? fallback
    }

    private func environmentList(_ name: String, fallback: [String]) -> [String] {
        environment(name, fallback: fallback.joined(separator: ",")).split(separator: ",").map(String.init)
    }
}

private enum CaptureCase: String, CaseIterable {
    case ride, transfer, final
    case unknownPlatform = "unknown-platform"
    case tightTransfer = "tight-transfer"
    case offlineStale = "offline-stale"
    case longContent = "long-content"
    case missedConnection = "missed-connection"
    case firstLegCancelled = "first-leg-cancelled"
    case finalLegCancelled = "final-leg-cancelled"

    var facts: [String] {
        switch self {
        case .ride:
            ["Central", "Platform 21", "Platform 26", "7 min to change", "Kellyville", "about 05:46"]
        case .transfer:
            ["M1 leaves", "Platform 26", "Tallawong", "Departs 04:56", "Kellyville", "about 05:46"]
        case .final:
            ["Kellyville", "Platform 2", "about 05:46"]
        case .unknownPlatform:
            ["Kellyville", "Get off at Kellyville", "about 05:46"]
        case .tightTransfer:
            ["M1 leaves", "Platform 26", "Tallawong", "Tight change", "04:53", "Kellyville", "about 05:46"]
        case .offlineStale:
            ["Central", "Platform 21", "Platform 26", "7 min to change", "Kellyville", "about 05:46", "Offline", "Last updated 04:42"]
        case .longContent:
            ["Bondi Junction", "Platform 21", "Platform 26", "Kellyville", "about 05:46"]
        case .missedConnection:
            ["M1 connection unavailable", "M1 departure 04:41", "04:43 arrival", "Kellyville", "Planned 05:24"]
        case .firstLegCancelled:
            ["T8 cancelled", "from Mascot", "Kellyville", "05:46"]
        case .finalLegCancelled:
            ["M1 cancelled", "from Central", "Kellyville", "Cancelled", "planned 05:46"]
        }
    }
}
