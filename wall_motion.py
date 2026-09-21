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


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'error': 'usage: wall_motion.py <clip>'}))
        sys.exit(1)
    print(json.dumps(measure(sys.argv[1])))


if __name__ == '__main__':
    main()
