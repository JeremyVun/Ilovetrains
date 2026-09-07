#!/usr/bin/env python3
"""Compile captured TfNSW GTFS feeds into the Android routing package."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import gzip
import hashlib
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import zipfile
from pathlib import Path
from zoneinfo import ZoneInfo


SCHEMA_VERSION = 1
SOURCES = ("sydneytrains", "nswtrains", "metro", "ferries", "mff")
MODE_BY_ROUTE_TYPE = {2: "train", 100: "train", 106: "train", 401: "metro", 4: "ferry"}
ALLOWED_TYPES = {
    "sydneytrains": {2},
    "nswtrains": {100, 106},
    "metro": {401},
    "ferries": {4},
    "mff": {4},
}
WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
PLATFORM_RE = re.compile(r"\bPlatform(?:s)?\s+([A-Za-z0-9-]+)", re.IGNORECASE)


def rows(archive: zipfile.ZipFile, name: str):
    if name not in archive.namelist():
        return iter(())
    stream = (line.decode("utf-8-sig") for line in archive.open(name))
    return csv.DictReader(stream)


def integer(value: str | None, default: int = 0) -> int:
    return int(value) if value not in (None, "") else default


def seconds(value: str) -> int:
    parts = value.split(":")
    if len(parts) != 3:
        raise ValueError(f"invalid GTFS time {value!r}")
    hour, minute, second = (int(part) for part in parts)
    if hour < 0 or minute not in range(60) or second not in range(60):
        raise ValueError(f"invalid GTFS time {value!r}")
    return hour * 3600 + minute * 60 + second


def compact_date(value: str) -> int:
    parsed = dt.datetime.strptime(value, "%Y%m%d").date()
    return parsed.year * 10000 + parsed.month * 100 + parsed.day


def load_stations(path: Path) -> dict[str, dict]:
    stations = json.loads(path.read_text())
    return {station["id"]: station for station in stations}


def load_ferry_mapping(path: Path) -> dict[str, str]:
    document = json.loads(path.read_text())
    result: dict[str, str] = {}
    for stop_id, query in document.get("queries", {}).items():
        best = [location for location in query.get("locations", []) if location.get("isBest")]
        if len(best) != 1 or not best[0].get("id"):
            raise ValueError(f"ferry stop {stop_id} has no unique best hub")
        result[stop_id] = str(best[0]["id"])
    return result


def schema(connection: sqlite3.Connection) -> None:
    connection.executescript(
        """
        PRAGMA application_id = 0x494c5452;
        PRAGMA user_version = 1;
        PRAGMA page_size = 4096;
        PRAGMA journal_mode = OFF;
        PRAGMA synchronous = OFF;
        PRAGMA temp_store = MEMORY;
        CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
        CREATE TABLE sources(id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
        CREATE TABLE stations(
          id TEXT PRIMARY KEY, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
          modes TEXT NOT NULL
        ) WITHOUT ROWID;
        CREATE TABLE stops(
          id INTEGER PRIMARY KEY, source INTEGER NOT NULL, stop_id TEXT NOT NULL,
          station_id TEXT NOT NULL, name TEXT NOT NULL, platform TEXT,
          lat REAL, lon REAL, UNIQUE(source, stop_id)
        );
        CREATE TABLE routes(
          id INTEGER PRIMARY KEY, source INTEGER NOT NULL, route_id TEXT NOT NULL,
          short_name TEXT NOT NULL, long_name TEXT NOT NULL, mode TEXT NOT NULL,
          color TEXT NOT NULL, UNIQUE(source, route_id)
        );
        CREATE TABLE services(
          id INTEGER PRIMARY KEY, source INTEGER NOT NULL, service_id TEXT NOT NULL,
          start_date INTEGER NOT NULL, end_date INTEGER NOT NULL, weekdays INTEGER NOT NULL,
          UNIQUE(source, service_id)
        );
        CREATE TABLE service_exceptions(
          service INTEGER NOT NULL, service_date INTEGER NOT NULL, exception_type INTEGER NOT NULL,
          PRIMARY KEY(service, service_date)
        ) WITHOUT ROWID;
        CREATE TABLE trips(
          id INTEGER PRIMARY KEY, source INTEGER NOT NULL, trip_id TEXT NOT NULL,
          route INTEGER NOT NULL, service INTEGER NOT NULL, headsign TEXT NOT NULL,
          direction_id INTEGER, UNIQUE(source, trip_id)
        );
        CREATE TABLE connections(
          trip INTEGER NOT NULL, from_sequence INTEGER NOT NULL, to_sequence INTEGER NOT NULL,
          from_stop INTEGER NOT NULL, to_stop INTEGER NOT NULL,
          departure_secs INTEGER NOT NULL, arrival_secs INTEGER NOT NULL,
          pickup_type INTEGER NOT NULL, drop_off_type INTEGER NOT NULL,
          PRIMARY KEY(trip, from_sequence)
        ) WITHOUT ROWID;
        """
    )


def source_generated_at(input_dir: Path) -> str:
    capture = input_dir / "capture.json"
    if not capture.exists():
        return "1970-01-01T00:00:00Z"
    static_files = {f"{source}.zip" for source in SOURCES}
    entries = [entry for entry in json.loads(capture.read_text()) if entry.get("file") in static_files]
    if len(entries) != len(SOURCES):
        raise ValueError("capture.json does not describe all five static feeds")
    value = max(entry["receivedAt"] for entry in entries)
    return value.replace("+00:00", "Z")


def trip_index_row(source: str, trip_id: str, first_departure: int, calendar: tuple[int, int, int], exceptions: list[tuple[int, int]]) -> bytes:
    if "\t" in trip_id or "\n" in trip_id:
        raise ValueError(f"{source} trip {trip_id!r} cannot be written to the trip index")
    start, end, mask = calendar
    added = ",".join(str(date) for date, exception in sorted(exceptions) if exception == 1)
    removed = ",".join(str(date) for date, exception in sorted(exceptions) if exception == 2)
    fields = (source, trip_id, str(first_departure), str(start), str(end), str(mask), added, removed)
    return ("\t".join(fields) + "\n").encode("utf-8")


def compile_database(input_dir: Path, database: Path, stations_path: Path, mapping_path: Path, trip_index: Path | None = None) -> dict:
    stations = load_stations(stations_path)
    ferry_mapping = load_ferry_mapping(mapping_path)
    connection = sqlite3.connect(database)
    schema(connection)
    index_file = open(trip_index, "wb") if trip_index is not None else None
    index_writer = gzip.GzipFile(filename="", mode="wb", fileobj=index_file, compresslevel=9, mtime=0) if index_file else None
    index_rows = 0
    connection.executemany(
        "INSERT INTO stations VALUES(?,?,?,?,?)",
        ((item["id"], item["name"], item["location"]["lat"], item["location"]["lon"], ",".join(item["modes"])) for item in stations.values()),
    )

    source_coverage: dict[str, dict[str, str]] = {}
    total_connections = 0
    for source_index, source in enumerate(SOURCES, 1):
        archive_path = input_dir / f"{source}.zip"
        if not archive_path.exists():
            raise FileNotFoundError(archive_path)
        archive = zipfile.ZipFile(archive_path)
        connection.execute("INSERT INTO sources VALUES(?,?)", (source_index, source))

        route_ids: dict[str, int] = {}
        for route in rows(archive, "routes.txt"):
            route_type = integer(route.get("route_type"), -1)
            if route_type not in ALLOWED_TYPES[source]:
                continue
            if source == "sydneytrains":
                line = route.get("route_short_name", "").strip()
                if not line or (route.get("agency_id") != "SydneyTrains" and line != "CCN"):
                    continue
            cursor = connection.execute(
                "INSERT INTO routes(source,route_id,short_name,long_name,mode,color) VALUES(?,?,?,?,?,?)",
                (source_index, route["route_id"], route.get("route_short_name", ""), route.get("route_long_name", ""), MODE_BY_ROUTE_TYPE[route_type], route.get("route_color", "")),
            )
            route_ids[route["route_id"]] = cursor.lastrowid

        calendars: dict[str, tuple[int, int, int]] = {}
        for calendar in rows(archive, "calendar.txt"):
            mask = sum((integer(calendar.get(day)) & 1) << index for index, day in enumerate(WEEKDAYS))
            calendars[calendar["service_id"]] = (compact_date(calendar["start_date"]), compact_date(calendar["end_date"]), mask)
        raw_exceptions: dict[str, list[tuple[int, int]]] = {}
        for exception in rows(archive, "calendar_dates.txt"):
            raw_exceptions.setdefault(exception["service_id"], []).append((compact_date(exception["date"]), integer(exception["exception_type"])))
        for service_id, exceptions in raw_exceptions.items():
            if service_id not in calendars:
                dates = [date for date, _ in exceptions]
                calendars[service_id] = (min(dates), max(dates), 0)

        eligible_trips = []
        used_services = set()
        for trip in rows(archive, "trips.txt"):
            if trip.get("route_id") not in route_ids:
                continue
            service_id = trip["service_id"]
            if service_id not in calendars:
                raise ValueError(f"{source} trip {trip['trip_id']} has no calendar")
            eligible_trips.append(trip)
            used_services.add(service_id)

        service_ids: dict[str, int] = {}
        for service_id in sorted(used_services):
            start, end, mask = calendars[service_id]
            cursor = connection.execute("INSERT INTO services(source,service_id,start_date,end_date,weekdays) VALUES(?,?,?,?,?)", (source_index, service_id, start, end, mask))
            service_ids[service_id] = cursor.lastrowid
            connection.executemany(
                "INSERT INTO service_exceptions VALUES(?,?,?)",
                ((cursor.lastrowid, date, kind) for date, kind in raw_exceptions.get(service_id, [])),
            )
        starts = [calendars[service][0] for service in used_services]
        ends = [calendars[service][1] for service in used_services]
        source_coverage[source] = {"startDate": str(min(starts)), "endDate": str(max(ends))}

        raw_stops = {stop["stop_id"]: stop for stop in rows(archive, "stops.txt")}
        served_stop_ids = set()
        regular_access: dict[str, bool] = {}
        trip_ids: dict[str, int] = {}
        for trip in eligible_trips:
            cursor = connection.execute(
                "INSERT INTO trips(source,trip_id,route,service,headsign,direction_id) VALUES(?,?,?,?,?,?)",
                (source_index, trip["trip_id"], route_ids[trip["route_id"]], service_ids[trip["service_id"]], trip.get("trip_headsign", ""), integer(trip.get("direction_id"), -1)),
            )
            trip_ids[trip["trip_id"]] = cursor.lastrowid

        for stop_time in rows(archive, "stop_times.txt"):
            trip_id = stop_time["trip_id"]
            if trip_id not in trip_ids:
                continue
            served_stop_ids.add(stop_time["stop_id"])
            regular_access[stop_time["stop_id"]] = regular_access.get(stop_time["stop_id"], False) or integer(stop_time.get("pickup_type")) == 0 or integer(stop_time.get("drop_off_type")) == 0

        stop_ids: dict[str, int] = {}
        for stop_id in sorted(served_stop_ids):
            stop = raw_stops.get(stop_id)
            if stop is None:
                raise ValueError(f"{source} serves missing stop {stop_id}")
            parent = stop.get("parent_station", "")
            candidates = (stop_id, parent)
            station_id = next((candidate for candidate in candidates if candidate in stations), None)
            if station_id is None and source == "ferries":
                station_id = ferry_mapping.get(stop_id) or ferry_mapping.get(parent)
            if station_id is None and source == "mff":
                station_id = parent if parent in stations else None
            if station_id not in stations and regular_access[stop_id]:
                raise ValueError(f"{source} served stop {stop_id} has no real station mapping")
            if station_id not in stations:
                station_id = f"@{source}:{stop_id}"
            platform = stop.get("platform_code", "").strip() or None
            if platform is None:
                match = PLATFORM_RE.search(stop.get("stop_name", ""))
                platform = match.group(1) if match else None
            cursor = connection.execute(
                "INSERT INTO stops(source,stop_id,station_id,name,platform,lat,lon) VALUES(?,?,?,?,?,?,?)",
                (source_index, stop_id, station_id, stop.get("stop_name", ""), platform, float(stop["stop_lat"]) if stop.get("stop_lat") else None, float(stop["stop_lon"]) if stop.get("stop_lon") else None),
            )
            stop_ids[stop_id] = cursor.lastrowid

        previous_trip = None
        completed = set()
        times: list[dict] = []
        batch = []
        first_departures: dict[str, int] = {}

        def flush_times(trip_id: str | None) -> None:
            nonlocal total_connections
            if trip_id is None:
                return
            times.sort(key=lambda item: integer(item["stop_sequence"]))
            opening = times[0].get("departure_time") or times[0].get("arrival_time")
            if opening:
                first_departures[trip_id] = seconds(opening)
            for left, right in zip(times, times[1:]):
                departure = seconds(left["departure_time"])
                arrival = seconds(right["arrival_time"])
                while arrival < departure:
                    arrival += 86400
                batch.append((trip_ids[trip_id], integer(left["stop_sequence"]), integer(right["stop_sequence"]), stop_ids[left["stop_id"]], stop_ids[right["stop_id"]], departure, arrival, integer(left.get("pickup_type")), integer(right.get("drop_off_type"))))
                if len(batch) >= 50_000:
                    connection.executemany("INSERT INTO connections VALUES(?,?,?,?,?,?,?,?,?)", batch)
                    total_connections += len(batch)
                    batch.clear()

        for stop_time in rows(archive, "stop_times.txt"):
            trip_id = stop_time["trip_id"]
            if trip_id not in trip_ids:
                continue
            if previous_trip is not None and trip_id != previous_trip:
                flush_times(previous_trip)
                times.clear()
                completed.add(previous_trip)
            if trip_id in completed:
                raise ValueError(f"{source} stop_times.txt is not grouped by trip_id")
            previous_trip = trip_id
            times.append(stop_time)
        flush_times(previous_trip)
        connection.executemany("INSERT INTO connections VALUES(?,?,?,?,?,?,?,?,?)", batch)
        total_connections += len(batch)
        connection.commit()

        if index_writer is not None:
            for trip in sorted(eligible_trips, key=lambda item: item["trip_id"]):
                first_departure = first_departures.get(trip["trip_id"])
                if first_departure is None:
                    continue
                index_writer.write(trip_index_row(source, trip["trip_id"], first_departure, calendars[trip["service_id"]], raw_exceptions.get(trip["service_id"], [])))
                index_rows += 1

    if index_writer is not None:
        index_writer.close()
        index_file.close()

    coverage_start = max(int(value["startDate"]) for value in source_coverage.values())
    coverage_end = min(int(value["endDate"]) for value in source_coverage.values())
    if coverage_start > coverage_end:
        raise ValueError("the five sources have no common timetable coverage")
    meta = {
        "schema_version": str(SCHEMA_VERSION),
        "service_date_from": str(coverage_start),
        "service_date_to": str(coverage_end),
        "source_coverage": json.dumps(source_coverage, sort_keys=True, separators=(",", ":")),
    }
    connection.executemany("INSERT INTO meta VALUES(?,?)", meta.items())
    connection.executescript(
        """
        CREATE INDEX stops_station ON stops(station_id);
        CREATE INDEX connections_departure ON connections(departure_secs);
        CREATE INDEX trips_service ON trips(service);
        CREATE INDEX exceptions_date ON service_exceptions(service_date, service);
        ANALYZE;
        VACUUM;
        """
    )
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    counts = {table: connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0] for table in ("stations", "stops", "routes", "services", "service_exceptions", "trips", "connections")}
    connection.close()
    if integrity != "ok":
        raise ValueError(f"compiled database failed integrity_check: {integrity}")
    counts["tripIndexRows"] = index_rows
    counts["coverageStart"] = str(coverage_start)
    counts["coverageEnd"] = str(coverage_end)
    counts["sourceCoverage"] = source_coverage
    return counts


def deterministic_zip(database: Path, destination: Path) -> str:
    with zipfile.ZipFile(destination, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        info = zipfile.ZipInfo("timetable.sqlite3", date_time=(1980, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        archive.writestr(info, database.read_bytes(), compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def write_package(input_dir: Path, output_dir: Path, android_assets: Path | None, stations_path: Path, mapping_path: Path) -> dict:
    output_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="ilovetrains-timetable-") as temporary:
        database = Path(temporary) / "timetable.sqlite3"
        draft_index = Path(temporary) / "trip-index.tsv.gz"
        counts = compile_database(input_dir, database, stations_path, mapping_path, draft_index)
        index_digest = hashlib.sha256(draft_index.read_bytes()).hexdigest()
        index_name = f"trip-index-{index_digest}.tsv.gz"
        index_path = output_dir / index_name
        os.replace(draft_index, index_path)
        draft_zip = Path(temporary) / "timetable.zip"
        digest = deterministic_zip(database, draft_zip)
        zip_name = f"{digest}.zip"
        package_path = output_dir / zip_name
        os.replace(draft_zip, package_path)
        generated_at = source_generated_at(input_dir)
        coverage_end = dt.datetime.strptime(counts["coverageEnd"], "%Y%m%d").date()
        expires_at = dt.datetime.combine(coverage_end, dt.time(23, 59, 59), ZoneInfo("Australia/Sydney"))
        manifest = {
            "schemaVersion": SCHEMA_VERSION,
            "generatedAt": generated_at,
            "expiresAt": expires_at.isoformat(timespec="seconds"),
            "serviceDateFrom": counts["coverageStart"],
            "serviceDateTo": counts["coverageEnd"],
            "packages": [{
                "source": "network",
                "schemaVersion": SCHEMA_VERSION,
                "sha256": digest,
                "url": f"/api/v1/timetable/packages/{digest}.zip",
                "bytes": package_path.stat().st_size,
                "serviceDateFrom": counts["coverageStart"],
                "serviceDateTo": counts["coverageEnd"],
            }],
            "tripIndex": {"name": index_name, "sha256": index_digest},
        }
        (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        if android_assets is not None:
            android_assets.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(package_path, android_assets / "timetable.zip")
            (android_assets / "timetable-manifest.json").write_text(json.dumps(manifest, separators=(",", ":")) + "\n")
        result = {"databaseBytes": database.stat().st_size, "packageBytes": package_path.stat().st_size, "sha256": digest, "tripIndexBytes": index_path.stat().st_size, "tripIndexSha256": index_digest, **counts}
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--android-assets", type=Path)
    parser.add_argument("--stations", type=Path, default=Path("internal/stations/stations.json"))
    parser.add_argument("--ferry-mapping", type=Path, default=Path("tools/fixtures/ferry_stop_mapping.json"))
    args = parser.parse_args()
    try:
        result = write_package(args.input_dir, args.output_dir, args.android_assets, args.stations, args.ferry_mapping)
    except (OSError, ValueError, KeyError, sqlite3.Error, zipfile.BadZipFile) as error:
        print(f"compile-timetable: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
