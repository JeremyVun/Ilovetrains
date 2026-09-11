import Foundation
import XCTest
@testable import ILoveTrains

final class TransferRecoveryConformanceTests: XCTestCase {
    private let keys = [
        "followedChanges", "composedChanges", "recoveryAnchor", "search", "candidate", "composed",
        "status", "pinIcon", "changeLabels", "receipt", "instruction", "arrival", "figure",
        "provenance", "alert",
    ].sorted()

    func testEveryTransferRecoveryCaseCarriesTheWholeSeam() throws {
        let url = try XCTUnwrap(Bundle(for: TransferRecoveryConformanceTests.self)
            .url(forResource: "transfer-recovery", withExtension: "json"))
        let root = try XCTUnwrap(
            JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any])
        XCTAssertTrue((root["notes"] as! String).contains("printed clock minutes"))
        XCTAssertGreaterThanOrEqual(((root["base"] as! [String: Any])["legs"] as! [Any]).count, 2)
        let cases = root["cases"] as! [[String: Any]]
        XCTAssertFalse(cases.isEmpty)
        for item in cases {
            let name = item["name"] as! String
            XCTAssertNotNil(item["now"] as? NSNumber, name)
            XCTAssertNotNil(item["fresh"] as? Bool, name)
            XCTAssertTrue(["focus", "inferred"].contains(item["by"] as! String), name)
            XCTAssertNotNil(item["searches"] as? [Any], name)
            XCTAssertEqual((item["expected"] as! [String: Any]).keys.sorted(), keys, name)
        }
    }
}
