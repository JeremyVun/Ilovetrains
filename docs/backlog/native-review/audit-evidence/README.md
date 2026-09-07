# Audit probes

These probes assert current defects. They are **not** desired-behavior
regression tests and must not be copied unchanged into the app test suite.
No app source was edited to run them. Results are local, no-network probes;
they do not prove field frequency or the entire UI lifecycle.

From the repository root, stage `AuditClaimsTest.kt` under
`/tmp/trains-native-review-audit/code/com/ilovetrains/app/` and `init.gradle`
under `/tmp/trains-native-review-audit/`. Then, from `android/`:

```sh
env -u ILOVETRAINS_KEYSTORE -u ILOVETRAINS_KEYSTORE_PASSWORD_FILE \
  JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home \
  ANDROID_HOME=/Users/jeremy/Library/Android/sdk \
  ./gradlew :app:testDebugUnitTest \
  --tests com.ilovetrains.app.AuditClaimsTest \
  --init-script /tmp/trains-native-review-audit/init.gradle --console=plain
```

For the Swift probes, from the repository root:

```sh
swiftc ios/ILoveTrains/Core/TransitModels.swift \
  ios/ILoveTrains/Core/DeviceStore.swift ios/ILoveTrains/Core/AppState.swift \
  ios/ILoveTrains/Core/Prediction.swift ios/ILoveTrains/Core/OfflineRouter.swift \
  ios/ILoveTrains/Core/OfflineRealtime.swift ios/ILoveTrains/Core/TransitAPI.swift \
  docs/backlog/native-review/audit-evidence/main.swift \
  -o /tmp/trains-native-review-audit/swift-probes
/tmp/trains-native-review-audit/swift-probes
```

`source-sha256.json` records the source/contract files at the end of this audit;
it does not include credentials, build outputs or untracked private data.
The probes were read against the same working tree; this manifest is not a
claim that every listed file was individually audited.
