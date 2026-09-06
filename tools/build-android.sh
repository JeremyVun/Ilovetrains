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
mkdir -p releases
cp app/build/outputs/apk/release/app-release.apk releases/ilovetrains-1.0.0.apk
"$ANDROID_HOME/build-tools/36.0.0/apksigner" verify releases/ilovetrains-1.0.0.apk
shasum -a 256 releases/ilovetrains-1.0.0.apk > releases/ilovetrains-1.0.0.apk.sha256
mkdir -p "$project_dir/web/downloads"
cp releases/ilovetrains-1.0.0.apk "$project_dir/web/downloads/ilovetrains-1.0.0.apk"
chmod 644 releases/ilovetrains-1.0.0.apk releases/ilovetrains-1.0.0.apk.sha256 \
  "$project_dir/web/downloads/ilovetrains-1.0.0.apk"
printf 'Installable APK: %s/android/releases/ilovetrains-1.0.0.apk\n' "$project_dir"
