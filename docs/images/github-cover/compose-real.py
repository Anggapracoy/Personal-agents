"""Compose captured simulator PNGs; never synthesize or redraw screen content.
Requires Pillow. Use --font to select a bold sans-serif font on another system.
"""
from pathlib import Path
import argparse
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('--font', default=str(ROOT / 'fonts/Manrope.ttf'))
parser.add_argument('--weight', type=float, default=700)
parser.add_argument('--tracking', type=float, default=-2)
parser.add_argument('--output', default=str(ROOT / 'dash-cover-real.png'))
args = parser.parse_args()
canvas = Image.new('RGBA', (3840, 2160), 'white')
headline = 'Dash - your proactive assistant'
font = ImageFont.truetype(args.font, 174)
try:
    font.set_variation_by_axes([args.weight])
except OSError:
    pass
draw = ImageDraw.Draw(canvas)
box = draw.textbbox((0, 0), headline, font=font)
advances = [font.getlength(headline[i:i+2]) - font.getlength(headline[i+1]) + args.tracking for i in range(len(headline)-1)] + [font.getlength(headline[-1])]
x = (3840 - sum(advances)) / 2
for char, advance in zip(headline, advances):
    draw.text((x, 355 - box[1]), char, fill='black', font=font)
    x += advance

def captured_phone(filename, width, tilt, opacity):
    capture = Image.open(ROOT / filename).convert('RGBA')
    frame_path = ROOT.parents[2] / 'public/landing/iphone-16-pro-black-hires.png'
    frame = Image.open(frame_path).convert('RGBA')
    # Exact native screen opening and crop used by the landing page.
    capture = capture.resize((1206, 2622), Image.Resampling.LANCZOS)
    mask = Image.new('L', capture.size)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1205, 2621), radius=147, fill=255)
    tile = Image.new('RGBA', frame.size)
    tile.paste(capture, (151, 328), mask)
    tile.alpha_composite(frame)
    tile = tile.crop((79, 259, 1429, 3019))
    tile = tile.resize((width, round(width * 2760 / 1350)), Image.Resampling.LANCZOS)
    if tilt:
        tile = tile.rotate(tilt, resample=Image.Resampling.BICUBIC, expand=True)
    if opacity < 1:
        tile.putalpha(tile.getchannel('A').point(lambda alpha: round(alpha * opacity)))
    return tile

# All bottoms extend beyond the canvas and are clipped at the same flat edge.
# Only the outer captures receive the slight opacity reduction requested.
for name, center_x, top, width, angle, alpha in [
    ('feed.png', 1070, 850, 900, 5, .90),
    ('montreal-keyboard.png', 2770, 850, 900, -5, .90),
    ('proactive-chat.png', 1920, 720, 900, 0, 1),
]:
    phone = captured_phone(name, width, angle, alpha)
    canvas.alpha_composite(phone, (round(center_x - phone.width / 2), top))
canvas.convert('RGB').save(args.output, optimize=True)
print(args.output)
