#!/usr/bin/env python3
"""Capture schedules/GTFS-R without logging credentials; see tools/README.md.

Requires TFNSW_API_KEY in the process environment. Never reads .env.
Writes into a NEW output directory. Standard library only. No retries, no
redirects (so Authorization cannot escape the TfNSW API origin), bounded
requests. Error bodies and request headers are never saved or printed.
"""

import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request


BASE = 'https://api.transport.nsw.gov.au'
FEEDS = {
    'sydneytrains': ('v1', 'v2', 'sydneytrains'),
    'nswtrains': ('v1', 'v1', 'nswtrains'),
    'metro': ('v2', 'v2', 'metro'),
    'ferries': ('v1', 'v1', 'ferries/sydneyferries'),
    'mff': ('v1', 'v1', 'ferries/MFF'),
}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--rounds', type=int, choices=range(1, 4), default=2)
    p.add_argument('--interval', type=float, default=20)
    args = p.parse_args()
    if args.interval < 15:
        p.error('--interval must be at least 15 seconds')
    key = os.environ.get('TFNSW_API_KEY')
    if not key:
        p.error('TFNSW_API_KEY must already be exported')
    args.out.mkdir(parents=True, exist_ok=False)
    opener = urllib.request.build_opener(NoRedirect())
    captures = []

    def capture(name, endpoint):
        started = dt.datetime.now(dt.timezone.utc)
        record = {'file': name, 'url': BASE + endpoint,
                  'requestedAt': started.isoformat()}
        request = urllib.request.Request(BASE + endpoint, headers={
            'Authorization': 'apikey ' + key, 'Accept-Encoding': 'identity'})
        try:
            with opener.open(request, timeout=45) as response:
                body = response.read(128 * 1024 * 1024 + 1)
                if len(body) > 128 * 1024 * 1024:
                    raise ValueError('body size limit')
                # Defensive guard: never persist an echoed credential.
                if key.encode() in body:
                    raise ValueError('credential echo')
                (args.out / name).write_bytes(body)
                record.update(status=response.status, bytes=len(body),
                    sha256=hashlib.sha256(body).hexdigest(),
                    gzipBytes=len(gzip.compress(body, mtime=0)),
                    headers={h: response.headers[h] for h in (
                        'Date', 'Content-Type', 'Content-Encoding', 'ETag',
                        'Last-Modified', 'Cache-Control') if h in response.headers})
        except urllib.error.HTTPError as error:
            record['status'] = error.code
        except Exception as error:
            record['error'] = type(error).__name__
        record['receivedAt'] = dt.datetime.now(dt.timezone.utc).isoformat()
        captures.append(record)
        (args.out / 'capture.json').write_text(json.dumps(captures, indent=2) + '\n')
        print(json.dumps(record), flush=True)
        time.sleep(0.3)

    for name, (static_version, _, path) in FEEDS.items():
        capture(name + '.zip', f'/{static_version}/gtfs/schedule/{path}')
    for round_number in range(args.rounds):
        if round_number:
            time.sleep(args.interval)
        for name, (_, realtime_version, path) in FEEDS.items():
            capture(f'{name}-{round_number}.pb', f'/{realtime_version}/gtfs/realtime/{path}')
        if round_number == 0:
            for name in ('sydneytrains', 'nswtrains', 'metro', 'ferries'):
                capture(f'{name}-alerts.pb', f'/v2/gtfs/alerts/{name}')
    if any(c.get('status') != 200 for c in captures):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
