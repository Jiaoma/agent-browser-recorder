#!/usr/bin/env python3
"""Generate extension icons using Pillow."""

from PIL import Image, ImageDraw
import sys
import os

def create_icon(size, output_path):
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    margin = max(2, size // 10)
    draw.ellipse([margin, margin, size - margin, size - margin], fill='#1d1d1f')

    center = size // 2
    dot_radius = size // 4
    draw.ellipse([
        center - dot_radius, center - dot_radius,
        center + dot_radius, center + dot_radius
    ], fill='#ff3b30')

    if size >= 32:
        lw = max(1, size // 32)
        for i in range(-1, 2):
            x = center + i * (size // 8)
            y1 = center - dot_radius - size // 6
            y2 = center - dot_radius - size // 12
            draw.line([(x, y1), (x + size // 16, y2)], fill='white', width=lw)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    img.save(output_path)
    print(f'✅ {output_path}')

def main():
    base = os.path.join(os.path.dirname(__file__), 'src', 'icons')
    for size in [16, 32, 48, 128]:
        create_icon(size, os.path.join(base, f'icon{size}.png'))

if __name__ == '__main__':
    main()
