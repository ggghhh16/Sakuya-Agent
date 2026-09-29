"""Encode real browser frames as optimized GIFs. Requires Pillow; no model calls."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

capture = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parents[1]
output = root / 'docs' / 'demos'
output.mkdir(parents=True, exist_ok=True)
manifest = json.loads((capture / 'manifest.json').read_text('utf-8'))
font_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path('C:/Windows/Fonts/msyh.ttc')
title_font = ImageFont.truetype(str(font_path), 27)
small_font = ImageFont.truetype(str(font_path), 15)
results = []
for clip in manifest['clips']:
    folder = Path(clip['dir'])
    timing = json.loads((folder / 'frames.json').read_text('utf-8'))
    frames = timing['frames']
    # One palette per clip prevents background flicker and keeps text sharp.
    sample = Image.new('RGB', (640 * 4, 400 * 3))
    for n in range(12):
        frame = frames[min(len(frames) - 1, round(n * (len(frames) - 1) / 11))]
        with Image.open(folder / frame['file']) as image:
            sample.paste(image.resize((640, 400)), ((n % 4) * 640, (n // 4) * 400))
    palette = sample.quantize(colors=240, method=Image.Quantize.MEDIANCUT)
    images, durations = [], []
    for n, frame in enumerate(frames):
        canvas = Image.new('RGB', (1280, 888), '#101214')
        draw = ImageDraw.Draw(canvas)
        draw.text((30, 14), clip['title'], font=title_font, fill='#e6eee9')
        draw.text((31, 52), clip['subtitle'], font=small_font, fill='#a9cbbf')
        draw.text((1080, 26), 'SAKUYA AGENT', font=small_font, fill='#a9cbbf')
        draw.line((24, 86, 1256, 86), fill='#33453e', width=2)
        with Image.open(folder / frame['file']) as image:
            canvas.paste(image.convert('RGB'), (0, 88))
        images.append(canvas.quantize(palette=palette, dither=Image.Dither.NONE))
        end = frames[n + 1]['time'] if n + 1 < len(frames) else timing['end']
        durations.append(max(20, round((end - frame['time']) / 10) * 10))
    path = output / (clip['id'] + '.gif')
    images[0].save(path, save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=True, disposal=1)
    with Image.open(path) as check:
        duration = 0
        for n in range(check.n_frames):
            check.seek(n); check.load(); duration += check.info.get('duration', 0)
        assert check.n_frames > 10 and check.size == (1280, 888)
        result = {'file': path.name, 'frames': check.n_frames, 'duration_ms': duration, 'bytes': path.stat().st_size}
        results.append(result)
        print(json.dumps(result))
    # A review sheet is kept with ignored captures, not published in the README.
    sheet = Image.new('RGB', (640 * 3, 444 * 2), '#101214')
    for n in range(6):
        index = min(len(images) - 1, round(n * (len(images) - 1) / 5))
        sheet.paste(images[index].convert('RGB').resize((640, 444)), ((n % 3) * 640, (n // 3) * 444))
    sheet.save(capture / (clip['id'] + '-review.jpg'))
    for image in images:
        image.close()
(capture / 'encoding.json').write_text(json.dumps(results, indent=2), 'utf-8')
