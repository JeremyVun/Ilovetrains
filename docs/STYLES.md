# Visual design language

Status: **intent only** — the concrete design language (type, color, layout)
gets decided via a design-comps round before any UI is built. Record the
verdict here when it lands.

## Intent

- **Glanceable above all.** The primary read is one number: minutes until
  the next train. It should be legible from a phone at arm's length on a
  station platform in sunlight. Platform number is the secondary read.
- **Calm, not busy.** No banners, no cards-within-cards, no chrome. The
  departure board is the screen.
- **Fast is beautiful.** Content renders instantly from cache; live updates
  slide in without layout shift. No spinners on the happy path; a subtle
  freshness indicator instead.
- **Honest states.** Delays, cancellations, stale/offline data are visually
  distinct, never buried. Scheduled-only (no realtime) is distinguishable
  from on-time.
- **Sydney, lightly.** Line identity (T1 orange, M1 teal, …) may be used as
  accent, using official TfNSW line colors; otherwise restrained palette.
- Dark-mode first (commuters at 6am and 6pm), light mode supported.
