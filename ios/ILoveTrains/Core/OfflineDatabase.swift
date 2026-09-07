import Foundation
import SQLite3

final class OfflineDatabase {
    private var handle: OpaquePointer?

    init(url: URL, readOnly: Bool = true) throws {
        let flags = (readOnly ? SQLITE_OPEN_READONLY : SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE) | SQLITE_OPEN_FULLMUTEX
        guard sqlite3_open_v2(url.path, &handle, flags, nil) == SQLITE_OK else {
            let message = handle.flatMap { String(cString: sqlite3_errmsg($0)) } ?? "Unable to open timetable"
            if let handle { sqlite3_close(handle) }
            handle = nil
            throw OfflineCoreError.sqlite(message)
        }
    }

    deinit { close() }

    func close() {
        if let handle {
            sqlite3_close(handle)
            self.handle = nil
        }
    }

    func rows(_ sql: String, bindings: [SQLiteBinding] = [], _ body: (OpaquePointer) throws -> Void) throws {
        guard let handle else { throw OfflineCoreError.notInitialized }
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &statement, nil) == SQLITE_OK, let statement else {
            throw OfflineCoreError.sqlite(String(cString: sqlite3_errmsg(handle)))
        }
        defer { sqlite3_finalize(statement) }
        for (offset, binding) in bindings.enumerated() {
            let result: Int32
            switch binding {
            case let .integer(value):
                result = sqlite3_bind_int64(statement, Int32(offset + 1), value)
            case let .text(value):
                result = sqlite3_bind_text(statement, Int32(offset + 1), value, -1, Self.transient)
            }
            guard result == SQLITE_OK else { throw OfflineCoreError.sqlite(String(cString: sqlite3_errmsg(handle))) }
        }
        while true {
            switch sqlite3_step(statement) {
            case SQLITE_ROW:
                try body(statement)
            case SQLITE_DONE:
                return
            default:
                throw OfflineCoreError.sqlite(String(cString: sqlite3_errmsg(handle)))
            }
        }
    }

    func scalarInt(_ sql: String) throws -> Int64? {
        var value: Int64?
        try rows(sql) { value = sqlite3_column_int64($0, 0) }
        return value
    }

    func scalarText(_ sql: String) throws -> String? {
        var value: String?
        try rows(sql) { value = Self.text($0, 0) }
        return value
    }

    static func text(_ statement: OpaquePointer, _ column: Int32) -> String? {
        sqlite3_column_text(statement, column).map { String(cString: $0) }
    }

    static func int(_ statement: OpaquePointer, _ column: Int32) -> Int {
        Int(sqlite3_column_int64(statement, column))
    }

    static func double(_ statement: OpaquePointer, _ column: Int32) -> Double {
        sqlite3_column_double(statement, column)
    }

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
}

enum SQLiteBinding {
    case integer(Int64)
    case text(String)
}
