# Accepted commute-feedback comp source

This directory is the self-contained source for the remaining direct and
overdue-moving illustrative targets. It uses the existing `tools/comps` CDP
harness and writes no product state.

From the repository root, reproduce the eight targets and contact sheet in a
temporary workshop:

```sh
verify_dir="$(mktemp -d /tmp/trains-comps-commute-feedback-verify.XXXXXX)"
cp -R assets/comps/latest/commute-feedback/source/. "$verify_dir/"
node tools/comps/shoot.js "$verify_dir" --no-zooms
node tools/comps/sheet.js "$verify_dir"
```

Both scenarios are captured at 390×844 and 412×732 in dark and light.
The parent README identifies the built-client capture tools for the other states.
