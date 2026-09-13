# Habit learning

Stage: implementation and verification. Jeremy selected this improvement on
2026-09-13 and authorized commit, push and deployment to web, Android and iOS.

A single day of repeated board checks must not outweigh a habit across days.
For each trip direction and local date, use the strongest existing time/day/
recency-weighted contribution. Preserve raw history and storage compatibility.
A history winner needs two contributing dates and a 0.25 final-score lead over
the next candidate. Otherwise retain location/home, last-viewed and first-trip
fallbacks. Explicit choices and pins retain controller precedence. Habit
receipts require three matching dates. Keep existing wording and layout.

The exact rule lives in docs/contracts/client-storage.md and ui.md. No weekday
refinement, timing-kernel change, ride inference, analytics vocabulary or
replacement-trip implementation is part of this release.
