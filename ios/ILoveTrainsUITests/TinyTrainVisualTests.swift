import XCTest

final class TinyTrainVisualTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor
    func testPassAndRepeatTapInBothSchemes() {
        let app = XCUIApplication()
        app.launchArguments = ["--calibration", "home"]
        app.launchEnvironment["ILOVETRAINS_TEST_DOMAIN"] = UUID().uuidString
        app.launch()
        XCTAssertTrue(app.staticTexts["Central"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["tiny-train-trigger"].exists, "Flag-off Home must retain its original accessibility grouping")
        app.terminate()

        for calibration in ["home", "home-light"] {
            app.launchArguments = ["--calibration", calibration, "--tiny-train"]
            app.launchEnvironment["ILOVETRAINS_TEST_DOMAIN"] = UUID().uuidString
            app.launch()

            let trigger = app.buttons["tiny-train-trigger"]
            XCTAssertTrue(trigger.waitForExistence(timeout: 5), "Tiny-train trigger must be exposed")
            XCTAssertEqual(trigger.label, "Run a tiny train")
            XCTAssertEqual(trigger.value as? String, "Ready")
            XCTAssertGreaterThanOrEqual(trigger.frame.height, 44)
            let laneFrame = trigger.frame

            XCTAssertTrue(app.staticTexts["Central"].exists)
            XCTAssertTrue(app.staticTexts["Parramatta"].exists)
            XCTAssertTrue(app.staticTexts["PLATFORM 12"].exists)

            let passStart = Date()
            trigger.tap()
            XCTAssertEqual(trigger.value as? String, "Running")
            XCTAssertEqual(trigger.frame, laneFrame)
            Thread.sleep(forTimeInterval: max(0, 1.3 - Date().timeIntervalSince(passStart)))
            attach(app.screenshot(), name: "tiny-train-\(calibration)-passing")

            trigger.tap()
            XCTAssertEqual(trigger.value as? String, "Running", "A repeat tap must not restart the pass")
            XCTAssertEqual(trigger.frame, laneFrame)
            attach(app.screenshot(), name: "tiny-train-\(calibration)-repeat-tap")

            XCTAssertTrue(trigger.waitForReady(timeout: 1.8), "A repeat tap must not restart the 2.6-second pass")
            app.terminate()
        }
    }

    @MainActor
    func testReducedMotionShowsCompleteConsistInBothSchemes() {
        let app = XCUIApplication()
        for calibration in ["home", "home-light"] {
            app.launchArguments = ["--calibration", calibration, "--tiny-train", "--tiny-train-reduced-motion"]
            app.launchEnvironment["ILOVETRAINS_TEST_DOMAIN"] = UUID().uuidString
            app.launch()
            let trigger = app.buttons["tiny-train-trigger"]
            XCTAssertTrue(trigger.waitForExistence(timeout: 5))
            trigger.tap()
            attach(app.screenshot(), name: "tiny-train-\(calibration)-reduced-complete")
            XCTAssertTrue(trigger.waitForReady(timeout: 2))
            app.terminate()
        }
    }

    private func attach(_ screenshot: XCUIScreenshot, name: String) {
        let attachment = XCTAttachment(screenshot: screenshot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}

private extension XCUIElement {
    func waitForReady(timeout: TimeInterval) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        repeat {
            if value as? String == "Ready" { return true }
            Thread.sleep(forTimeInterval: 0.05)
        } while Date() < deadline
        return value as? String == "Ready"
    }
}
