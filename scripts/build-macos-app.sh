#!/bin/bash
set -e

# ========================================================
# 🍏 Build script for MoaCalendar.app (macOS Native App)
# Target: macOS 13.0+ (Apple Silicon arm64 & Intel x86_64)
# ========================================================

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACOS_DIR="${PROJECT_DIR}/macos"
BUILD_DIR="${MACOS_DIR}/build"
APP_NAME="MoaCalendar"
APP_BUNDLE="${BUILD_DIR}/${APP_NAME}.app"
CONTENTS_DIR="${APP_BUNDLE}/Contents"
MACOS_BIN_DIR="${CONTENTS_DIR}/MacOS"
RESOURCES_DIR="${CONTENTS_DIR}/Resources"

echo "🎨 1. Generating today's dynamic AppIcon.icns..."
mkdir -p "${MACOS_DIR}/Resources"
swiftc "${MACOS_DIR}/Sources/CalendarIconRenderer.swift" "${MACOS_DIR}/scripts/generate_icns.swift" -o /tmp/moa_gen_icon
/tmp/moa_gen_icon "${MACOS_DIR}/Resources"
rm -f /tmp/moa_gen_icon

echo "📁 2. Setting up .app bundle structure..."
rm -rf "${APP_BUNDLE}"
mkdir -p "${MACOS_BIN_DIR}" "${RESOURCES_DIR}"

echo "📋 3. Copying Resources & Info.plist..."
cp "${MACOS_DIR}/Resources/Info.plist" "${CONTENTS_DIR}/Info.plist"
cp "${MACOS_DIR}/Resources/AppIcon.icns" "${RESOURCES_DIR}/AppIcon.icns"

echo "⚡ 4. Compiling Swift native app with swiftc..."
ARCH="$(uname -m)"
TARGET_ARCH="${ARCH}-apple-macos13.0"

swiftc -O \
  -target "${TARGET_ARCH}" \
  -framework Cocoa \
  -framework WebKit \
  "${MACOS_DIR}/Sources/CalendarIconRenderer.swift" \
  "${MACOS_DIR}/Sources/MainWindowController.swift" \
  "${MACOS_DIR}/Sources/AppMenu.swift" \
  "${MACOS_DIR}/Sources/AppDelegate.swift" \
  "${MACOS_DIR}/Sources/main.swift" \
  -o "${MACOS_BIN_DIR}/${APP_NAME}"

echo "✍️ 5. Applying ad-hoc code signature..."
codesign --force --deep --sign - "${APP_BUNDLE}"

echo "✨ MoaCalendar.app built successfully!"
echo "📍 Location: ${APP_BUNDLE}"
echo "🚀 To run: open \"${APP_BUNDLE}\""
