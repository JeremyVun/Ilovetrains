# ilovetrains icon

Sleepers was selected on 9 September 2026 for its immediate railway cue and
four-colour motif. `sleepers.svg` is the canonical vector; `sleepers-1024.png`
is its opaque square native export, without a baked-in system corner mask.

PNG SHA-256: `4b21719de7dbb39e7398aed436215530a131925223d9ab77b71b85069ce7c218`.
SVG SHA-256: `b9103abffe50f8a43f89dec7722ff6b1bf164453f0bef9513bf6888a14a85774`.
Render platform sizes from these sources. Preserve colours and geometry;
validate actual OS masking rather than drawing simulated corner treatments.

Run `bash tools/make-icons.sh` from the repository root. It renders the PWA
icons directly from the SVG, copies the locked PNG to the iOS AppIcon catalog,
and writes Android's existing adaptive-safe launcher foreground. The PWA
maskable and Android foreground marks use the established 62% safe scale;
other outputs use the full drawing.
