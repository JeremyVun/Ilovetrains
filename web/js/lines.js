/* TfNSW service colours. Rail keys use the badge code from `line.name`;
   ferries share the FERRY key derived from `line.mode`.
   M1 is verified against the TfNSW Open Data Hub resources page (2026-09-05).
   [verify] The intercity codes were matched from the comps round, not from an
   official TfNSW document — confirm before relying on them.

   The values below are the DARK scheme's, and they are documentation: what the
   board actually paints is `var(--line-T1)`, because a line colour that is
   legible on #0A0B0D is not legible on paper (T1's #F99D1C is 1.9:1 on a light
   ground — unreadable as bare text). The light scheme's darkened variants live
   beside these in `web/app.css`, measured; `web/test/theme.test.js` fails if a
   code here has no custom property there, or if the dark value drifts. */

export const COLOURS = {
  T1: '#F99D1C', T2: '#0098CD', T3: '#F37021', T4: '#005AA3',
  T5: '#C4258F', T7: '#6F818E', T8: '#00954C', T9: '#D11F2F',
  M1: '#168388',
  BMT: '#F99D1C', CCN: '#D11F2F', SCO: '#0098CD', SHL: '#00954C', HUN: '#833134',
  FERRY: '#5AB031'
};

/* An unknown code gets the secondary ink rather than a colour it has not
   earned — and, being a variable too, it follows the scheme. */
const FALLBACK = 'var(--ink-2)';

export function colourKey(line) {
  if (String(line && line.mode || '').toLowerCase() === 'ferry') return 'FERRY';
  return String(line && line.name || '').toUpperCase();
}

export function lineColour(value) {
  const key = String(value || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(COLOURS, key) ? `var(--line-${key})` : FALLBACK;
}

/* A filled device keeps the official line colour. Only bare text on paper is
   darkened, because darkening the fill turns T1 brown. */
export function lineFill(value) {
  const key = String(value || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(COLOURS, key) ? `var(--line-fill-${key})` : FALLBACK;
}
