#!/usr/bin/env python3
"""
motion_probe.py — decode camera motion from ANY client-supplied video or image
and emit a rig spec the Tri-Wall Console can turn into per-wall prompts.

Why this exists as a separate Python process rather than JS: the whole app
already shells out to CLIs (higgsfield, claude, ffmpeg), so one more is free,
and optical flow in pure JS is not. Requires numpy + opencv-python-headless.

    python motion_probe.py <path> [--panels auto|1|3] [--fov 60] [--json out.json]

WHAT IT MEASURES, and why each number is the one that matters
-------------------------------------------------------------
Measured against a real UE5/nDisplay tri-wall render (Video02) and a real
Higgsfield tri-wall set (Video01). See RIG_TARGETS in rig.js for the constants
those measurements produced.

  dx / dy      mean horizontal / vertical optical flow, px per sampled frame.
  near, far    dx sampled in the lower third (foreground) vs upper third
               (distance). Their DIFFERENCE is the parallax signal — a lens
               zoom moves both identically, a real dolly does not. This is the
               check that catches "it zoomed instead of moving", which is
               invisible to a whole-frame diff.
  radial       divergence: how strongly flow points away from frame centre.
               Strongly positive == forward dolly. This is the single most
               diagnostic number for a push-in.

  THE DECOMPOSITION (this is the part that answers "how many degrees did it
  turn"): given three walls sharing one eyepoint,
       yaw_component  = mean(dxL, dxC, dxR)     <- common mode: the whole rig
                                                   rotated, every view shifts
                                                   the same way
       push_component = (dxR - dxL) / 2         <- differential: content
                                                   spreading outward on the
                                                   sides == moving forward
  A pure pan has a large common mode and ~zero differential. A pure push-in
  has ~zero common mode and a large differential. Everything else is a blend,
  and reporting both separately is what lets the side walls compensate
  correctly instead of copying the centre.

  Degrees: a yaw of theta degrees shifts content by (theta/hfov)*width px, so
       yaw_deg_per_s = dx_common / width * hfov * fps
  Same for pitch with vfov. hfov defaults to 60 and is a knob, because we
  cannot recover the client's true lens from pixels alone — the RATIO between
  walls is exact, the absolute degrees are only as good as --fov.
"""
import sys, json, argparse, math
import numpy as np
import cv2

IMAGE_EXT = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'}

# ---------------------------------------------------------------- v3: match ---
# Measured on a real stitched deliverable that "did not match" when assembled in
# Premiere. Motion was only ONE of three faults, and the decoder was blind to the
# other two:
#
#   grade    LEFT warmth -28.9, CENTRE +20.2, RIGHT -12.2  -> the left wall was
#            49 points cooler than centre. RIGHT sat 31.7 darker than centre.
#   horizon  RIGHT horizon sat 12.4% of panel height higher than centre's, so the
#            eyeline visibly stepped at the seam.
#   motion   L/R symmetry 10.76 against a UE5 ground truth of 1.06 — the right
#            wall was essentially static while the left trucked.
#
# A decoder that reports only camera motion will pass a set that is unusable.
# These thresholds are what a human called "sloppy", turned into numbers.
MATCH_TOLERANCE = {
    'luma': 12.0,       # mean brightness, 0-255
    'warmth': 15.0,     # mean(R) - mean(B); colour temperature proxy
    'sat': 12.0,        # mean HSV saturation
    'contrast': 18.0,   # std of luma
    'horizon': 0.04,    # fraction of panel height
}


def grade_of(sub):
    """Lighting/colour fingerprint of one panel."""
    g = cv2.cvtColor(sub, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(sub, cv2.COLOR_BGR2HSV)
    return dict(
        luma=round(float(g.mean()), 2),
        p99=round(float(np.percentile(g, 99)), 2),
        black=round(float(np.percentile(g, 1)), 2),
        contrast=round(float(g.std()), 2),
        sat=round(float(hsv[..., 1].mean()), 2),
        warmth=round(float(sub[..., 2].mean() - sub[..., 0].mean()), 2),
    )


def horizon_of(sub):
    """Where the dominant horizontal edge sits, as a fraction of panel height.
    Across a tri-wall this is the eyeline: if it steps at a seam, the walls read
    as separate photographs no matter how well the motion matches."""
    g = cv2.GaussianBlur(cv2.cvtColor(sub, cv2.COLOR_BGR2GRAY), (5, 5), 0)
    gy = np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)).mean(axis=1)
    h = len(gy)
    lo, hi = int(h * .15), int(h * .92)
    return round(float((np.argmax(gy[lo:hi]) + lo) / h), 4)


