"""Genera los iconos de Mi salud: corazón con línea de pulso blanca sobre índigo profundo."""
import sys, math
from PIL import Image, ImageDraw
out = sys.argv[1] if len(sys.argv) > 1 else '.'
S = 1024
def render(size):
    img = Image.new('RGB', (S, S), (38, 50, 140))
    px = img.load()
    for y in range(S):  # degradado suave
        for x in range(S):
            t = (x + y) / (2 * S)
            px[x, y] = (int(48 - 18 * t), int(60 - 14 * t), int(168 - 40 * t))
    d = ImageDraw.Draw(img)
    cx, cy = 512, 520
    pts = []
    for i in range(400):  # curva clásica de corazón, dentro de la zona segura (~62 %)
        t = 2 * math.pi * i / 400
        x = 16 * math.sin(t) ** 3
        y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
        pts.append((cx + x * 21, cy - y * 21))
    d.polygon(pts, fill=(255, 255, 255))
    # línea de pulso, en el color del fondo, dentro del corazón
    c = (44, 56, 150)
    line = [(300, 540), (420, 540), (470, 430), (540, 660), (590, 500), (625, 540), (724, 540)]
    d.line(line, fill=c, width=34, joint='curve')
    for p in (line[0], line[-1]):
        d.ellipse([p[0] - 17, p[1] - 17, p[0] + 17, p[1] + 17], fill=c)
    return img.resize((size, size), Image.LANCZOS)
for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)):
    render(size).save(f'{out}/{name}')
