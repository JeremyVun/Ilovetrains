#!/usr/bin/env node
/* Builds the baked station index both clients search. See tools/README.md. */

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { get } from 'node:https';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const BUNDLES = [
  { name: 'sydneytrains', mode: 'train', url: 'https://api.transport.nsw.gov.au/v1/gtfs/schedule/sydneytrains' },
  { name: 'nswtrains', mode: 'train', url: 'https://api.transport.nsw.gov.au/v1/gtfs/schedule/nswtrains' },
  // v2, not v1: the v1 metro bundle is frozen at the 2024 North West line and
  // has none of the City section stations.
  { name: 'metro', mode: 'metro', url: 'https://api.transport.nsw.gov.au/v2/gtfs/schedule/metro' }
];

const MODE_ORDER = ['train', 'metro'];

/* GTFS route_type: 1/2 basic rail, 100–117 extended rail, 400–405 urban rail.
   NSW TrainLink's coaches are 204/205 and are what this keeps out. */
function isRail(routeType) {
  const t = Number(routeType);
  return t === 1 || t === 2 || (t >= 100 && t <= 117) || (t >= 400 && t <= 405);
}

function splitCsvLine(line) {
  const fields = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') { field += '"'; i++; }
      else quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields;
}

async function* readRows(zip, member) {
  const child = spawn('unzip', ['-p', zip, member], { stdio: ['ignore', 'pipe', 'inherit'] });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let header = null;
  for await (const raw of lines) {
    const line = header === null ? raw.replace(/^﻿/, '') : raw;
    if (!line.trim()) continue;
    const fields = splitCsvLine(line);
    if (header === null) {
      header = fields.map((f) => f.trim());
      continue;
    }
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = fields[i] ?? '';
    yield row;
  }
  const code = await new Promise((resolve) => child.on('close', resolve));
  if (code !== 0) throw new Error(`unzip -p ${zip} ${member} exited ${code}`);
}

async function collect(zip, member, fn) {
  const out = new Set();
  for await (const row of readRows(zip, member)) fn(row, out);
  return out;
}

async function railStations(zip) {
  const routes = await collect(zip, 'routes.txt', (r, out) => {
    if (isRail(r.route_type)) out.add(r.route_id);
  });
  const trips = await collect(zip, 'trips.txt', (r, out) => {
    if (routes.has(r.route_id)) out.add(r.trip_id);
  });

  const parentOf = new Map();
  const stations = new Map();
  for await (const stop of readRows(zip, 'stops.txt')) {
    parentOf.set(stop.stop_id, stop.parent_station || stop.stop_id);
    if (stop.location_type === '1') {
      stations.set(stop.stop_id, {
        id: stop.stop_id,
        name: stop.stop_name.trim(),
        location: { lat: round6(stop.stop_lat), lon: round6(stop.stop_lon) }
      });
    }
  }

  const served = new Map();
  for await (const time of readRows(zip, 'stop_times.txt')) {
    if (!trips.has(time.trip_id)) continue;
    const parent = parentOf.get(time.stop_id) ?? time.stop_id;
    const station = stations.get(parent);
    if (station) served.set(parent, station);
  }
  return served;
}

function round6(value) {
  return Math.round(Number(value) * 1e6) / 1e6;
}

async function download(url, target) {
  const key = process.env.TFNSW_API_KEY;
  if (!key) throw new Error('TFNSW_API_KEY is not set; use --from-dir to build from downloaded bundles');
  await new Promise((resolve, reject) => {
    get(url, { headers: { Authorization: `apikey ${key}` } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GET ${url} returned ${res.statusCode}`));
        return;
      }
      const file = createWriteStream(target);
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    }).on('error', reject);
  });
}

function serialise(stations) {
  const lines = stations.map((s) => `  ${JSON.stringify(s)}`);
  return `[\n${lines.join(',\n')}\n]\n`;
}

async function main() {
  const fromDirFlag = process.argv.indexOf('--from-dir');
  const dir = fromDirFlag >= 0 ? process.argv[fromDirFlag + 1] : join(ROOT, '.gtfs');
  await mkdir(dir, { recursive: true });

  const merged = new Map();
  for (const bundle of BUNDLES) {
    const zip = join(dir, `${bundle.name}.zip`);
    if (fromDirFlag < 0) await download(bundle.url, zip);
    const stations = await railStations(zip);
    process.stderr.write(`${bundle.name}: ${stations.size} rail stations\n`);
    for (const [id, station] of stations) {
      const existing = merged.get(id);
      if (existing) existing.modes.add(bundle.mode);
      else merged.set(id, { ...station, modes: new Set([bundle.mode]) });
    }
  }

  const stations = [...merged.values()]
    .map((s) => ({
      id: s.id,
      name: s.name,
      modes: MODE_ORDER.filter((m) => s.modes.has(m)),
      location: s.location
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const json = serialise(stations);
  for (const target of [join(ROOT, 'web', 'stations.json'), join(ROOT, 'internal', 'stations', 'stations.json')]) {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, json);
  }

  const odd = stations.filter((s) => !s.name.endsWith('Station'));
  process.stderr.write(`${stations.length} stations written\n`);
  for (const s of odd) process.stderr.write(`  name does not end in Station: ${s.id} ${s.name}\n`);
}

await main();
