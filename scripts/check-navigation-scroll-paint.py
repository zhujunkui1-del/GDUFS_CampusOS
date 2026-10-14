"""Check the native 608x440 Edge screenshot in the controlled 2D campus overview.

The ROI is above the navigation frame, excludes its white background, and has
real campus geometry in the control capture. CDP screenshots can force repaint;
capture with the connected browser's visible-tab screenshot instead.
"""

import argparse
import json
from PIL import Image

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("image")
args = parser.parse_args()
image = Image.open(args.image).convert("RGB")
if image.size != (608, 440):
    raise SystemExit("This controlled check requires a 608x440 native screenshot.")
pixels = image.load()
longest = count = 0
for y in range(90, 170):
    run = 0
    for x in range(24, 584):
        match = max(abs(a - b) for a, b in zip(pixels[x, y], (242, 241, 236))) <= 2
        count += match
        run = run + 1 if match else 0
        longest = max(longest, run)
print(json.dumps({"background_fraction": round(count / 44800, 4), "longest_background_run": longest}))
if longest >= 200:
    raise SystemExit("FAIL: navigation scrolling erased map geometry above its frame.")
print("PASS: map geometry remains visible above the scrolling navigation frame.")
