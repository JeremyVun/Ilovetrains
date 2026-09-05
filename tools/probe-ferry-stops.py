#!/usr/bin/env python3
"""Capture the Trip Planner hub for each GTFS boarding stop served by ferries."""

import argparse
import csv
import datetime
import io
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request
import zipfile


def main():
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--zip', type=Path, default=root / '.gtfs/ferries.zip')
    parser.add_argument('--out', type=Path, default=root / 'tools/fixtures/ferry_stop_mapping.json')
    args = parser.parse_args()
    key = os.environ.get('TFNSW_API_KEY')
    if not key:
        raise SystemExit('TFNSW_API_KEY must already be exported')
    with zipfile.ZipFile(args.zip) as bundle:
        def rows(member):
            return list(csv.DictReader(io.StringIO(bundle.read(member).decode('utf-8-sig'))))
        routes = {r['route_id'] for r in rows('routes.txt')
                  if int(r['route_type']) in {4, 1200} or 1000 <= int(r['route_type']) <= 1099}
        trips = {t['trip_id'] for t in rows('trips.txt') if t['route_id'] in routes}
        served = {s['stop_id'] for s in rows('stop_times.txt') if s['trip_id'] in trips}
        feed = rows('feed_info.txt')
    captured = {'capturedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                'feedInfo': feed, 'queries': {}}
    for stop_id in sorted(served):
        query = urllib.parse.urlencode(dict(outputFormat='rapidJSON', type_sf='any',
            name_sf=stop_id, coordOutputFormat='EPSG:4326', TfNSWSF='true'))
        request = urllib.request.Request('https://api.transport.nsw.gov.au/v1/tp/stop_finder?' + query,
            headers={'Authorization': 'apikey ' + key})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.load(response)
        matches = [s for s in data.get('locations', [])
                   if s.get('type') == 'stop' and 9 in s.get('modes', []) and s.get('isBest')]
        if len(matches) != 1:
            raise SystemExit(f'{stop_id}: expected one best ferry stop, got {len(matches)}')
        captured['queries'][stop_id] = data
        print(f'{stop_id}: {matches[0]["id"]} {matches[0]["disassembledName"]}', flush=True)
        time.sleep(0.25)
    args.out.write_text(json.dumps(captured, indent=2) + '\n')
    print(f'{len(served)} boarding stops captured in {args.out}')


if __name__ == '__main__':
    main()