def match_report(panels_grade, panels_horizon, motion):
    """Everything that has to agree across the three walls, with a verdict."""
    if not all(k in panels_grade for k in ('LEFT', 'CENTER', 'RIGHT')):
        return None
    C = panels_grade['CENTER']
    issues, deltas = [], {}
    for nm in ('LEFT', 'RIGHT'):
        g = panels_grade[nm]
        d = {k: round(g[k] - C[k], 2) for k in ('luma', 'warmth', 'sat', 'contrast')}
        d['horizon'] = round(panels_horizon[nm] - panels_horizon['CENTER'], 4)
        deltas[nm] = d
        for k, tol in MATCH_TOLERANCE.items():
            if abs(d[k]) > tol:
                issues.append(f'{nm} {k} is {d[k]:+} vs centre (tolerance ±{tol})')
    sym = (motion or {}).get('lr_symmetry_ratio')
    if sym is not None and abs(sym - 1.06) > 0.25:
        issues.append(f'left/right motion symmetry {sym} (target 1.06) — one side is '
                      f'moving faster than the other')
    # A badly mismatched plate makes the INTENT reading untrustworthy, and that
    # is worth saying out loud. The yaw/push split is common-mode vs
    # differential flow: if one side wall is barely moving while the other
    # trucks hard, the average looks like a rotation even though no rotation
    # happened. Observed for real — a plate whose left read -2.83 and right
    # +0.04 classified as "turn left 7.3 deg/s". Adopting that as the rig intent
    # would bake the fault in and repeat it.
    intent_trustworthy = True
    if sym is not None and sym > 3.0:
        intent_trustworthy = False
        issues.append(
            f'motion symmetry {sym} is so far off that the DETECTED CAMERA INTENT is '
            f'unreliable — with one side nearly static the average reads as a rotation '
            f'even when none happened. Fix the source or set the rig intent by hand '
            f'rather than adopting this reading.')
    return dict(deltas=deltas, issues=issues, ok=not issues,
                intent_trustworthy=intent_trustworthy,
                tolerance=MATCH_TOLERANCE)


# ---------------------------------------------------------------- panels ---
def detect_panels(cap, n, sample=48, min_w=40):
    """Find lit panel x-ranges. A tri-wall plate has dark seams between the
    three viewports; a plain client clip is one panel spanning full width."""
    acc = None
    for i in np.linspace(0, max(0, n - 1), sample).astype(int):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(i))
        ok, f = cap.read()
        if not ok:
            continue
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
        col = g.max(axis=0)
        acc = col if acc is None else np.maximum(acc, col)
    if acc is None:
        return []
    lit = acc > 22
    runs, s = [], None
    for x, v in enumerate(lit):
        if v and s is None:
            s = x
        elif not v and s is not None:
            if x - s >= min_w:
                runs.append((s, x))
            s = None
    if s is not None and len(lit) - s >= min_w:
        runs.append((s, len(lit)))
    return runs


def split_thirds(w, inset=0.02):
    """Fallback panel split for a plate with no detectable seams."""
    pad = int(w * inset)
    third = w // 3
    return [(pad, third - pad), (third + pad, 2 * third - pad), (2 * third + pad, w - pad)]


