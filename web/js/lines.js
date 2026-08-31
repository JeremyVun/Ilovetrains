/* TfNSW line colours, keyed by the badge code the API returns in `line.name`
   (the full line name is not in the response, so the badge is all we have).
   [verify] M1 and the intercity codes were matched from the comps round, not
   from an official TfNSW document — confirm before relying on them. */

const COLOURS = {
  T1: '#F99D1C', T2: '#0098CD', T3: '#F37021', T4: '#005AA3',
  T5: '#C4258F', T7: '#6F818E', T8: '#00954C', T9: '#D11F2F',
  M1: '#168388',
  BMT: '#F99D1C', CCN: '#D11F2F', SCO: '#0098CD', SHL: '#00954C', HUN: '#833134'
};

const FALLBACK = 'rgba(244,245,247,0.66)';

export function lineColour(code) {
  if (!code) return FALLBACK;
  return COLOURS[String(code).toUpperCase()] || FALLBACK;
}
