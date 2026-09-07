#!/usr/bin/env bash
# Build a debug APK, or --release with a persistent local signing identity.
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home ]; then
  export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
fi
cd "$project_dir/android"
if [ "${1:-}" != --release ]; then
  exec ./gradlew :app:assembleDebug :app:testDebugUnitTest :app:lintDebug --console=plain
fi
signing_dir="${ILOVETRAINS_SIGNING_DIR:-$HOME/.local/share/ilovetrains/android-signing}"
mkdir -p "$signing_dir"
chmod 700 "$signing_dir"
export ILOVETRAINS_KEYSTORE="$signing_dir/release.p12"
export ILOVETRAINS_KEYSTORE_PASSWORD_FILE="$signing_dir/password.txt"
if [ ! -f "$ILOVETRAINS_KEYSTORE" ]; then
  umask 077
  if [ ! -f "$ILOVETRAINS_KEYSTORE_PASSWORD_FILE" ]; then
    openssl rand -hex 32 > "$ILOVETRAINS_KEYSTORE_PASSWORD_FILE"
  fi
  "${JAVA_HOME:+$JAVA_HOME/bin/}keytool" -genkeypair -keystore "$ILOVETRAINS_KEYSTORE" \
    -storetype PKCS12 -alias ilovetrains -keyalg RSA -keysize 3072 -validity 10000 \
    -dname 'CN=ilovetrains, OU=Android' -storepass:file "$ILOVETRAINS_KEYSTORE_PASSWORD_FILE" \
    -keypass:file "$ILOVETRAINS_KEYSTORE_PASSWORD_FILE" -noprompt
fi
umask 022
./gradlew :app:assembleRelease :app:testReleaseUnitTest :app:lintRelease --console=plain
app_version="$(node --input-type=module -e "import { VERSION } from '../web/js/version.js'; process.stdout.write(VERSION)")"
apk_name="ilovetrains-${app_version}.apk"
mkdir -p releases
cp app/build/outputs/apk/release/app-release.apk "releases/$apk_name"
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify "releases/$apk_name"
shasum -a 256 "releases/$apk_name" > "releases/$apk_name.sha256"
mkdir -p "$project_dir/web/downloads"
chmod 755 "$project_dir/web/downloads"
cp "releases/$apk_name" "$project_dir/web/downloads/$apk_name"
chmod 644 "releases/$apk_name" "releases/$apk_name.sha256" "$project_dir/web/downloads/$apk_name"
printf 'Installable APK: %s/android/releases/%s\n' "$project_dir" "$apk_name"