# ------------------------------------------------------------------ flow ---
def usable_runs(rows, luma_jump=6.0, resid_jump=None):
    """Split a flow series into runs of CONTINUOUS SHOT, discarding transitions.

    Why this exists: a real client clip is not one clean move. It fades up from
    black, dissolves between shots, cuts. Optical flow across a fade or a
    dissolve is not camera motion at all — the brightness ramp and the two
    superimposed images generate large spurious vectors. Averaging those into a
    camera estimate is how a clip that opens on a black title card and dissolves
    to a street got classified as a forward push-in.

    A sample is rejected when the frame's mean brightness jumps (fade/dissolve)
    or its flow magnitude spikes far above the local norm (cut). What survives is
    grouped into runs, and only the longest run is measured.
    """
    if not rows:
        return []
    # A cut generates an enormous flow spike — tens of pixels — while genuine
    # fast camera movement sits only a little above the clip's own norm. Judging
    # that against the MEDIAN rejected real motion (402 of 642 samples on a
    # legitimate push-in), so the bar is set off the 90th percentile with a
    # generous floor: only something far outside the clip's own range counts.
    mags = np.array([r['mag'] for r in rows if not r.get('dark')])
    p90 = float(np.percentile(mags, 90)) if len(mags) else 0.0
    spike = resid_jump if resid_jump is not None else max(8.0, p90 * 3.0)
    runs, cur = [], []
    for i, r in enumerate(rows):
        bad = False
        if i > 0 and abs(r['luma'] - rows[i - 1]['luma']) > luma_jump:
            bad = True                      # fade or dissolve
        if r['mag'] > spike:
            bad = True                      # cut, or a transition wipe
        if r.get('dark'):
            bad = True                      # black/near-black frame
        if bad:
            if cur: runs.append(cur)
            cur = []
        else:
            cur.append(r)
    if cur: runs.append(cur)
    return [r for r in runs if len(r) >= 3]


