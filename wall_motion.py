#!/usr/bin/env python3
"""Measure ONE finished wall clip the same way rigspec.js states its targets.

WHY THIS REPLACES THE OLD VERIFIER
----------------------------------
"Check against preset" used to measure a generated clip with the Farneback
signature from learn_rig.py and compare it to the reference's PER-SECOND rate.
Two things made that unable to give a right answer:

  1. The reference clips are 1.6-1.9 second beats and the generated clips are
     five seconds. A five-second clip that reproduces the reference GESTURE
     correctly runs at roughly 40% of the reference RATE, so the old check
     called a correct clip "too weak" and a clip running at reference rate -
     three times too far - "a match".
  2. It compared a divergence coefficient, which says a frame is expanding but
     not by how much, so "the background is static and only objects slide"
     passed.

This measures the same three quantities rigspec.js specifies - total horizontal
travel as a fraction of frame width, total scale factor, total roll - by
fitting a similarity transform per frame pair and accumulating it. Same model,
same units, so the verdict means something.

Also reported, because it is the specific failure the last set had:
  bg_ratio   how much the SLOWEST-moving tenth of tracked points moved,
             relative to the frame median. A real camera move carries the
             background with it, so this sits near 1. Objects sliding over a
             static plate drives it toward 0.

Usage:  python wall_motion.py <clip> [--json]
"""
import json
import sys

import cv2
import numpy as np


def measure(path, max_frames=900):
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return {'error': 'could not open clip'}
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    while len(frames) < max_frames:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    if len(frames) < 6:
        return {'error': 'clip too short to measure'}

    H, W = frames[0].shape[:2]
    # Downscale for speed; ratios are scale-free so nothing is lost.
    sc = 640.0 / W if W > 640 else 1.0
    grays = [cv2.cvtColor(cv2.resize(f, None, fx=sc, fy=sc), cv2.COLOR_BGR2GRAY)
             if sc != 1.0 else cv2.cvtColor(f, cv2.COLOR_BGR2GRAY) for f in frames]
    h, w = grays[0].shape[:2]

    # A cut is not camera motion.
    lumas = [float(g.mean()) for g in grays]

    dxs, scales, rolls, bgs = [], [], [], []
    used = 0
    for i in range(1, len(grays)):
        if abs(lumas[i] - lumas[i - 1]) > 6.0:
            continue
        a, b = grays[i - 1], grays[i]
        p0 = cv2.goodFeaturesToTrack(a, maxCorners=400, qualityLevel=0.015, minDistance=8)
        if p0 is None or len(p0) < 30:
            continue
        p1, st, _ = cv2.calcOpticalFlowPyrLK(a, b, p0, None, winSize=(21, 21), maxLevel=3)
        if p1 is None:
            continue
        g = st.ravel() == 1
        A, B = p0[g].reshape(-1, 2), p1[g].reshape(-1, 2)
        if len(A) < 25:
            continue
        M, _ = cv2.estimateAffinePartial2D(A, B, method=cv2.RANSAC,
                                           ransacReprojThreshold=2.0)
        if M is None:
            continue
        s = float(np.hypot(M[0, 0], M[1, 0]))
        th = float(np.arctan2(M[1, 0], M[0, 0]))
        c = np.array([w / 2.0, h / 2.0, 1.0])
        cc = M @ c
        dxs.append((cc[0] - w / 2.0) / w)
        scales.append(s)
        rolls.append(th)

        # Background participation: the decile of points that moved LEAST,
        # against the median. Uses raw displacement, not the fitted model, so a
        # static plate cannot hide behind a good fit.
        d = np.hypot(*(B - A).T)
        med = float(np.median(d))
        if med > 0.05:
            bgs.append(float(np.percentile(d, 10)) / med)
        used += 1

    if used < 4:
        return {'error': 'no trackable texture - could not measure this clip'}

    T = len(frames) / fps
    dx_rate = float(np.median(dxs)) * fps          # frame-widths per second
    s_rate = float(np.median(scales)) ** fps       # scale factor per second
    roll_rate = float(np.degrees(np.median(rolls))) * fps

    return {
        'durationSec': round(T, 3),
        'fps': round(fps, 2),
        'frames': len(frames),
        'widthPx': W, 'heightPx': H,
        'dxTotal': round(dx_rate * T, 4),
        'dxRate': round(dx_rate, 4),
        'scaleTotal': round(s_rate ** T, 4),
        'scaleRate': round(s_rate, 4),
        'rollTotal': round(roll_rate * T, 2),
        'bgRatio': round(float(np.median(bgs)), 3) if bgs else None,
        'samples': used,
    }


