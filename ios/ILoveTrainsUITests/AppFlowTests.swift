import XCTest

final class AppFlowTests: XCTestCase {
    override func setUpWithError() throws { continueAfterFailure = false }

    @MainActor
    func testBoardDetailPinAndSettingsFlow() {
        let app = XCUIApplication()
        app.launchArguments = ["--calibration", "home"]
        app.launch()
        let trip = app.buttons["trip-calibration-trip"]
        XCTAssertTrue(trip.waitForExistence(timeout: 5)); trip.tap()
        let service = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'service-'")).firstMatch
        XCTAssertTrue(service.waitForExistence(timeout: 5)); service.tap()
        let pin = app.buttons["pin-this-train"]
        XCTAssertTrue(pin.waitForExistence(timeout: 5)); pin.tap()
        let unpin = app.buttons["unpin-home"]
        XCTAssertTrue(unpin.waitForExistence(timeout: 5)); unpin.tap()
        XCTAssertFalse(unpin.exists)
        app.buttons["settings"].tap()
        app.buttons["appearance-light"].tap()
        XCTAssertTrue(app.buttons["appearance-light"].isSelected)
        app.buttons["service-train"].tap()
        app.buttons["service-metro"].tap()
        app.buttons["service-ferry"].tap()
        app.buttons["back"].tap()
        XCTAssertTrue(app.buttons["change-settings"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["trip-calibration-trip"].exists)
    }

    @MainActor
    func testCreatesNewTripAndReopensEntirelyOffline() {
        let app = XCUIApplication()
        app.launchArguments = ["--offline"]
        app.launchEnvironment["ILOVETRAINS_TEST_DOMAIN"] = UUID().uuidString
        app.launch()
        let origin = app.textFields["from-station-search"]
        XCTAssertTrue(origin.waitForExistence(timeout: 10)); origin.tap(); origin.typeText("Mascot")
        let mascot = app.buttons["station-202010"]
        XCTAssertTrue(mascot.waitForExistence(timeout: 5)); mascot.tap()
        let destination = app.textFields["to-station-search"]
        XCTAssertTrue(destination.waitForExistence(timeout: 5)); destination.tap(); destination.typeText("Kellyville")
        let kellyville = app.buttons["station-2155382"]
        XCTAssertTrue(kellyville.waitForExistence(timeout: 5)); kellyville.tap()
        app.buttons["save-trip"].tap()
        let trip = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'trip-'")).firstMatch
        XCTAssertTrue(trip.waitForExistence(timeout: 10)); trip.tap()
        let service = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'service-'")).firstMatch
        XCTAssertTrue(service.waitForExistence(timeout: 25))
        XCTAssertTrue(app.staticTexts["OFFLINE"].exists || app.staticTexts["SCHEDULED"].exists)
        service.tap()
        XCTAssertTrue(app.buttons["pin-this-train"].waitForExistence(timeout: 5))
        app.buttons["pin-this-train"].tap()
        XCTAssertTrue(app.buttons["unpin-home"].waitForExistence(timeout: 5))
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["unpin-home"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'trip-'")).firstMatch.exists)
    }

    @MainActor
    func testSwipeRevealsDeleteAndUndoRestoresRow() {
        let app = XCUIApplication()
        app.launchArguments = ["--calibration", "home-two-trips"]
        app.launch()
        let row = app.buttons["trip-second-trip"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))

        row.swipeUp()
        XCTAssertFalse(app.buttons["Delete"].exists, "A vertical swipe on the row scrolls; it does not reveal Delete")
        XCTAssertTrue(row.exists)

        row.coordinate(withNormalizedOffset: CGVector(dx: 0.9, dy: 0.5))
            .press(forDuration: 0.1, thenDragTo: row.coordinate(withNormalizedOffset: CGVector(dx: 0.45, dy: 0.5)))
        let delete = app.buttons["Delete"]
        XCTAssertTrue(delete.waitForExistence(timeout: 3))
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = "home-deleting"; shot.lifetime = .keepAlways
        add(shot)

        delete.tap()
        let undo = app.buttons["message-undo"]
        XCTAssertTrue(undo.waitForExistence(timeout: 3))
        XCTAssertFalse(row.exists)
        XCTAssertTrue(app.staticTexts["Rhodes → Bondi Junction deleted"].exists)
        undo.tap()
        XCTAssertTrue(row.waitForExistence(timeout: 3))
        XCTAssertFalse(undo.exists)
    }

    @MainActor
    func testFeedbackDraftSurvivesSettingsNavigationWithoutSending() {
        let app = XCUIApplication()
        app.launchArguments = ["--calibration", "settings"]
        app.launch()
        let feedback = app.buttons["send-feedback"]
        if !feedback.isHittable { app.swipeUp() }
        XCTAssertTrue(feedback.waitForExistence(timeout: 5)); feedback.tap()
        let field = app.textViews["feedback-message"]
        XCTAssertTrue(field.waitForExistence(timeout: 5)); field.tap(); field.typeText("Draft kept on this phone")
        app.buttons["back"].tap(); app.buttons["back"].tap()
        app.buttons["settings"].tap()
        if !app.buttons["send-feedback"].isHittable { app.swipeUp() }
        app.buttons["send-feedback"].tap()
        XCTAssertEqual(app.textViews["feedback-message"].value as? String, "Draft kept on this phone")
    }

    @MainActor
    func testSettingsLocationRowStatesAndActions() {
        var rowHeight: CGFloat?
        rowHeight = checkLocationRow(calibration: "settings-off",
                                     label: "Use location, Location is not used, TURN ON",
                                     labelAfterTap: "Use location, Location needs permission, ALLOW",
                                     toggleValue: "Off", expectedHeight: rowHeight)
        rowHeight = checkLocationRow(calibration: "settings",
                                     label: "Use location, Location needs permission, ALLOW",
                                     labelAfterTap: "Use location, Location needs permission, ALLOW",
                                     toggleValue: nil, expectedHeight: rowHeight)
        rowHeight = checkLocationRow(calibration: "settings-blocked",
                                     label: "Use location, Location is blocked, OPEN SETTINGS ›",
                                     labelAfterTap: "Use location, Location is blocked, OPEN SETTINGS ›",
                                     toggleValue: nil, expectedHeight: rowHeight)
        _ = checkLocationRow(calibration: "settings-on",
                             label: "Use location, Nearby trips use location, TURN OFF",
                             labelAfterTap: "Use location, Location is not used, TURN ON",
                             toggleValue: "On", expectedHeight: rowHeight)
    }

    @MainActor
    private func checkLocationRow(calibration: String, label: String, labelAfterTap: String,
                                  toggleValue: String?, expectedHeight: CGFloat?) -> CGFloat {
        let app = XCUIApplication()
        app.launchArguments = ["--calibration", calibration]
        app.launch()
        let row = app.descendants(matching: .any)["location-setting"]
        XCTAssertTrue(row.waitForExistence(timeout: 5))
        XCTAssertEqual(row.label, label)
        XCTAssertEqual(row.elementType, toggleValue == nil ? .button : .toggle)
        if let toggleValue { XCTAssertEqual(row.value as? String, toggleValue) }
        XCTAssertFalse(app.staticTexts["Allow location to show nearby trips."].exists)
        XCTAssertFalse(app.buttons["Use my location"].exists)
        if let expectedHeight { XCTAssertEqual(row.frame.height, expectedHeight, accuracy: 0.5) }
        let height = row.frame.height
        row.tap()
        XCTAssertEqual(row.label, labelAfterTap)
        app.terminate()
        return height
    }
}
