# Eight-car Waratah cab reference

This cab-only design target corrects the tiny train to eight cars: two outward-facing driver cars and six square-ended middle cars. Every visible side has two yellow paired passenger doorways around a central upper/lower saloon window band; each terminal car keeps its passenger doors separate from its cab windscreen.

The anatomy follows Transport for NSW's [Waratah driving- and motor-car drawings](https://transportnsw.info/travel-info/ways-to-get-around/train/fleet-facilities/waratah-trains). These PNGs are design references for a product-code change, not captures of the current shipped train.

The rendered consist measures 327×18 CSS px: eight 40×18 cars and seven 1px gaps. Browser inspection found 8 cars, 2 driver cabs, 6 middle cars, 16 passenger doorways, 32 door leaves and 2 cab windscreens. The rear car uses `scaleX(-1)` and the front car is unreflected, so both cabs face outwards.

The four full frames are 2× captures at 390×844 and 412×732 in dark and light appearance. `zoom-cab-outward.png` is a 4× live-cascade crop of the complete consist.

The `source/` directory is a cab-only workshop containing the copied product stylesheet, composition CSS, renderer and capture config. From the repository root, reproduce all five images with:

```sh
verify_dir="$(mktemp -d /tmp/trains-comps-cab-verify.XXXXXX)"
cp -R assets/comps/latest/commute-feedback/cab/source/. "$verify_dir/"
node tools/comps/shoot.js "$verify_dir"
```
