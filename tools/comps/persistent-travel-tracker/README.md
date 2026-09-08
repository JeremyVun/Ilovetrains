# Accepted travel tracker comp source

Frozen round-4 Option 1, accepted 2026-09-08: short prose plus a quiet trip line.
This is design-reference code, not a product implementation. Its clocks,
instructions, colours and progress are fixed review fixtures.

[Selected frames](../../../assets/comps/latest/travel-tracker/README.md) and
[build handoff](../../../docs/backlog/persistent-travel-tracker/design.md).
`base.css` preserves the stylesheet used for the accepted pixels; do not refresh
it from current product CSS when reproducing that verdict.

To reproduce without writing generated output into the repository, from its root:

```sh
tracker_workshop=$(mktemp -d /tmp/travel-tracker-reference.XXXXXX)
cp tools/comps/persistent-travel-tracker/* "$tracker_workshop/"
node tools/comps/shoot.js "$tracker_workshop"
```

Read `tools/comps/README.md` for the instrument. The manifest produces 28 frames:
one concept, seven scenarios, two sizes, two schemes. It also defines a 4× line
clip. Open `c1-sentence.html?s=ontrain`, `?s=transfer` or `?s=final` in the copied
workshop for the selected stages. Browser composition is not native-renderer or
background execution evidence. Preserve the accepted geometry until a new
verdict or verified OS constraint changes it; replace this source with native
seeded capture coverage when the feature ships.