def strip_spread(path, n=4, axis='rows'):
    """Shift measured in independent strips, and the spread between them.

    axis='rows'  -> horizontal strips, top to bottom. Catches a layer sliding:
                    the ground running away from the sky. The reference clip
                    (ClaudeLearning_RightWall.mp4) reads 3.9%; delivered walls
                    that slid read 59-82%.
    axis='cols'  -> vertical strips, left to right. Catches a PAN: a camera that
                    turns compresses one side of the frame and fans the other, so
                    the shift differs by column. The reference reads 16.3% - the
                    mild, real parallax of a viewpoint actually travelling - so
                    the threshold sits well above that.
    """
    cap = cv2.VideoCapture(path)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    ok, prev = cap.read()
    if not ok:
        cap.release()
        return None, None
    prevg = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    acc = [0.0] * n
    seen = [0] * n
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        for b in range(n):
            if axis == 'rows':
                y0, y1 = int(H * b / n), int(H * (b + 1) / n)
                a, c = prevg[y0:y1], g[y0:y1]
            else:
                x0, x1 = int(W * b / n), int(W * (b + 1) / n)
                a, c = prevg[:, x0:x1], g[:, x0:x1]
            try:
                (dx, _dy), resp = cv2.phaseCorrelate(a.astype(np.float32), c.astype(np.float32))
            except cv2.error:
                continue
            # A featureless strip gives a meaningless shift with a low response;
            # counting it would invent a spread that is not there.
            if resp > 0.03:
                acc[b] += dx
                seen[b] += 1
        prevg = g
    cap.release()
    vals = [round(acc[b] / W, 4) for b in range(n) if seen[b]]
    if len(vals) < 2:
        return None, None
    biggest = max(abs(v) for v in vals)
    if biggest < 0.01:
        return vals, 0.0
    return vals, round((max(vals) - min(vals)) / biggest, 3)


def band_spread(path, bands=4):
    """Is the picture moving as ONE sheet, or is a layer sliding inside it?

    bgRatio answers "does the dominant motion cover most of the frame", and a
    clip can score 0.909 on that while its ground plane slides over its sky -
    which is exactly what the owner reported and what bgRatio missed. So measure
    dx independently in horizontal bands and report the spread between them.

    Rigid camera move  -> every band the same number. L_bear.mp4, which the owner
                          called correct, reads -0.133 / -0.135 / -0.136 / -0.136,
                          a spread of 3%.
    Sliding floor      -> the bottom band runs away from the top. A delivered left
                          wall read -0.090 / -0.094 / -0.210 / -0.508: 82%.

    Returns the per-band dx (fractions of frame width, over the whole clip) and
    the spread as a fraction of the largest band.
    """
    cap = cv2.VideoCapture(path)
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    ok, prev = cap.read()
    if not ok:
        cap.release()
        return None, None
    prevg = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    acc = [0.0] * bands
    seen = [0] * bands
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY)
        for b in range(bands):
            y0, y1 = int(H * b / bands), int(H * (b + 1) / bands)
            a = prevg[y0:y1].astype(np.float32)
            c = g[y0:y1].astype(np.float32)
            try:
                (dx, _dy), resp = cv2.phaseCorrelate(a, c)
            except cv2.error:
                continue
            # A featureless band (flat sky) gives a meaningless shift with a low
            # response; counting it would invent a spread that is not there.
            if resp > 0.03:
                acc[b] += dx
                seen[b] += 1
        prevg = g
    cap.release()
    vals = [round(acc[b] / W, 4) for b in range(bands) if seen[b]]
    if len(vals) < 2:
        return None, None
    biggest = max(abs(v) for v in vals)
    if biggest < 0.01:            # nothing moved; a spread here is noise
        return vals, 0.0
    return vals, round((max(vals) - min(vals)) / biggest, 3)


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'usage: wall_motion.py <clip>'}))
        sys.exit(1)
    out = measure(sys.argv[1])
    # The layer-separation test. Reported alongside bgRatio because the two ask
    # different questions and a clip can pass one while failing the other.
    try:
        bands, spread = strip_spread(sys.argv[1], 4, 'rows')
        out['bandDx'] = bands
        out['bandSpread'] = spread
        cols, cspread = strip_spread(sys.argv[1], 5, 'cols')
        out['colDx'] = cols
        out['colSpread'] = cspread
    except Exception:
        out['bandDx'] = out['bandSpread'] = None
        out['colDx'] = out['colSpread'] = None
    print(json.dumps(out))


if __name__ == '__main__':
    main()
