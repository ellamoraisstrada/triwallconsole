#!/usr/bin/env python3
"""
learn_rig.py - measure the C_* ground-truth camera moves and emit a signature
library the decoder matches uploaded client footage against.

WHY THIS EXISTS
---------------
The decoder used to classify motion from hand-tuned thresholds I chose. That is
guesswork dressed as measurement: it called a lateral track a yaw, because the
rule for telling them apart was a number I picked rather than one the rig
produced. These recordings are the rig's own answer - the same nDisplay config,
the same default eyepoint, one clean move per clip - so the decoder can compare
what a client uploaded against what the room actually does.

THE RECORDING LAYOUT (measured, not assumed)
--------------------------------------------
1920x1080. The TOP STRIP is the three rendered nDisplay views, each exactly
576px wide, bordered in red / green / blue:

    x [   0,  576)  RED    L + LR   (left view, 90 deg + 45 deg left)
    x [ 576, 1152)  GREEN  C        (centre view, straight ahead)
    x [1152, 1728)  BLUE   RR + R   (right view, 45 deg + 90 deg right)
    x [1728, 1920)  white padding, ignored

Everything BELOW the strip is the Unreal editor viewport: a white unlit previz
showing the wall quads floating around the eyepoint. It is context for a human,
NOT data - its apparent motion is the free-flying editor camera, not the rig
camera. Measuring it would repeat the UERenderCam mistake. We crop it away.

Each panel is letterboxed inside its border, so near-black rows/columns are
masked out before any flow is computed.

WHAT IS MEASURED PER PANEL
--------------------------
  vx, vy    median optical flow, in panel-widths (or heights) per second.
            Median, not mean: a few clipping polygons in the previz must not
            drag the answer.
  div_x     d(u)/dx - horizontal divergence. Positive = content spreading
            apart horizontally = the signature of a push in.
  div_y     d(v)/dy - vertical divergence.
  spread    inter-quartile range of u, normalised. This is the truck/yaw
            discriminator that thresholds got wrong: a yaw moves the whole
            frame at one angular rate (low spread), a lateral truck moves near
            content faster than far (high spread).

Signs follow image convention: +vx = content moves RIGHT across frame.
A camera yawing LEFT pushes content RIGHT, so C_TurnLeft has POSITIVE vx.

Usage:
    python learn_rig.py <dir-with-C_*.mp4> [-o rig_library.json]
    python learn_rig.py --describe rig_library.json
"""

import argparse
import json
import os
import sys

import cv2
import numpy as np

# The three rendered views in the top strip. Boundaries were measured from the
# border colours, not assumed: each panel is exactly 576px.
PANELS = [
    ('LEFT',   0,  576),
    ('CENTER', 576, 1152),
    ('RIGHT',  1152, 1728),
]
# The rendered strip ends here; below is the editor viewport, which is not data.
STRIP_BOTTOM = 324
# Keep clear of the coloured border itself.
BORDER_INSET = 10
# Letterbox / dead pixels: anything this dark contributes no usable texture.
DARK_LEVEL = 18


def panel_content_box(gray):
    """Trim letterbox bars so flow is measured on actual rendered pixels."""
    h, w = gray.shape[:2]
    lit = gray > DARK_LEVEL
    rows = np.where(lit.sum(axis=1) > w * 0.10)[0]
    cols = np.where(lit.sum(axis=0) > h * 0.10)[0]
    if len(rows) < 8 or len(cols) < 8:
        return 0, h, 0, w
    return rows[0], rows[-1] + 1, cols[0], cols[-1] + 1



