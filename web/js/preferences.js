export const SUPPORTED_MODES = ['train', 'metro', 'ferry'];

const APPEARANCES = new Set(['system', 'light', 'dark']);
const MODE_SET = new Set(SUPPORTED_MODES);
const TRAIN_LINES = new Set(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'BMT', 'CCN', 'SCO', 'SHL', 'HUN']);
const FERRY_LINES = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'MFF']);

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function locationOf(value) {
  return value && Number.isFinite(value.lat) && Number.isFinite(value.lon)
    ? { lat: value.lat, lon: value.lon } : null;
}

function homeOverrideOf(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || typeof value.id !== 'string' || value.id === ''
      || typeof value.name !== 'string' || value.name === '') return null;
  if (own(value, 'location') && !locationOf(value.location)) return null;
  const out = { id: value.id, name: value.name };
  const location = locationOf(value.location);
  if (location) out.location = location;
  return out;
}

export function normalizeModes(value) {
  if (!Array.isArray(value)) return [...SUPPORTED_MODES];
  const selected = new Set(value.filter((mode) => MODE_SET.has(mode)));
  return SUPPORTED_MODES.filter((mode) => selected.has(mode));
}

export function preferencesOf(doc) {
  const raw = doc && doc.preferences && typeof doc.preferences === 'object'
    && !Array.isArray(doc.preferences) ? doc.preferences : {};
  const out = {
    appearance: APPEARANCES.has(raw.appearance) ? raw.appearance : 'system',
    useLocation: typeof raw.useLocation === 'boolean' ? raw.useLocation : true,
    enabledModes: normalizeModes(raw.enabledModes)
  };
  const homeOverride = homeOverrideOf(raw.homeOverride);
  if (homeOverride) out.homeOverride = homeOverride;
  return out;
}

export function setPreferences(doc, patch = {}) {
  const previous = preferencesOf(doc);
  const next = { ...previous };
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    if (own(patch, 'appearance')) {
      if (APPEARANCES.has(patch.appearance)) next.appearance = patch.appearance;
    }
    if (own(patch, 'useLocation') && typeof patch.useLocation === 'boolean') {
      next.useLocation = patch.useLocation;
    }
    if (own(patch, 'enabledModes')) next.enabledModes = normalizeModes(patch.enabledModes);
    if (own(patch, 'homeOverride')) {
      const homeOverride = homeOverrideOf(patch.homeOverride);
      if (homeOverride) next.homeOverride = homeOverride;
      else delete next.homeOverride;
    }
  }
  return { ...doc, preferences: next };
}

function modeOf(line) {
  const mode = String(line && line.mode || '').toLowerCase();
  if (mode) return mode;
  const name = String(line && line.name || '').toUpperCase();
  if (name === 'M1') return 'metro';
  if (TRAIN_LINES.has(name)) return 'train';
  if (FERRY_LINES.has(name)) return 'ferry';
  return null;
}

function serviceModes(journey) {
  const legs = Array.isArray(journey && journey.legDetail) && journey.legDetail.length
    ? journey.legDetail : [journey];
  return legs.map((leg) => modeOf(leg && leg.line)).filter((mode) => mode !== 'walk');
}

export function journeyAllowed(journey, modes) {
  if (!journey) return false;
  const enabled = new Set(normalizeModes(modes));
  if (!enabled.size) return false;
  const allServed = enabled.size === SUPPORTED_MODES.length;
  const services = serviceModes(journey);
  return services.length > 0 && services.every((mode) => mode ? enabled.has(mode) : allServed);
}

export function filterBody(body, modes) {
  const source = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const journeys = Array.isArray(source.journeys) ? source.journeys : [];
  return { ...source, journeys: journeys.filter((journey) => journeyAllowed(journey, modes)) };
}
