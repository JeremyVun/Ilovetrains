import importlib.util
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "compile-timetable.py"
SPEC = importlib.util.spec_from_file_location("compile_timetable", SCRIPT)
COMPILER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(COMPILER)


class CompileTimetableTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.input = self.root / "input"
        self.input.mkdir()
        self.stations = self.root / "stations.json"
        self.stations.write_text(json.dumps([
            {"id": "A", "name": "Alpha Station", "modes": ["train", "metro", "ferry"], "location": {"lat": -33.0, "lon": 151.0}},
            {"id": "B", "name": "Bravo Station", "modes": ["train", "metro", "ferry"], "location": {"lat": -33.1, "lon": 151.1}},
        ]))
        self.mapping = self.root / "mapping.json"
        self.mapping.write_text(json.dumps({"queries": {
            "FA": {"locations": [{"id": "A", "isBest": True}]},
            "FB": {"locations": [{"id": "B", "isBest": True}]},
        }}))
        route_types = {"sydneytrains": 2, "nswtrains": 100, "metro": 401, "ferries": 4, "mff": 4}
        for source, route_type in route_types.items():
            self.write_feed(source, route_type)

    def tearDown(self):
        self.temporary.cleanup()

    def write_feed(self, source, route_type, missing_stop=False):
        ferry = source in {"ferries", "mff"}
        first = "MISSING" if missing_stop else ("FA" if ferry else "A1")
        second = "FB" if ferry else "B1"
        parent_a = "" if source == "ferries" or missing_stop else "A"
        parent_b = "" if source == "ferries" else "B"
        files = {
            "routes.txt": "route_id,agency_id,route_short_name,route_long_name,route_type,route_color\nR,{},L,Line,{},123456\n".format("SydneyTrains" if source == "sydneytrains" else "operator", route_type),
            "trips.txt": "route_id,service_id,trip_id,trip_headsign,direction_id\nR,S,T,Bravo,0\n",
            "calendar.txt": "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nS,1,1,1,1,1,1,1,20260101,20261231\n",
            "stops.txt": "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station,platform_code\n{},Alpha Platform 1,-33,151,0,{},1\n{},Bravo Platform 2,-33.1,151.1,0,{},2\n".format(first, parent_a, second, parent_b),
            "stop_times.txt": "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type\nT,25:10:00,25:10:00,{},1,{},1\nT,25:20:00,25:20:00,{},9,1,3\n".format(first, 0 if missing_stop else 2, second),
        }
        if source == "mff":
            files["calendar_dates.txt"] = "service_id,date,exception_type\nS,20261005,2\n"
        if source == "sydneytrains":
            files["routes.txt"] += "D,NSWTrains,NRC,Duplicate regional service,2,ffffff\nI,NSWTrains,CCN,Only source for this intercity line,2,ffffff\nO,SydneyTrains,,Out Of Service,2,ffffff\n"
        if source == "nswtrains":
            files["routes.txt"] += "C,operator,900,Coach,204,ffffff\n"
            files["trips.txt"] += "C,S,COACH,Nowhere,0\n"
            files["stop_times.txt"] += "COACH,10:00:00,10:00:00,A1,1,0,0\nCOACH,10:10:00,10:10:00,B1,2,0,0\n"
        with zipfile.ZipFile(self.input / f"{source}.zip", "w") as archive:
            for name, contents in files.items():
                archive.writestr(name, contents)

    def test_compiles_calendars_permissions_and_after_midnight_times(self):
        database = self.root / "timetable.sqlite3"
        counts = COMPILER.compile_database(self.input, database, self.stations, self.mapping)
        self.assertEqual(counts["connections"], 5)
        self.assertEqual(counts["service_exceptions"], 1)
        with sqlite3.connect(database) as connection:
            row = connection.execute(
                "SELECT departure_secs,arrival_secs,pickup_type,drop_off_type,from_sequence,to_sequence FROM connections LIMIT 1"
            ).fetchone()
            self.assertEqual(row, (90600, 91200, 2, 3, 1, 9))
            self.assertEqual(connection.execute("PRAGMA user_version").fetchone()[0], 1)
            self.assertEqual(connection.execute("SELECT count(*) FROM routes WHERE short_name='900'").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT count(*) FROM routes").fetchone()[0], 6)

    def test_package_is_reproducible_and_manifest_hashes_zip(self):
        first = COMPILER.write_package(self.input, self.root / "one", None, self.stations, self.mapping)
        second = COMPILER.write_package(self.input, self.root / "two", self.root / "assets", self.stations, self.mapping)
        self.assertEqual(first["sha256"], second["sha256"])
        manifest = json.loads((self.root / "two" / "manifest.json").read_text())
        self.assertEqual(manifest["packages"][0]["sha256"], second["sha256"])
        self.assertEqual(manifest["packages"][0]["source"], "network")
        self.assertEqual(zipfile.ZipFile(self.root / "assets" / "timetable.zip").namelist(), ["timetable.sqlite3"])

    def test_rejects_a_served_stop_without_real_station_mapping(self):
        self.write_feed("metro", 401, missing_stop=True)
        with self.assertRaisesRegex(ValueError, "no real station mapping"):
            COMPILER.compile_database(self.input, self.root / "bad.sqlite3", self.stations, self.mapping)


if __name__ == "__main__":
    unittest.main()
