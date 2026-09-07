#!/usr/bin/env python3
"""Read a probe-gtfs.py capture offline. See tools/README.md.

Uses gtfs-realtime-bindings (tested 2.2.0); standard fields only, so TfNSW
extensions are not interpreted. Exact trip IDs and static stop membership
are diagnostics, NOT proof of service-date, stop-sequence or platform joins.
"""
import argparse
from collections import Counter
import csv
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import zipfile

from google.transit import gtfs_realtime_pb2 as pb


def iso(timestamp):
    return dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture', type=Path)
    args = parser.parse_args()
    records = json.loads((args.capture / 'capture.json').read_text())
    indexes = {}
    report = []
    for record in records:
        item = dict(record)
        report.append(item)
        if record.get('status') != 200:
            continue
        path = args.capture / record['file']
        body = path.read_bytes()
        if hashlib.sha256(body).hexdigest() != record['sha256']:
            raise SystemExit(f'Hash mismatch: {path.name}')
        source = path.stem.split('-')[0]
        if path.suffix == '.zip':
            with zipfile.ZipFile(io.BytesIO(body)) as z:
                def rows(name):
                    if name not in z.namelist():
                        return []
                    with z.open(name) as f:
                        return list(csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig')))
                trips = rows('trips.txt')
                stops = rows('stops.txt')
                indexes[source] = ({r['trip_id'] for r in trips}, {r['stop_id'] for r in stops})
                item['static'] = {
                    'tripRows': len(trips), 'uniqueTrips': len(indexes[source][0]),
                    'stops': len(stops), 'routes': rows('routes.txt'),
                    'feedInfo': rows('feed_info.txt'),
                    'uncompressedBytes': sum(i.file_size for i in z.infolist()),
                    'memberBytes': {i.filename: i.file_size for i in z.infolist()},
                }
        else:
            feed = pb.FeedMessage()
            feed.ParseFromString(body)
            if not feed.IsInitialized():
                raise SystemExit(f'Missing required protobuf fields: {path.name}')
            updates = [e.trip_update for e in feed.entity if e.HasField('trip_update')]
            static_trips, static_stops = indexes[source]
            unmatched = [u.trip.trip_id for u in updates if u.trip.trip_id not in static_trips]
            stop_updates = [s for u in updates for s in u.stop_time_update]
            received = dt.datetime.fromisoformat(record['receivedAt']).timestamp()
            stamps = [u.timestamp for u in updates if u.HasField('timestamp')]
            item['realtime'] = {
                'version': feed.header.gtfs_realtime_version,
                'incrementality': pb.FeedHeader.Incrementality.Name(feed.header.incrementality),
                'sourceTimestamp': iso(feed.header.timestamp) if feed.header.HasField('timestamp') else None,
                'sourceAgeSeconds': round(received - feed.header.timestamp, 2) if feed.header.HasField('timestamp') else None,
                'entities': len(feed.entity), 'tripUpdates': len(updates),
                'alerts': sum(e.HasField('alert') for e in feed.entity),
                'tripRelationships': dict(Counter(pb.TripDescriptor.ScheduleRelationship.Name(u.trip.schedule_relationship) for u in updates)),
                'startDates': dict(Counter(u.trip.start_date for u in updates)),
                'exactTripMatches': len(updates) - len(unmatched),
                'unmatchedTripExamples': unmatched[:8],
                'stopUpdates': len(stop_updates),
                'stopIdsPresent': sum(s.HasField('stop_id') for s in stop_updates),
                'stopIdsInStatic': sum(s.stop_id in static_stops for s in stop_updates),
                'stopSequencesPresent': sum(s.HasField('stop_sequence') for s in stop_updates),
                'stopRelationships': dict(Counter(pb.TripUpdate.StopTimeUpdate.ScheduleRelationship.Name(s.schedule_relationship) for s in stop_updates)),
                'tripTimestampRange': [iso(min(stamps)), iso(max(stamps))] if stamps else None,
                'tripTimestampsPresent': len(stamps),
            }
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