def detect_panels(path):
    """Find the red / green / blue bordered panels in a reference recording.

    The panel geometry was hard-coded to the first batch of recordings (a 576px
    strip across the top). The moment those were re-rendered at a different
    layout, every clip measured as "no usable texture" - a silent total failure
    from three constants. The borders are the one thing the recordings always
    carry, so they are what gets detected.

    Returns [(name, x0, x1, y0, y1), ...] in strip order, or None.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    # A mid-clip frame: the first frame is sometimes a fade-up with no borders.
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(1, n // 3))
    ok, img = cap.read()
    cap.release()
    if not ok:
        return None

    b, g, r = (img[:, :, i].astype(int) for i in range(3))

    # Strict masks. A loose red mask swallows the scene itself - these rooms are
    # full of warm reddish wood, and the first attempt reported the left panel as
    # 1876px wide because of it. The borders are pure primaries; scene content
    # never is.
    def box(mask):
        ys, xs = np.where(mask)
        if len(xs) < 300:
            return None
        return int(xs.min()), int(xs.max()) + 1, int(ys.min()), int(ys.max()) + 1

    green = box((g > 170) & (r < 90) & (b < 90))
    blue = box((b > 170) & (r < 90) & (g < 110))
    if not green:
        return None

    # The three panels are contiguous and equal width, so the green panel alone
    # defines the grid. Blue is used only to confirm it, never to define it.
    gx0, gx1, gy0, gy1 = green
    w = gx1 - gx0
    if w < 80:
        return None
    if blue:
        expected = gx1
        if abs(blue[0] - expected) > max(12, w * 0.08):
            return None            # layout is not the contiguous strip we expect
        gy0, gy1 = min(gy0, blue[2]), max(gy1, blue[3])

    return [
        ('LEFT',   max(0, gx0 - w), gx0,             gy0, gy1),
        ('CENTER', gx0,             gx1,             gy0, gy1),
        ('RIGHT',  gx1,             min(img.shape[1], gx1 + w), gy0, gy1),
    ]


def flow_stats(prev, cur):
    """Farneback flow plus the derived shape terms, or None if too little texture."""
    flow = cv2.calcOpticalFlowFarneback(
        prev, cur, None,
        pyr_scale=0.5, levels=3, winsize=21,
        iterations=3, poly_n=5, poly_sigma=1.2, flags=0)
    u = flow[..., 0]
    v = flow[..., 1]
    h, w = u.shape

    # Ignore pixels with no gradient to track - flat white previz floor returns
    # zeros that would otherwise dilute a real move toward zero.
    gx = cv2.Sobel(cur, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(cur, cv2.CV_32F, 0, 1, ksize=3)
    texture = np.sqrt(gx * gx + gy * gy)
    mask = texture > np.percentile(texture, 55)
    if mask.sum() < 200:
        return None

    um, vm = u[mask], v[mask]
    vx = float(np.median(um))
    vy = float(np.median(vm))

    # Divergence: fit u against x and v against y. A push in spreads content
    # outward from frame centre, so both gradients go positive together.
    xs = np.tile(np.arange(w, dtype=np.float32), (h, 1))[mask]
    ys = np.tile(np.arange(h, dtype=np.float32).reshape(-1, 1), (1, w))[mask]
    div_x = float(np.polyfit(xs, um, 1)[0]) * w
    div_y = float(np.polyfit(ys, vm, 1)[0]) * h

    # Spread of horizontal motion. NOTE: this turned out to be the opposite of
    # what the old hand-tuned decoder assumed. Measured on this rig, a YAW has
    # a large spread (perspective makes frame edges sweep far faster than frame
    # centre) and a lateral TRUCK has a small one (room interiors sit in a
    # narrow depth band, so parallax is mild). The separation is ~20x, which is
    # why this replaces the invented parallax threshold.
    q75, q25 = np.percentile(um, [75, 25])
    spread = float(q75 - q25)

    # ROLL. A pitch of the rig is a rotation about the axis pointing out of the
    # CENTRE view's right side. For a wall at 90 degrees that same world axis
    # points along its own view direction, so the side walls do not slide
    # vertically - they ROLL. Without this term a tilt looks like "nothing
    # happens on the sides", which is wrong and would produce static side walls.
    # curl = d(v)/dx - d(u)/dy, in radians per frame.
    curl_a = float(np.polyfit(xs, vm, 1)[0])
    curl_b = float(np.polyfit(ys, um, 1)[0])
    roll = (curl_a - curl_b) / 2.0

    return dict(vx=vx, vy=vy, div_x=div_x, div_y=div_y, spread=spread,
                roll=roll,
                mag=float(np.median(np.sqrt(um * um + vm * vm))))


def measure_clip(path, verbose=False):
    """Measure all three rendered panels of a C_* reference recording.

    Panels are DETECTED from their coloured borders, not assumed, and the
    measurement itself goes through measure_region - the same function the
    decoder runs on client uploads, so library and query stay comparable.
    """
    boxes = detect_panels(path)
    if not boxes:
        raise SystemExit('%s: could not find the red/green/blue panel borders' % path)
    if boxes[0][0].startswith('MISORDERED'):
        raise SystemExit('%s: panel colours are not left-to-right (%s)' % (path, boxes[0][0]))

    out = {}
    for name, x0, x1, y0, y1 in boxes:
        box = (x0 + BORDER_INSET, x1 - BORDER_INSET,
               y0 + BORDER_INSET, y1 - BORDER_INSET)
        sig = measure_region(path, box=box)
        out[name] = sig
        if verbose:
            print('   %-7s box=%s %s' % (name, box, sig))

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    return dict(fps=fps, frames=n, panels=out,
                panel_boxes={b[0]: list(b[1:]) for b in boxes})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src', help='directory holding C_*.mp4, or a single clip')
    ap.add_argument('-o', '--out', default='rig_library.json')
    ap.add_argument('-v', '--verbose', action='store_true')
    args = ap.parse_args()

    if os.path.isdir(args.src):
        clips = sorted(f for f in os.listdir(args.src)
                       if f.lower().startswith('c_') and f.lower().endswith('.mp4'))
        paths = [os.path.join(args.src, f) for f in clips]
    else:
        paths = [args.src]

    lib = {}
    for p in paths:
        move = os.path.splitext(os.path.basename(p))[0]
        print('measuring %s ...' % move)
        lib[move] = measure_clip(p, verbose=args.verbose)

    with open(args.out, 'w') as fh:
        json.dump(lib, fh, indent=2)
    print('\nwrote %s (%d moves)' % (args.out, len(lib)))

    # Human-readable summary: the numbers are the point, so print them.
    print('\n%-14s %-7s %8s %8s %8s %8s %8s' %
          ('MOVE', 'PANEL', 'vx', 'vy', 'div_x', 'div_y', 'spread'))
    for move, d in lib.items():
        for name, _, _ in PANELS:
            s = d['panels'].get(name)
            if not s:
                print('%-14s %-7s   (no usable texture)' % (move, name))
                continue
            print('%-14s %-7s %8.3f %8.3f %8.3f %8.3f %8.3f %8.4f' %
                  (move, name, s['vx'], s['vy'], s['div_x'], s['div_y'], s['spread'], s['roll']))
        print()




# ---------------------------------------------------------------- matching ---
# Everything below is what the DECODER uses at runtime. It deliberately lives in
# the same file as the library builder: the query and the library must be
# measured by identical code, or a match compares two different things and the
# numbers quietly stop meaning anything.

SIG_KEYS = ['vx', 'vy', 'div_x', 'div_y', 'spread']

# Per-feature scaling before comparison. Raw magnitudes are not comparable:
# spread runs an order of magnitude below vx on a track but above it on a turn,
# and without scaling the distance is dominated by whichever happens to be
# largest. These are the observed spans across the seven ground-truth moves.
SIG_SCALE = dict(vx=0.40, vy=0.40, div_x=0.40, div_y=0.40, spread=0.50)


def sig_vector(sig):
    import numpy as _np
    return _np.array([float(sig.get(k, 0.0)) / SIG_SCALE[k] for k in SIG_KEYS],
                     dtype=float)


def measure_region(path, box=None, strip_bottom=None, debug=False):
    """Signature of ONE region of any video - the client's centre wall clip.

    box is (x0, x1, y0, y1) in pixels; None means auto. Returns the same
    normalised units as the library, so the two are directly comparable.

    Three things here exist because of real failures on real client footage,
    none of which show up on the short single-move reference clips:

      1. WIDE PLATES. A stitched three-wall plate (e.g. 2168x412) measured whole
         averages the left wall against the right wall, which for any symmetric
         move cancels to zero. Anything wider than 3:1 is treated as a plate and
         only its middle third - the centre wall - is measured.
      2. CUTS AND FADES. Flow across a cut is not camera motion. Frame pairs
         whose mean luma jumps are dropped outright.
      3. MIXED MOTION. A long clip that pushes in, holds, then pulls out has a
         median of roughly zero, which would read as 'no move'. We take the
         longest run of CONSISTENT direction instead of the whole timeline.
    """
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        return None
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    frames = []
    while True:
        ok, fr = cap.read()
        if not ok:
            break
        frames.append(fr)
    cap.release()
    if len(frames) < 4:
        return None

    H, W = frames[0].shape[:2]
    if box is None and strip_bottom is None and W / float(H) > 3.0:
        # Stitched plate: keep the centre third only.
        box = (W // 3, 2 * W // 3, 0, H)

    grays = []
    for fr in frames:
        if box:
            x0, x1, y0, y1 = box
            fr = fr[y0:y1, x0:x1]
        elif strip_bottom:
            fr = fr[0:strip_bottom, :]
        grays.append(cv2.cvtColor(fr, cv2.COLOR_BGR2GRAY))

    r0, r1, c0, c1 = panel_content_box(grays[0])
    grays = [g[r0:r1, c0:c1] for g in grays]
    ph, pw = grays[0].shape[:2]

    lumas = [float(g.mean()) for g in grays]

    # ADAPTIVE STRIDE. Comparing consecutive frames works for the reference
    # clips, which move fast, and fails silently on real client footage, which
    # often does not: a wall drifting 0.06 panel-widths per second moves about
    # 0.7px between frames, which is under the noise floor of the flow estimate,
    # so the median comes back 0.000 and the clip reads as "no motion at all".
    # That is how a real render and a real montage both measured as dead still.
    # Comparing frames further apart makes the same motion several pixels and
    # brings it back above the noise; the result is divided by the stride, so
    # the units are unchanged.
    stride = 1
    for _ in range(4):
        probe = [flow_stats(grays[i - stride], grays[i])
                 for i in range(stride, len(grays), max(1, stride))]
        probe = [x for x in probe if x]
        if not probe:
            break
        mag = float(np.median([abs(x['vx']) + abs(x['vy']) + abs(x['div_x']) for x in probe]))
        if mag >= 1.2 or stride * 2 >= max(2, len(grays) // 4):
            break
        stride *= 2

    per = []
    for i in range(stride, len(grays), stride):
        # A cut or a fade beat produces a luma step; flow across it is garbage.
        if abs(lumas[i] - lumas[i - stride]) > 6.0:
            per.append(None)
            continue
        st = flow_stats(grays[i - stride], grays[i])
        if st:
            # Back to per-frame units so every measurement is comparable
            # regardless of the stride that was needed to see it.
            st = {k: (v / stride if isinstance(v, float) else v) for k, v in st.items()}
        per.append(st)

    # Longest run of consistent dominant direction. The dominant axis is chosen
    # per sample from whichever of vx / vy / div_x is largest, so a push and a
    # track are not lumped together just because both are "moving".
    def axis_of(s):
        if s is None:
            return None
        cand = [('vx', s['vx']), ('vy', s['vy']), ('div_x', s['div_x'])]
        k, v = max(cand, key=lambda kv: abs(kv[1]))
        if abs(v) < 1e-3:
            return 'still'
        return k + ('+' if v > 0 else '-')

    best_run, cur = [], []
    cur_axis = None
    for s in per:
        a = axis_of(s)
        if s is None or a is None:
            if len(cur) > len(best_run):
                best_run = cur
            cur, cur_axis = [], None
            continue
        if cur_axis is None or a == cur_axis:
            cur_axis = a
            cur.append(s)
        else:
            if len(cur) > len(best_run):
                best_run = cur
            cur, cur_axis = [s], a
    if len(cur) > len(best_run):
        best_run = cur

    used = best_run if len(best_run) >= 3 else [s for s in per if s]
    if not used:
        return None

    def med(k):
        return float(np.median([p[k] for p in used]))

    total = len([s for s in per if s is not None])
    sig = dict(
        vx=round(med('vx') / pw * fps, 5),
        vy=round(med('vy') / ph * fps, 5),
        div_x=round(med('div_x') / pw * fps, 5),
        div_y=round(med('div_y') / ph * fps, 5),
        spread=round(med('spread') / pw * fps, 5),
        roll=round(med('roll') * fps, 5),
        mag=round(med('mag') / pw * fps, 5),
        samples=len(used),
        samples_total=len(per),
        samples_rejected=len(per) - total,
        run_fraction=round(len(used) / max(1, len(per)), 3),
        stride=stride,
        panel_px=[pw, ph],
        plate_centre_crop=bool(box is not None and W / float(H) > 3.0),
    )
    if debug:
        sig['axis_runs'] = len(per)
    return sig


# Below this much motion there is nothing to classify. Cosine similarity is
# scale-free, so a dead-still clip still lands on SOME move at high similarity -
# it is matching noise. The reference moves sit at ~0.35-0.85 in these units;
# a tenth of the slowest is a generous floor.
MIN_MOTION = 0.035


def motion_strength(sig):
    """How much is actually happening, in the same units as the library."""
    import numpy as _np
    return float(_np.linalg.norm(sig_vector(sig)))


def match_signature(sig, lib, panel='CENTER'):
    """Rank the library by SHAPE, not speed.

    Cosine similarity on the scaled feature vector, so a client clip that
    performs the same move faster or slower than the reference still matches -
    the speed difference comes back separately as speed_ratio, which is what
    the rate/degrees are then derived from. Comparing raw magnitudes instead
    would call every slow move a 'hold'.
    """
    import numpy as _np
    q = sig_vector(sig)
    qn = _np.linalg.norm(q)
    if qn < 1e-9:
        return []
    ranked = []
    for move, d in lib.items():
        ref = (d.get('panels') or {}).get(panel)
        if not ref:
            continue
        r = sig_vector(ref)
        rn = _np.linalg.norm(r)
        if rn < 1e-9:
            continue
        cos = float(_np.dot(q, r) / (qn * rn))
        ranked.append(dict(move=move, cosine=round(cos, 4),
                           speed_ratio=round(float(qn / rn), 3)))
    ranked.sort(key=lambda x: -x['cosine'])
    return ranked


def classify_against_library(sig, lib, panel='CENTER'):
    """The decoder's answer: a C_ move, or an honest refusal.

    Returns move=None when the clip is too still to classify, or when the top
    two candidates are too close to separate. Saying 'I cannot tell' is the
    whole point - the previous decoder's worst behaviour was naming a move it
    had not actually distinguished.
    """
    strength = motion_strength(sig)
    if strength < MIN_MOTION:
        return dict(move=None, confidence='none', strength=round(strength, 4),
                    ranked=[], reason='Almost no sustained motion in this clip - '
                                      'nothing to match against the rig moves.')
    ranked = match_signature(sig, lib, panel)
    if not ranked:
        return dict(move=None, confidence='none', strength=round(strength, 4),
                    ranked=[], reason='No library moves available to compare against.')
    best = ranked[0]
    second = ranked[1] if len(ranked) > 1 else dict(cosine=0.0, move=None)
    gap = best['cosine'] - second['cosine']

    if best['cosine'] < 0.72:
        conf, reason = 'low', ('Closest rig move is only a loose match - this is probably a '
                               'blended or hand-held move rather than one clean track.')
    elif gap < 0.06:
        conf, reason = 'low', ('%s and %s score within %.3f of each other, so the two cannot be '
                               'told apart from this clip.' % (best['move'], second['move'], gap))
    elif best['cosine'] >= 0.90 and gap >= 0.15:
        conf, reason = 'high', ''
    else:
        conf, reason = 'medium', ''

    return dict(move=best['move'], confidence=conf, cosine=best['cosine'],
                speed_ratio=best['speed_ratio'], strength=round(strength, 4),
                gap=round(gap, 4), ranked=ranked[:3], reason=reason)


def load_library(path=None):
    if path is None:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                            'rig_library.json')
    try:
        with open(path) as fh:
            return json.load(fh)
    except Exception:
        return {}


if __name__ == '__main__':
    main()
