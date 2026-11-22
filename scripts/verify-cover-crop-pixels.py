"""Check rendered circles, including the rotating layer, for gaps and overflow."""
from pathlib import Path
from PIL import Image
import json
import math
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else 'artifacts/round-cover-crop-20261121/visual')
report = json.loads((root / 'browser-results.json').read_text())
checks = []
for result in report['results']:
    image = Image.open(root / result['file']).convert('RGB')
    a = result['album']
    cx, cy, radius = a['x'] + a['width']/2, a['y'] + a['height']/2, a['width']/2
    inside = outside = bad_inside = bad_outside = 0
    for y in range(max(0, int(a['y'])-5), min(image.height, math.ceil(a['y']+a['height'])+5)):
        for x in range(max(0, int(a['x'])-5), min(image.width, math.ceil(a['x']+a['width'])+5)):
            distance = math.hypot(x+.5-cx, y+.5-cy)
            r, g, b = image.getpixel((x, y))
            # Green artwork plus a blue center marker, including their blended edge.
            art = r < 70 and g+b > 190
            if distance < radius-4:
                inside += 1
                bad_inside += not art
            elif distance > radius+4:
                outside += 1
                bad_outside += art
    assert bad_inside == 0, (result['file'], 'unfilled interior', bad_inside, inside)
    assert bad_outside == 0, (result['file'], 'outside circle', bad_outside, outside)
    checks.append({'file': result['file'], 'insidePixels': inside, 'outsidePixels': outside,
                   'unexpectedInteriorPixels': bad_inside, 'leakedPixels': bad_outside})
(root / 'pixel-results.json').write_text(json.dumps(checks, indent=2))
print('PASS', len(checks), 'screenshots: full artwork inside circle, no artwork outside circle')
