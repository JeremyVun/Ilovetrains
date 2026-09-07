import Foundation

let now = Date().timeIntervalSince1970 * 1000
func snapshot(_ header: Double, _ expiry: Double) -> String {
    """
    {"schemaVersion":1,"source":"source","headerTimestamp":\(header),"expiresAt":\(expiry),"updates":[]}
    """
}
var old = OfflineRealtime()
let acceptedOld = try old.accept(json: snapshot(now - 3_600_000, now + 3_600_000), expectedSource: "source", now: now)
precondition(acceptedOld)
print("A3 iOS: hour-old header with future payload expiry accepted")
var future = OfflineRealtime()
let acceptedFuture = try future.accept(json: snapshot(now + 86_400_000, now + 86_490_000), expectedSource: "source", now: now)
let acceptedCurrent = try future.accept(json: snapshot(now, now + 90_000), expectedSource: "source", now: now)
precondition(acceptedFuture && !acceptedCurrent)
print("A3 iOS: future header accepted, then valid current header rejected")
let apiDestination = try TransitWire.station(["id":"200060","name":"Central","platform":"1"])
let savedDestination = Station(id:"200060",name:"Central",lat:-33.884,lon:151.206)
let fix = Fix(lat:savedDestination.lat,lon:savedDestination.lon,at:now)
precondition(distanceMetres(fix, apiDestination).isInfinite && distanceMetres(fix, savedDestination) == 0)
print("B2 iOS: distance to API leg endpoint is infinite; saved endpoint is zero at destination")
let empty = try JSONDecoder().decode(Journey.self, from: Data(#"{"legs":[]}"#.utf8))
precondition(empty.legs.isEmpty)
print("F8 iOS: persisted empty Journey decodes; caller guards mean a Home crash is not established")
let hugeLeg = Leg(line:"T1",mode:"train",headsign:"Central",from:savedDestination,to:savedDestination,
                  departure:1e20,arrival:1e20)
let huge = try JSONDecoder().decode(Journey.self, from: JSONEncoder().encode(Journey(legs:[hugeLeg])))
precondition(huge.departure.isFinite && huge.departure > Double(Int.max))
print("F8 iOS: finite out-of-Int-range departure round-trips; BoardRow's Int conversion is unsafe (trap not executed)")
let nonfinite = try? JSONDecoder().decode(Double.self, from: Data("1e999".utf8))
precondition(nonfinite == nil)
print("F8 correction: default JSONDecoder rejects overflowing/non-finite JSON number")