def flow_series(path, x0, x1, y0, y1, step, max_samples=500, dark_floor=10.0):
    cap = cv2.VideoCapture(path)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    prev, rows = None, []
    for i in range(0, min(n, max_samples * step), step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, f = cap.read()
        if not ok:
            break
        g = cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2GRAY)
        if g.size == 0:
            break
        g = cv2.resize(g, (max(16, g.shape[1] // 2), max(16, g.shape[0] // 2)))
        luma = float(g.mean())
        if luma < dark_floor:              # black/letterbox/fade-to-black frame
            prev = g
            rows.append(dict(f=int(i), t=round(i / fps, 3), dark=True, luma=luma,
                             dx=0.0, dy=0.0, dx_bg=0.0, near=0.0, far=0.0,
                             radial=0.0, expansion=0.0, mag=0.0))
            continue
        if prev is not None and prev.shape == g.shape:
            fl = cv2.calcOpticalFlowFarneback(prev, g, None, 0.5, 3, 25, 3, 5, 1.2, 0)
            h, w = fl.shape[:2]
            dx, dy = fl[..., 0], fl[..., 1]
            # Background bands only for the camera-motion estimate: a large
            # moving subject (the butterfly) otherwise dominates whole-frame dx
            # and fakes a camera move that never happened.
            edge = np.concatenate([dx[:, : max(1, w // 6)], dx[:, -max(1, w // 6):]], axis=1)
            xs = np.arange(w) - (w - 1) / 2.0
            radial = float((dx * xs[None, :]).sum() / (np.abs(xs).sum() * h + 1e-6))
            # `radial` is px/frame measured on the DOWNSCALED crop, so it is
            # not comparable across clips of different size. `expansion` is the
            # same quantity as a dimensionless fraction of half-width per
            # frame, which is scale-free and is what the push-rate uses.
            expansion = radial / max(1.0, w / 2.0)
            rows.append(dict(
                f=int(i), t=round(i / fps, 3),
                dx=float(dx.mean()), dy=float(dy.mean()),
                dx_bg=float(edge.mean()),
                near=float(dx[2 * h // 3:].mean()), far=float(dx[: h // 3].mean()),
                radial=radial, expansion=expansion, mag=float(np.abs(dx).mean()),
                luma=luma, dark=False,
            ))
        prev = g
    cap.release()
    return rows, fps


# --------------------------------------------------------------- elements ---
def track_element(path, x0, x1, y0, y1, step=6):
    """Find the most salient saturated blob that persistently crosses frame and
    report its trajectory as % of rig width over time. This is how the
    butterfly transit was measured: 17.5% of rig width per second, ~1.9s per
    wall, and it is the timing any 'element flies across all three walls'
    prompt has to hit to read as continuous."""
    cap = cv2.VideoCapture(path)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = max(1, x1 - x0)
    # First pass: which hue band is both saturated and rare (a highlight
    # element), rather than the scene's dominant colour.
    hist = np.zeros(180, np.float64)
    for i in range(0, n, max(1, n // 24)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, f = cap.read()
        if not ok:
            continue
        hsv = cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
        m = (hsv[..., 1] > 140) & (hsv[..., 2] > 80)
        if m.any():
            hist += np.bincount(hsv[..., 0][m].ravel(), minlength=180)
    if hist.sum() < 500:
        cap.release()
        return None
    # Rare-but-present hues make better element candidates than the modal hue.
    cand = [h for h in range(180) if hist[h] > hist.sum() * 0.002]
    if not cand:
        cap.release()
        return None
    hue = int(min(cand, key=lambda h: hist[h]))
    lo, hi = max(0, hue - 9), min(179, hue + 9)
    track = []
    for i in range(0, n, step):
        cap.set(cv2.CAP_PROP_POS_FRAMES, i)
        ok, f = cap.read()
        if not ok:
            break
        hsv = cv2.cvtColor(f[y0:y1, x0:x1], cv2.COLOR_BGR2HSV)
        m = cv2.inRange(hsv, (lo, 140, 80), (hi, 255, 255))
        area = int(m.sum() // 255)
        if area < 40:
            continue
        xs = np.where(m.any(axis=0))[0]
        track.append(dict(t=round(i / fps, 3), pct=round(100.0 * float(xs.mean()) / W, 2), area=area))
    cap.release()
    if len(track) < 6:
        return None
    span = max(p['pct'] for p in track) - min(p['pct'] for p in track)
    dur = track[-1]['t'] - track[0]['t']
    rate = span / dur if dur > 0 else 0
    # Guards tuned against the two real clips: the fall butterfly crosses 87.5%
    # at 17.5%/s, while ambient colour drift in the UE5 plate wanders ~25% at
    # 0.8%/s. Require BOTH a large span and a real rate, or slow background
    # drift gets reported as a choreographed element.
    if span < 40 or rate < 4.0:
        return None
    return dict(hue=hue, samples=track,
                span_pct=round(span, 1), duration_s=round(dur, 2),
                rate_pct_per_s=round(rate, 2),
                full_traverse_s=round(100.0 / rate, 2) if rate > 0.1 else None,
                per_wall_s=round(33.3 / rate, 2) if rate > 0.1 else None,
                direction='right_to_left' if track[-1]['pct'] < track[0]['pct'] else 'left_to_right')


# --------------------------------------------------------------- classify ---
def classify(walls, fps, hfov, width, height):
    """Turn per-wall flow into a rig intent + degrees. See module docstring."""
    def col(w, k):
        return np.array([r[k] for r in walls[w]]) if walls.get(w) else np.array([0.0])

    # Measure only CONTINUOUS SHOT. A client clip fades up, dissolves and cuts,
    # and optical flow across any of those is not camera motion. Taking the
    # longest clean run instead of the whole timeline is what stops a clip that
    # opens on a black title card from reading as a forward push.
    clean = {}
    for k, rows in walls.items():
        runs = usable_runs(rows or [])
        clean[k] = max(runs, key=len) if runs else []
    usable_s = round(max((len(v) for v in clean.values()), default=0) * 0.0 +
                     (len(max(clean.values(), key=len)) if any(clean.values()) else 0) / max(1e-6, fps) * 0, 2)

    have3 = all(clean.get(k) for k in ('LEFT', 'CENTER', 'RIGHT'))
    if have3:
        m = min(len(clean[k]) for k in ('LEFT', 'CENTER', 'RIGHT'))
        g = lambda w, key: np.array([r[key] for r in clean[w]])[:m]
        L = g('LEFT', 'dx_bg'); C = g('CENTER', 'dx_bg'); R = g('RIGHT', 'dx_bg')
        yaw_px = (L + C + R) / 3.0
        rad = g('CENTER', 'expansion')
        dyv = g('CENTER', 'dy')
        near = g('CENTER', 'near'); far = g('CENTER', 'far')
    else:
        only = clean.get('CENTER') or clean.get('LEFT') or []
        if not only:
            return dict(intent='unknown', confidence='none',
                        note='No continuous shot long enough to measure — the clip is mostly '
                             'fades, dissolves or cuts. Trim it to one uninterrupted move and retry.',
                        assumed_hfov_deg=hfov)
        yaw_px = np.array([r['dx_bg'] for r in only])
        rad = np.array([r['expansion'] for r in only])
        dyv = np.array([r['dy'] for r in only])
        near = np.array([r['near'] for r in only])
        far = np.array([r['far'] for r in only])
    rejected = sum(len(v or []) for v in walls.values()) - sum(len(v) for v in clean.values())

    vfov = 2 * math.degrees(math.atan(math.tan(math.radians(hfov / 2)) * (height / max(1, width))))
    # dx is measured on a half-scale crop, so px->degrees uses half the width.
    yaw_dps = float(np.mean(yaw_px) / max(1.0, width / 2.0) * hfov * fps)
    pitch_dps = float(np.mean(dyv) / max(1.0, height / 2.0) * vfov * fps)
    push_rate = float(np.mean(rad) * fps * 100.0)        # % half-width expansion / s
    parallax = float(np.mean(near - far))

    # COMPARE LIKE WITH LIKE. The old rule pitted degrees-per-second against
    # percent-per-second with an arbitrary 1.6 factor, which is meaningless —
    # a 1.2 deg/s pan lost to a 4%/s expansion and a lateral move was reported
    # as a push. Both are now expressed as a fraction of the frame per second.
    lateral_frac = float(np.mean(yaw_px) / max(1.0, width / 2.0) * fps)   # frac of half-width / s
    lateral_mag = float(np.mean(np.abs(yaw_px)) / max(1.0, width / 2.0) * fps)
    expand_frac = float(np.mean(rad) * fps)                               # frac of half-width / s
    # Steadiness: 1.0 = one sustained direction, near 0 = oscillation (handheld
    # sway, a wobble), which is not a rig move at all.
    steadiness = abs(lateral_frac) / max(1e-6, lateral_mag)

    # dominant intent
    absy, absp = abs(lateral_frac), abs(expand_frac)
    DEAD = 0.004          # below this, nothing meaningful is happening

    # TRUCK vs YAW — the distinction the classifier was missing entirely.
    #
    # Both a sideways TRANSLATION and a ROTATION produce uniform lateral flow in
    # a single view, so lateral magnitude alone cannot separate them. PARALLAX
    # can, and decisively: a rotation sweeps near and far at the SAME angular
    # rate (parallax ~ 0), while a translation makes near outrun far.
    #
    # Measured on a real side-scrolling clip: lateral 0.278 with parallax 1.448.
    # That is a truck. It was being reported as "yaw right", which then told the
    # side walls to sweep instead of to push in and pull out.
    PARALLAX_TRANSLATION = 0.15
    translating = abs(parallax) > PARALLAX_TRANSLATION

    # DIRECTION — the sign was also inverted. Turn your head right and the world
    # slides LEFT across your view; slide left and the world slides RIGHT. So
    # content moving right (positive dx) means the camera went LEFT, either by
    # translating or by turning. The old code reported the opposite.
    lateral_is_left = lateral_frac > 0
    pitch_is_up = pitch_dps > 0     # content sliding down => camera tilted up

    if lateral_mag > DEAD * 2 and lateral_mag > absp * 1.3 and steadiness < 0.45:
        intent = 'sway'   # oscillating/handheld — deliberately NOT a rig move
    elif absy < DEAD and absp < DEAD and abs(pitch_dps) < 0.8:
        intent = 'hold'
    elif absy >= DEAD and absy > absp * 0.8:
        # Lateral dominates. Parallax decides whether the rig moved or turned.
        if translating:
            intent = 'truck_left' if lateral_is_left else 'truck_right'
        else:
            intent = 'yaw_left' if lateral_is_left else 'yaw_right'
    elif absp >= DEAD and absp > absy * 1.3:
        intent = 'push_in' if expand_frac > 0 else 'pull_out'
    elif abs(pitch_dps) >= 0.8:
        intent = 'tilt_up' if pitch_is_up else 'tilt_down'
    else:
        intent = 'hold'

    sym = None
    if have3:
        ml, mr = abs(float(np.mean(L))), abs(float(np.mean(R)))
        sym = round(max(ml, mr) / max(1e-4, min(ml, mr)), 3)

    # How much of the clip was actually usable, and how clear the answer was.
    total = sum(len(v or []) for v in walls.values()) or 1
    kept = total - rejected
    usable_frac = kept / total
    margin = (max(absy, absp) / max(1e-6, min(absy, absp))) if min(absy, absp) > 0 else 99
    confidence = ('low' if usable_frac < 0.5 or margin < 1.4 or intent in ('sway', 'unknown')
                  else 'medium' if usable_frac < 0.8 or margin < 2.2 else 'high')

    notes = []
    if rejected:
        notes.append(f'{rejected} of {total} samples discarded as fades, dissolves or cuts — '
                     f'flow across a transition is not camera motion.')
    if intent == 'sway':
        notes.append('This reads as an oscillating/handheld sway, not a rig move. It is not one of '
                     'the tri-wall camera tracks; choose the intent by hand, or the side walls will '
                     'be derived from an unstable reference.')
    if margin < 1.4 and intent not in ('hold', 'sway', 'unknown'):
        notes.append(f'Lateral and forward components are within {margin:.1f}x of each other, so '
                     f'this is a blended move rather than a clean one — treat the label as a hint.')

    return dict(
        intent=intent,
        confidence=confidence,
        yaw_deg_per_s=round(yaw_dps, 3),
        pitch_deg_per_s=round(pitch_dps, 3),
        push_rate_pct_per_s=round(push_rate, 3),
        lateral_frac_per_s=round(lateral_frac, 5),
        expand_frac_per_s=round(expand_frac, 5),
        steadiness=round(steadiness, 3),
        samples_used=kept, samples_rejected=rejected,
        usable_fraction=round(usable_frac, 3),
        parallax_near_minus_far=round(parallax, 4),
        translating=bool(abs(parallax) > 0.15),
        is_zoom_not_move=bool(abs(parallax) < 0.02 and absp >= DEAD),
        lr_symmetry_ratio=sym,
        assumed_hfov_deg=hfov,
        vfov_deg=round(vfov, 2),
        notes=notes,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('path')
    ap.add_argument('--panels', default='auto', choices=['auto', '1', '3'])
    ap.add_argument('--fov', type=float, default=60.0)
    ap.add_argument('--step', type=int, default=0, help='frame stride; 0 = auto')
    ap.add_argument('--crop', default=None,
                    help='x0,y0,x1,y1 — analyse only this region (for a plate '
                         'embedded in a screen recording, or one row of a QC montage)')
    ap.add_argument('--json', default=None)
    a = ap.parse_args()
    crop = tuple(int(v) for v in a.crop.split(',')) if a.crop else None

    ext = '.' + a.path.rsplit('.', 1)[-1].lower() if '.' in a.path else ''
    if ext in IMAGE_EXT:
        img = cv2.imread(a.path)
        if img is None:
            print(json.dumps(dict(error=f'could not read image {a.path}'))); sys.exit(1)
        h, w = img.shape[:2]
        # A still has no motion, but it DOES have the grade and eyeline the other
        # walls must match — and that is the normal way a centre reference
        # arrives. Not measuring it left the grade lock with no numbers to
        # quote, so it fell back to vague wording the model ignored: a real
        # delivered set came back with its side walls 22 points cooler and 34
        # points less saturated than the centre.
        out = dict(source=a.path, kind='image', width=w, height=h,
                   aspect=round(w / h, 4),
                   motion=dict(intent='hold', note='single still — no motion to measure; '
                                                   'rig intent must be chosen, not decoded'),
                   panels={'CENTER': dict(grade=grade_of(img), horizon=horizon_of(img),
                                          x0=0, x1=w)},
                   elements=None)
        txt = json.dumps(out, indent=2)
        print(txt)
        if a.json: open(a.json, 'w').write(txt)
        return

    cap = cv2.VideoCapture(a.path)
    if not cap.isOpened():
        print(json.dumps(dict(error=f'could not open {a.path}'))); sys.exit(1)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)); H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    step = a.step or max(2, int(round(fps / 6)))     # ~6 samples/sec

    runs = detect_panels(cap, n)
    cap.release()
    CX0, CY0 = 0, 0
    if crop:
        CX0, CY0, cx1, cy1 = crop
        W, H = cx1 - CX0, cy1 - CY0
        runs = [(max(0, s - CX0), min(W, e - CX0)) for s, e in runs]
        runs = [r for r in runs if r[1] - r[0] >= 40]
    if a.panels == '3':
        panels = runs if len(runs) == 3 else split_thirds(W)
    elif a.panels == '1':
        panels = [(0, W)]
    else:
        # A wide plate (>3.5:1) is almost certainly a tri-wall canvas even if
        # the seams aren't black; a normal clip is one view.
        if len(runs) == 3:
            panels = runs
        elif W / max(1, H) > 3.5:
            panels = split_thirds(W)
        else:
            panels = [(0, W)]

    names = ['LEFT', 'CENTER', 'RIGHT'] if len(panels) == 3 else ['CENTER']
    walls, summary = {}, {}
    for nm, (x0, x1) in zip(names, panels):
        rows, _ = flow_series(a.path, CX0 + x0, CX0 + x1, CY0, CY0 + H, step)
        walls[nm] = rows
        if rows:
            summary[nm] = dict(
                x0=int(x0), x1=int(x1), samples=len(rows),
                dx=round(float(np.mean([r['dx'] for r in rows])), 4),
                dx_bg=round(float(np.mean([r['dx_bg'] for r in rows])), 4),
                near=round(float(np.mean([r['near'] for r in rows])), 4),
                far=round(float(np.mean([r['far'] for r in rows])), 4),
                parallax=round(float(np.mean([r['near'] - r['far'] for r in rows])), 4),
                radial=round(float(np.mean([r['radial'] for r in rows])), 4),
            )

    pw = panels[len(panels) // 2]
    motion = classify(walls, fps, a.fov, pw[1] - pw[0], H)

    # LIBRARY MATCH — compare the CENTRE wall against the theatre's own recorded
    # moves (C_PushIn.mp4 and the rest, measured by learn_rig.py). This is the
    # answer that should be trusted over the heuristic classifier above, because
    # it is a comparison against what this room actually does rather than
    # against thresholds someone chose. When the two disagree the match wins and
    # both are reported, so the disagreement is visible instead of silent.
    match = None
    try:
        import learn_rig as _LR
        _lib = _LR.load_library()
        if _lib:
            cbox = (CX0 + pw[0], CX0 + pw[1], CY0, CY0 + H)
            _sig = _LR.measure_region(a.path, box=cbox)
            if _sig:
                match = _LR.classify_against_library(_sig, _lib)
                match['signature'] = _sig
                if match.get('move'):
                    motion['library_move'] = match['move']
                    motion['library_confidence'] = match['confidence']
                    # Adopt it as the intent only when the match is actually
                    # trustworthy; a low-confidence guess must not silently
                    # rewrite the rig.
                    if match['confidence'] in ('high', 'medium'):
                        motion['heuristic_intent'] = motion.get('intent')
                        motion['intent'] = match['move']
                        if motion['heuristic_intent'] and                            _LR and match['move'] != motion['heuristic_intent']:
                            motion.setdefault('notes', []).append(
                                "Matched %s against the theatre's own reference renders "
                                '(cosine %.3f, %s confidence). The threshold-based reading was '
                                '"%s" - the reference match is the one being used.'
                                % (match['move'], match.get('cosine', 0),
                                   match['confidence'], motion['heuristic_intent']))
                elif match.get('reason'):
                    motion.setdefault('notes', []).append(match['reason'])
    except Exception as _e:
        match = dict(error=str(_e))
    elements = track_element(a.path, CX0 + panels[0][0], CX0 + panels[-1][1], CY0, CY0 + H)

    # v3: lighting and eyeline, measured on a mid-clip frame. Motion alone was
    # never enough to tell whether a set would stitch.
    grades, horizons = {}, {}
    cap2 = cv2.VideoCapture(a.path)
    cap2.set(cv2.CAP_PROP_POS_FRAMES, int(n // 2))
    okm, midf = cap2.read()
    cap2.release()
    if okm:
        for nm, (x0, x1) in zip(names, panels):
            sub = midf[CY0:CY0 + H, CX0 + x0:CX0 + x1]
            if sub.size:
                grades[nm] = grade_of(sub)
                horizons[nm] = horizon_of(sub)
                if nm in summary:
                    summary[nm]['grade'] = grades[nm]
                    summary[nm]['horizon'] = horizons[nm]

    out = dict(source=a.path, kind='video', width=W, height=H, fps=round(fps, 3),
               frames=n, duration_s=round(n / fps, 2), aspect=round(W / max(1, H), 4),
               panel_mode=f'{len(panels)}-panel', panels=summary,
               motion=motion, elements=elements, library_match=match,
               match=match_report(grades, horizons, motion))
    txt = json.dumps(out, indent=2)
    print(txt)
    if a.json:
        open(a.json, 'w').write(txt)


if __name__ == '__main__':
    main()
