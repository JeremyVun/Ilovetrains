#!/usr/bin/env python3
"""Seed a round-1 comps scenario into the iOS widget on a simulator (Debug builds only).

Writes widget-v1.json (the app's snapshot) and widget-debug-seed.json (boards that
answer in place of the network, and the scenario clock) into the App Group
container, then relaunches the app with ILOVETRAINS_WIDGET_RELOAD=1 so WidgetKit
asks for a new timeline without the app publishing over the seed.

    seed-widget.py --device UDID --scenario live
    seed-widget.py --device UDID --clear      # back to the live network

Scenarios come from the comps workshop's wdata.js (SCEN): live, late, cxl, sched,
stale, pinned, riding, home, ferry, long, none, nodata, empty, wide.
"""
import argparse
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone

SYDNEY = timezone(timedelta(hours=10))
DAY = "2026-09-23"
APP = "com.ilovetrains.ios"
GROUP = "group.com.ilovetrains.ios"


def scenarios(workshop):
    script = ("const fs=require('fs');const src=fs.readFileSync(process.argv[1],'utf8');"
              "process.stdout.write(JSON.stringify(new Function(src+';return SCEN;')()));")
    out = subprocess.run(["node", "-e", script, os.path.join(workshop, "wdata.js")],
                         check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def millis(hhmm, seconds=0):
    return int(datetime.fromisoformat(f"{DAY}T{hhmm}:00").replace(tzinfo=SYDNEY).timestamp() * 1000) + seconds * 1000


def station(name, mode):
    return {"id": "seed-" + name.lower().replace(" ", "-"), "name": name, "lat": 0, "lon": 0, "modes": [mode]}


def journey(row, origin, destination, mode, cancelled=False):
    delay = millis(row["dep"]) - millis(row["depWas"]) if row.get("depWas") else 0
    realtime = not row.get("sched")
    legs, t = [], millis(row["dep"])
    changes = row.get("chg") or []
    dwells = row.get("dwells") or []
    for index, part in enumerate(row["legs"]):
        start = origin if index == 0 else station(changes[index - 1]["at"], mode)
        end = destination if index == len(row["legs"]) - 1 else station(changes[index]["at"], mode)
        arrive = t + part["mins"] * 60_000
        shift = delay if index == 0 else 0
        leg = {
            "line": part["code"], "mode": mode,
            "headsign": row.get("head") if index == 0 and row.get("head") else end["name"],
            "from": start, "to": end,
            "departure": t - shift, "arrival": arrive - shift,
            "fromPlatform": row["plat"] if index == 0 else (changes[index - 1]["pOut"] or None),
            "toPlatform": row.get("arrPlat") or None if index == len(row["legs"]) - 1 else (changes[index]["pIn"] or None),
            "cancelled": cancelled and index == 0,
        }
        if realtime:
            leg["estimatedDeparture"], leg["estimatedArrival"] = t, arrive
        legs.append({k: v for k, v in leg.items() if v is not None})
        t = arrive + (dwells[index]["mins"] * 60_000 if index < len(dwells) else 0)
    return {"legs": legs}


def board(origin, destination, journeys, updated):
    return {"from": origin, "to": destination, "journeys": journeys, "generatedAt": updated,
            "source": "live", "offline": False, "serverStale": False, "coverage": "", "requestMaxTransfers": None}


def build(scene):
    now = millis(scene["now"], 36)
    if scene["state"] == "empty":
        return {"schemaVersion": 1, "writtenAt": now, "trips": [], "schedule": [], "modes": ["train", "metro", "ferry"],
                "transferCap": None, "boards": []}, {"now": now, "boards": []}
    mode = scene["mode"]
    origin, destination = station(scene["from"], mode), station(scene["to"], mode)
    rows = [scene["lead"]] if scene.get("lead") else []
    rows += scene.get("following") or []
    journeys = [journey(row, origin, destination, mode) for row in rows]
    if scene.get("cancelled"):
        gone = dict(scene["lead"], dep=scene["cancelled"]["dep"], depWas="", dwells=[{"mins": 7}])
        journeys.insert(0, journey(gone, origin, destination, mode, cancelled=True))
    journeys.sort(key=lambda j: j["legs"][0].get("estimatedDeparture", j["legs"][0]["departure"]))
    source = scene.get("src") or {}
    updated = millis(source["updated"]) if source.get("updated") else now
    stop = lambda s: {"id": s["id"], "name": s["name"], "modes": s["modes"]}
    trip = {"id": "seed-trip", "from": stop(origin), "to": stop(destination)}
    hour = now - now % 3_600_000
    snapshot = {
        "schemaVersion": 1, "writtenAt": now, "trips": [trip],
        "schedule": [{"at": hour + h * 3_600_000, "tripId": "seed-trip", "reverse": False} for h in range(168)],
        "modes": ["train", "metro", "ferry"], "transferCap": None, "boards": [],
    }
    fetched = [board(origin, destination, journeys, updated)]
    if source.get("kind") == "offline":
        fetched = []
        if source.get("updated"):
            snapshot["boards"] = [board(origin, destination, journeys, updated)]
    if scene["pin"] and scene.get("lead"):
        lead = journey(scene["lead"], origin, destination, mode)
        arrival = lead["legs"][-1].get("estimatedArrival", lead["legs"][-1]["arrival"])
        snapshot["focus"] = {"tripId": "seed-trip", "reverse": False, "pinned": True, "journey": lead,
                             "board": board(origin, destination, [lead], updated), "expiresAt": arrival + 1_800_000}
    return snapshot, {"now": now, "boards": fetched}


def container(device):
    return subprocess.run(["xcrun", "simctl", "get_app_container", device, APP, GROUP],
                          check=True, capture_output=True, text=True).stdout.strip()


def reload(device):
    subprocess.run(["xcrun", "simctl", "terminate", device, APP], capture_output=True)
    subprocess.run(["xcrun", "simctl", "launch", device, APP], check=True, capture_output=True,
                   env=dict(os.environ, SIMCTL_CHILD_ILOVETRAINS_WIDGET_RELOAD="1"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--device", required=True)
    parser.add_argument("--scenario")
    parser.add_argument("--workshop", default="/private/tmp/ilt-5e0c1f-widget-comps-r1")
    parser.add_argument("--clear", action="store_true")
    parser.add_argument("--no-reload", action="store_true")
    args = parser.parse_args()
    group = container(args.device)
    seed_path = os.path.join(group, "widget-debug-seed.json")
    if args.clear:
        if os.path.exists(seed_path):
            os.remove(seed_path)
    else:
        snapshot, seed = build(scenarios(args.workshop)[args.scenario])
        with open(os.path.join(group, "widget-v1.json"), "w") as handle:
            json.dump(snapshot, handle)
        with open(seed_path, "w") as handle:
            json.dump(seed, handle)
    if not args.no_reload:
        reload(args.device)
    print(group)


if __name__ == "__main__":
    main()
