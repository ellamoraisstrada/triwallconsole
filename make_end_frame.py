#!/usr/bin/env python3
"""Build the LAST frame of a wall clip from its first frame and the rig spec.

WHY
---
Prompting a video model to translate a whole picture by a stated amount keeps
failing on the side walls: "the left wall does not move" has now been reported
three times, and measured at +0.015 frame widths where the contract asked for
+0.665. Wording is not the lever it needs to be.

Seedance 2.5 accepts start_image AND end_image. Given both, the move stops
being an instruction the model may interpret and becomes an interpolation it
has to perform. So this takes the approved still, applies the contract's own
dx and scale, and writes the frame the clip has to arrive at.

THE REVEALED BAND
-----------------
Translating a picture uncovers a strip at the trailing edge that has no source
pixels. This fills it by mirroring the adjacent strip and then blurring the
join - deliberately bland. That is the right bias: the contract already tells
the generator to fill that band by continuing the adjacent material and NOT to
put a new feature there, so a plausible-but-vague fill is a truer target than
anything invented. The model cleans it up on the way through.

Usage:
  make_end_frame.py <src.png> <out.png> --dx -0.6655 [--scale 1.0]
    --dx     signed, in fractions of frame width. Negative = the picture
             travels toward the LEFT edge, matching rigspec's convention.
    --scale  linear zoom factor over the whole clip, about frame centre.
"""
import argparse
import json
import sys

import cv2
import numpy as np


def build(src, dx_frac, scale):
    img = cv2.imread(src, cv2.IMREAD_COLOR)
    if img is None:
        return None, 'could not read ' + src
    h, w = img.shape[:2]
    tx = dx_frac * w

    # Scale about frame centre, then translate.
    #
    # BORDER_REPLICATE, not REFLECT. A 66% translation uncovers two thirds of
    # the frame, and mirroring that much of the picture copies whole objects
    # into it - the first attempt put a second red booth in the revealed band,
    # which is precisely the "it invented furniture" defect this whole build
    # exists to stop. Replicating the edge column instead produces horizontal
    # streaks of the right colours and no objects at all: a truthful statement
    # of "more of the same wall and floor, detail unknown".
    cx, cy = w / 2.0, h / 2.0
    M = np.array([
        [scale, 0.0, cx - scale * cx + tx],
        [0.0, scale, cy - scale * cy],
    ], dtype=np.float32)
    warped = cv2.warpAffine(img, M, (w, h), flags=cv2.INTER_LANCZOS4,
                            borderMode=cv2.BORDER_REPLICATE)

    # Blur the streaked band vertically only, so horizontal structure (floor
    # line, skirting, horizon, wall top) survives and stays at its true height.
    # Those are the continuities the seam rules care about.
    band = int(round(abs(tx)))
    if band > 2:
        m = np.zeros((h, w), np.float32)
        if tx > 0:
            m[:, :band] = 1.0            # revealed at the LEFT edge
        else:
            m[:, w - band:] = 1.0        # revealed at the RIGHT edge
        feather = max(3, int(min(band, w) * 0.03))
        m = cv2.GaussianBlur(m, (0, 0), feather)[..., None]
        soft = cv2.GaussianBlur(warped, (0, 0), sigmaX=max(2.0, w * 0.006), sigmaY=1.2)
        warped = (warped * (1.0 - m) + soft * m).astype(np.uint8)

    return warped, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('out')
    ap.add_argument('--dx', type=float, required=True)
    ap.add_argument('--scale', type=float, default=1.0)
    a = ap.parse_args()

    out, err = build(a.src, a.dx, a.scale)
    if err:
        print(json.dumps({'error': err}))
        sys.exit(1)
    ok = cv2.imwrite(a.out, out)
    if not ok:
        print(json.dumps({'error': 'could not write ' + a.out}))
        sys.exit(1)
    h, w = out.shape[:2]
    print(json.dumps({
        'out': a.out, 'width': w, 'height': h,
        'dx': a.dx, 'scale': a.scale,
        'revealed_band_px': int(round(abs(a.dx) * w)),
        'revealed_at': 'LEFT edge' if a.dx > 0 else ('RIGHT edge' if a.dx < 0 else 'none'),
    }))


if __name__ == '__main__':
    main()
