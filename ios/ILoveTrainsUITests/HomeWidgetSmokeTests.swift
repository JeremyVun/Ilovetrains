import XCTest

/// Places the home widget through SpringBoard. Opt-in: HOME_WIDGET_SMOKE=1 (TEST_RUNNER_HOME_WIDGET_SMOKE=1 via xcodebuild).
final class HomeWidgetSmokeTests: XCTestCase {
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUpWithError() throws {
        continueAfterFailure = false
        guard ProcessInfo.processInfo.environment["HOME_WIDGET_SMOKE"] == "1" else {
            throw XCTSkip("Set HOME_WIDGET_SMOKE=1 to drive SpringBoard")
        }
    }

    @MainActor
    func testAddsHomeWidget() {
        XCUIApplication().launch()
        Thread.sleep(forTimeInterval: 6)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        if springboard.buttons["Done"].exists {
            springboard.buttons["Done"].tap()
            Thread.sleep(forTimeInterval: 1)
        }

        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.55)).press(forDuration: 1.6)
        tap(NSPredicate(format: "label ==[c] %@", "Edit"), step: "edit")
        tap(NSPredicate(format: "label ==[c] %@", "Add Widget"), step: "add-widget-menu")
        let search = springboard.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 8), dump("search"))
        search.tap()
        Thread.sleep(forTimeInterval: 1)
        search.typeText("ilovetrains")
        let result = springboard.cells.matching(NSPredicate(format: "label ==[c] %@", "ilovetrains")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 8), dump("result"))
        result.tap()
        let preview = springboard.buttons.matching(NSPredicate(format: "value BEGINSWITH[c] %@", "Widget,")).firstMatch
        XCTAssertTrue(preview.waitForExistence(timeout: 8), dump("preview"))
        for _ in 0..<Int(ProcessInfo.processInfo.environment["HOME_WIDGET_SWIPES"] ?? "0")! {
            preview.swipeLeft()
            Thread.sleep(forTimeInterval: 1)
        }
        // The gallery's button label carries a leading symbol.
        tap(NSPredicate(format: "label CONTAINS[c] %@", "Add Widget"), step: "add-widget")
        Thread.sleep(forTimeInterval: 1)
        tap(NSPredicate(format: "label ==[c] %@", "Done"), step: "done")
        Thread.sleep(forTimeInterval: 8)
        print(dump("placed"))
    }

    private func tap(_ predicate: NSPredicate, step: String) {
        let element = springboard.buttons.matching(predicate).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 8), dump(step))
        element.tap()
    }

    private func dump(_ step: String) -> String {
        "step \(step)\n" + springboard.debugDescription
    }
}
