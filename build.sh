#!/bin/bash
# Build script for Agent Browser Recorder Chrome Extension
# Creates a loadable unpacked extension and a distributable .zip

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SRC_DIR="$SCRIPT_DIR/src"
DIST_DIR="$SCRIPT_DIR/dist"
BUILD_DIR="$SCRIPT_DIR/build"

echo "🦀 Building Agent Browser Recorder..."

# Clean previous builds
rm -rf "$BUILD_DIR" "$DIST_DIR"
mkdir -p "$BUILD_DIR" "$DIST_DIR"

# Copy source files
echo "📦 Copying source files..."
cp -r "$SRC_DIR"/* "$BUILD_DIR/"

# Generate simple SVG icons and convert to PNG
echo "🎨 Generating icons..."
generate_icon() {
  local size=$1
  local outfile="$BUILD_DIR/icons/icon${size}.png"

  # Use Python to generate PNG icons (available on macOS)
  python3 << PYTHON
from PIL import Image, ImageDraw, ImageFont
import math

size = ${size}
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Background circle
margin = max(2, size // 10)
draw.ellipse([margin, margin, size - margin, size - margin], fill='#1d1d1f')

# Inner circle (recording dot)
center = size // 2
dot_radius = size // 4
draw.ellipse([
    center - dot_radius, center - dot_radius,
    center + dot_radius, center + dot_radius
], fill='#ff3b30')

# Small claw marks
if size >= 32:
    line_width = max(1, size // 32)
    offset = size // 3
    for i in range(-1, 2):
        x = center + i * (size // 8)
        y1 = center - dot_radius - size // 6
        y2 = center - dot_radius - size // 12
        draw.line([(x, y1), (x + size//16, y2)], fill='white', width=line_width)

img.save('${outfile}')
print(f'Generated ${outfile}')
PYTHON
}

for size in 16 32 48 128; do
  generate_icon $size
done

echo "✅ Build complete at $BUILD_DIR"

# Create zip for Chrome Web Store
echo "📦 Creating distribution zip..."
cd "$BUILD_DIR"
zip -r "$DIST_DIR/agent-browser-recorder.zip" . -x "*.DS_Store"
cd "$SCRIPT_DIR"

echo "🎉 Distribution zip: $DIST_DIR/agent-browser-recorder.zip"
echo ""
echo "To install in Chrome:"
echo "  1. Open chrome://extensions"
echo "  2. Enable 'Developer mode'"
echo "  3. Click 'Load unpacked'"
echo "  4. Select: $BUILD_DIR"
