# Android C1 and cab

Built-client calibration at 390×844 dp, font scale 1.0, in both schemes.
The two `412-font1.3` frames check the shorter phone with enlarged text.
These replace illustrative geometry for native review; clocks and journeys
are synthetic fixtures in `UiCalibrationTest`.

Reproduce with `tools/shoot-android.sh 390x844`, selecting
`CALIBRATION_SCREENS=c1-transfer-before,c1-transfer-during,c1-transfer-after,c1-cab`
and their `-light` variants. Use `FONT_SCALE=1.3` and `412x732` for the large-text
pair. Set `ANDROID_SERIAL` to the owned emulator and `OUT` to a temporary path.
