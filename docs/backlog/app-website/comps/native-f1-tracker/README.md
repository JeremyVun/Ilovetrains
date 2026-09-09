# Current-renderer F1 website captures

These frames were captured from the real SwiftUI app on the owned
`Codex-r9-activity-47800` iPhone 17 Pro simulator running iOS 26.4. Both PNGs
are complete 1206×2622 system screenshots at 402×874 points and 3× scale.

- `tracker-dark.png`: dark app appearance.
- `tracker-light.png`: light app appearance.
- Matching WebPs use `cwebp -lossless -exact -m 6`. Decoding each WebP and
  comparing RGBA pixels with Pillow produced no differing pixel.

The frame fixes the app clock eight minutes into the captured F1 journey:
Circular Quay 15:45 to Manly Wharf 16:07. The production renderer derives
14 minutes remaining and 8/22 (36.4%) progress. The travelled left 36.4% of
the line is visibly dimmed in both schemes; the remaining portion keeps the
full route colour.

The source was copied from checkout commit
`427b27c20d2070b3791ac8f455bfd262340af0d3`. `source-hashes.txt` records the
exact checkout hashes for `TrainViewModel.swift`, `Common.swift`,
`JourneyAxisLayout.swift`, and `HomeView.swift`. The clean UI files were copied
unchanged. `marketing-fixture.patch` is the only scratch source delta; it
selects the existing captured F1 journey, fixes the eight-minute presentation
clock, and assembles the existing four saved-trip rows. The bundled
`calibration.json` SHA-256 is
`8f5ffaeae5c38a2f145e2db09243d13adddb271b81718b5c85131c1a0ebbf5ec`.

Reproduction from the isolated scratch copy:

```sh
ILOVETRAINS_SIMULATOR_ID="$OWNED_SIMULATOR_ID" \
ILOVETRAINS_IOS_BUILD_DIR=/tmp/trains-site-material-r9-f1-current/build \
  /tmp/trains-site-material-r9-f1-current/tools/build-ios.sh --simulator

ILOVETRAINS_SIMULATOR_ID="$OWNED_SIMULATOR_ID" \
ILOVETRAINS_IOS_APP=/tmp/trains-site-material-r9-f1-current/build/Build/Products/Debug-iphonesimulator/ILoveTrains.app \
OUT=/tmp/trains-site-material-r9-f1-current/output \
  /tmp/trains-site-material-r9-f1-current/tools/shoot-ios.sh \
  marketing-ferry-active marketing-ferry-active-light
```

Hashes:

- dark PNG: `dcf1c5d8e651dfa041457380fbf2bcbc288497facf500a057a711d7555f4e90d`
- light PNG: `11d1ad99331def8d2dbc6a90abb30d2d569aee97998a496444a3538b376b817a`
- dark WebP: `4cba1a821e3e6925b8d9161b10c947b058fbdceee43a8160ac923b9a60024b22`
- light WebP: `29a888a49307df5d73c329bd13fc875c999c76ba5661396187dd8cb631087597`
- built Debug dylib: `195bc952d44aa3ec9bcc738940f8e21c0758f5f15742f327cf71762fbac0e950`
