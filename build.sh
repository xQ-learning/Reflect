#!/usr/bin/env bash
# Reflect 复盘 —— 构建 APK（纯 Android SDK 工具链，无 Gradle）
# 用法: ./build.sh [--debug]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
BT_VER="${BUILD_TOOLS_VERSION:-34.0.0}"
BT="$SDK/build-tools/$BT_VER"
PLATFORM="$SDK/platforms/android-34"
APP="$ROOT/app"
OUT="$ROOT/build"
APK_NAME="reflect.apk"

for tool in "$BT/aapt2" "$BT/d8" "$BT/zipalign" "$BT/apksigner"; do
  [ -x "$tool" ] || { echo "缺少工具: $tool" >&2; exit 1; }
done
[ -f "$PLATFORM/android.jar" ] || { echo "缺少 $PLATFORM/android.jar" >&2; exit 1; }
[ -d "$APP/assets" ] || { echo "缺少 app/assets（前端资源）" >&2; exit 1; }

KEYSTORE="$ROOT/keystore/reflect.jks"
KS_PASS="reflect123"
ALIAS="reflect"

echo "==> 清理"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/dex"

echo "==> 编译资源"
"$BT/aapt2" compile --dir "$APP/res" -o "$OUT/res.zip"

echo "==> 链接资源 + assets"
"$BT/aapt2" link \
  -o "$OUT/base.apk" \
  -I "$PLATFORM/android.jar" \
  --manifest "$APP/AndroidManifest.xml" \
  --java "$OUT/gen" \
  --min-sdk-version 24 \
  --target-sdk-version 34 \
  -A "$APP/assets" \
  "$OUT/res.zip"

echo "==> 编译 Java"
find "$APP/src" -name '*.java' > "$OUT/sources.txt"
find "$OUT/gen" -name '*.java' >> "$OUT/sources.txt"
set +e
javac -nowarn -encoding UTF-8 \
  -source 8 -target 8 \
  -bootclasspath "$PLATFORM/android.jar" \
  -classpath "$PLATFORM/android.jar" \
  -d "$OUT/classes" \
  @"$OUT/sources.txt" > "$OUT/javac.log" 2>&1
JAVAC_RC=$?
set -e
grep -v 'bootstrap class path' "$OUT/javac.log" | grep -v '^Note:' || true
if [ $JAVAC_RC -ne 0 ]; then
  echo "编译失败，详见 $OUT/javac.log" >&2
  exit 1
fi

echo "==> dex"
"$BT/d8" --lib "$PLATFORM/android.jar" --min-api 24 --output "$OUT/dex" \
  $(find "$OUT/classes" -name '*.class')

echo "==> 打包"
cp "$OUT/base.apk" "$OUT/unsigned.apk"
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes.dex)

echo "==> 对齐"
"$BT/zipalign" -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

if [ ! -f "$KEYSTORE" ]; then
  echo "==> 生成签名密钥"
  mkdir -p "$(dirname "$KEYSTORE")"
  keytool -genkeypair -keystore "$KEYSTORE" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Reflect, OU=xQ-learning, O=Reflect, L=, ST=, C=CN" >/dev/null 2>&1
fi

echo "==> 签名"
"$BT/apksigner" sign \
  --ks "$KEYSTORE" --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --out "$OUT/$APK_NAME" "$OUT/aligned.apk"

"$BT/apksigner" verify "$OUT/$APK_NAME"

SIZE=$(du -h "$OUT/$APK_NAME" | cut -f1)
echo "==> 完成: $OUT/$APK_NAME ($SIZE)"
echo "    安装: adb install -r $OUT/$APK_NAME"
