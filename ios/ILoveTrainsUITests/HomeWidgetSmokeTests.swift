import XCTest

/// Places the widget and sets the home screen style through SpringBoard. Opt-in: HOME_WIDGET_SMOKE=1 (TEST_RUNNER_HOME_WIDGET_SMOKE=1 via xcodebuild).
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

    /// Picks a home screen style (HOME_WIDGET_STYLE, such as Tinted or Default) through Edit → Customize.
    @MainActor
    func testSetsHomeScreenStyle() {
        let style = ProcessInfo.processInfo.environment["HOME_WIDGET_STYLE"] ?? "Default"
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.72)).press(forDuration: 1.6)
        tap(NSPredicate(format: "label ==[c] %@", "Edit"), step: "edit")
        tap(NSPredicate(format: "label ==[c] %@ OR label ==[c] %@", "Customize", "Customise"), step: "customise")
        Thread.sleep(forTimeInterval: 2)
        let option = springboard.descendants(matching: .any).matching(NSPredicate(format: "label ==[c] %@", style)).firstMatch
        XCTAssertTrue(option.waitForExistence(timeout: 8), dump("style"))
        option.tap()
        Thread.sleep(forTimeInterval: 2)
        print(dump("styled"))
        springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.15)).tap()
        Thread.sleep(forTimeInterval: 1)
        let done = springboard.buttons.matching(NSPredicate(format: "label ==[c] %@", "Done")).firstMatch
        if done.exists { done.tap() }
        Thread.sleep(forTimeInterval: 2)
    }

    /// Places the rectangular lock screen widget through the lock screen editor, which PosterBoard draws.
    @MainActor
    func testAddsLockScreenWidget() {
        if !posterBoard.staticTexts["Add Widgets"].exists {
            let lock = NSSelectorFromString("pressLockButton")
            XCUIDevice.shared.perform(lock)
            Thread.sleep(forTimeInterval: 2)
            XCUIDevice.shared.perform(lock)
            Thread.sleep(forTimeInterval: 2)
            springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.6)).press(forDuration: 1.6)
            Thread.sleep(forTimeInterval: 2)
            editorTap(["Customize", "Customise"], step: "customise")
            let choice = editorElement(["Lock Screen"], contains: true)
            if choice.exists { choice.tap(); Thread.sleep(forTimeInterval: 2) }
            let reticle = posterBoard.buttons["grouped-widgets-reticle-view"].firstMatch
            XCTAssertTrue(reticle.waitForExistence(timeout: 8), dump("add-widgets", in: posterBoard))
            reticle.tap()
            Thread.sleep(forTimeInterval: 2)
            let app = editorElement(["ilovetrains"], contains: false)
            for _ in 0..<6 where !app.exists {
                posterBoard.swipeUp()
                Thread.sleep(forTimeInterval: 1)
            }
            XCTAssertTrue(app.waitForExistence(timeout: 8), dump("gallery-app", in: posterBoard))
            app.tap()
            Thread.sleep(forTimeInterval: 2)
            let widget = posterBoard.buttons.matching(NSPredicate(format: "value ==[c] %@", "Widget, Rectangular")).firstMatch
            XCTAssertTrue(widget.waitForExistence(timeout: 8), dump("gallery-widget", in: posterBoard))
            widget.tap()
            Thread.sleep(forTimeInterval: 2)
        }
        // The gallery sheet stays open after a tap adds the widget; dragging it away uncovers the editor's Done.
        let grabber = posterBoard.buttons["Sheet Grabber"].firstMatch
        if grabber.exists {
            grabber.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5))
                .press(forDuration: 0.1, thenDragTo: posterBoard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 1.0)))
            Thread.sleep(forTimeInterval: 2)
        }
        let done = posterBoard.buttons["editing-done"].firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 8), dump("done", in: posterBoard))
        done.tap()
        Thread.sleep(forTimeInterval: 3)
        print(dump("placed", in: posterBoard))
    }

    /// Leaves the lock screen awake for `simctl io screenshot`.
    @MainActor
    func testShowsLockScreen() {
        let lock = NSSelectorFromString("pressLockButton")
        XCUIDevice.shared.perform(lock)
        Thread.sleep(forTimeInterval: 2)
        XCUIDevice.shared.perform(lock)
        Thread.sleep(forTimeInterval: 3)
    }

    /// Shoots the lock screen for each scenario folder in HOME_WIDGET_SEEDS, copied into HOME_WIDGET_GROUP, into HOME_WIDGET_CAPTURES.
    /// Seeding and locking alternate inside one run because launching the app unlocks the phone.
    @MainActor
    func testCapturesLockScreenScenarios() throws {
        let environment = ProcessInfo.processInfo.environment
        guard let seeds = environment["HOME_WIDGET_SEEDS"], let group = environment["HOME_WIDGET_GROUP"],
              let captures = environment["HOME_WIDGET_CAPTURES"] else {
            throw XCTSkip("Set HOME_WIDGET_SEEDS, HOME_WIDGET_GROUP and HOME_WIDGET_CAPTURES")
        }
        let suffix = environment["HOME_WIDGET_SUFFIX"] ?? "dark"
        let files = FileManager.default
        let scenarios = try files.contentsOfDirectory(atPath: seeds).filter { !$0.hasPrefix(".") }.sorted()
        let lock = NSSelectorFromString("pressLockButton")
        for scenario in scenarios {
            for name in ["widget-v1.json", "widget-debug-seed.json"] {
                let target = URL(fileURLWithPath: group).appendingPathComponent(name)
                try? files.removeItem(at: target)
                try files.copyItem(at: URL(fileURLWithPath: seeds).appendingPathComponent(scenario).appendingPathComponent(name), to: target)
            }
            let app = XCUIApplication()
            app.launchEnvironment["ILOVETRAINS_WIDGET_RELOAD"] = "1"
            app.launch()
            Thread.sleep(forTimeInterval: 3)
            app.terminate()
            XCUIDevice.shared.perform(lock)
            Thread.sleep(forTimeInterval: 2)
            XCUIDevice.shared.perform(lock)
            Thread.sleep(forTimeInterval: 6)
            try XCUIScreen.main.screenshot().pngRepresentation
                .write(to: URL(fileURLWithPath: captures).appendingPathComponent("lock-\(scenario)-\(suffix).png"))
        }
    }

    /// Unlocks to the home screen for `simctl io screenshot`.
    @MainActor
    func testShowsHomeScreen() {
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 1)
        XCUIDevice.shared.press(.home)
        Thread.sleep(forTimeInterval: 2)
    }

    private let posterBoard = XCUIApplication(bundleIdentifier: "com.apple.PosterBoard")

    private func editorElement(_ labels: [String], contains: Bool) -> XCUIElement {
        let format = labels.map { _ in contains ? "label CONTAINS[c] %@" : "label ==[c] %@" }.joined(separator: " OR ")
        let predicate = NSPredicate(format: format, argumentArray: labels)
        let inPoster = posterBoard.descendants(matching: .any).matching(predicate).firstMatch
        return inPoster.exists ? inPoster : springboard.descendants(matching: .any).matching(predicate).firstMatch
    }

    private func editorTap(_ labels: [String], step: String, contains: Bool = false) {
        var element = editorElement(labels, contains: contains)
        let deadline = Date().addingTimeInterval(8)
        while !element.exists && Date() < deadline {
            Thread.sleep(forTimeInterval: 0.5)
            element = editorElement(labels, contains: contains)
        }
        XCTAssertTrue(element.exists, dump(step, in: posterBoard) + "\n" + dump(step))
        element.tap()
        Thread.sleep(forTimeInterval: 2)
    }

    private func tap(_ predicate: NSPredicate, step: String) {
        let element = springboard.buttons.matching(predicate).firstMatch
        XCTAssertTrue(element.waitForExistence(timeout: 8), dump(step))
        element.tap()
    }

    private func dump(_ step: String, in app: XCUIApplication? = nil) -> String {
        "step \(step)\n" + (app ?? springboard).debugDescription
    }
}
