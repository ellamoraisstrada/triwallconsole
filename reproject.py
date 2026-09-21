#!/usr/bin/env python3
"""
reproject.py — FIX B. One single-eyepoint panorama -> the five wall frusta.

THE IDEA, AND WHY IT IS THE RIGHT ONE
-------------------------------------
Every text-to-video model renders ONE camera frustum. The theatre is FIVE
off-axis frusta sharing one eyepoint, so parallax between L, LR and C is not a
style — it is a geometric consequence of where those planes sit relative to the
seat. No prompt can produce it, because the model has no eyepoint, no wall
normals and no depth. That is why the returns have never worked.

So do not ask it to. Generate ONE continuous panorama from the shared eyepoint,
where there are no seams and no parallax question at all, then reproject it into
the five frusta mathematically. For far-field content this is EXACT: it produces
the same geometry nDisplay produces, because nDisplay's own render is also a
single-eyepoint render.

    AI authors appearance. Geometry comes from here.

HOW IT WORKS
------------
For every output pixel on a wall:
  1. find that pixel's 3D position on the wall plane, in room coordinates;
  2. take the direction from the eyepoint to it;
  3. convert that direction to (azimuth, elevation);
  4. sample the panorama there.
Done with a precomputed cv2.remap table, so video is fast.

ROOM MODEL (plan view, looking down; +Y forward, +X right, +Z up)
  C   back wall, perpendicular to the forward axis
  LR  320px panel chamfering the left corner at 45 degrees
  L   left wall at 90 degrees, running forward toward the audience
  RR/R mirror of those
All tiles are 320x320, so PHYSICAL width is proportional to PIXEL width and the
whole plan can be laid out in pixel units without knowing the room in metres.

THE ONE NUMBER THAT IS NOT DERIVABLE FROM PIXELS
------------------------------------------------
How far the eyepoint sits from the centre wall. Pixel dimensions give the walls'
proportions but not the viewing distance, and that distance sets every wall's
angular size. It is exposed as --eye-dist (in the same pixel units) with a
default that makes the layout self-consistent. Measure it once in the room or
read it off the nDisplay config and pass it; everything else follows.

    python reproject.py pano.png --out out/            # five PNGs + stitched
    python reproject.py pano.mp4 --out out/ --video    # same, per frame
"""
import os, sys, json, argparse
import numpy as np
import cv2

TILE = 320
SEGMENTS = [
    dict(id='L',  w=3520, h=1600, x=0),
    dict(id='LR', w=320,  h=1600, x=3520),
    dict(id='C',  w=3840, h=1920, x=3840),
    dict(id='RR', w=320,  h=1600, x=7680),
    dict(id='R',  w=3520, h=1600, x=8000),
]
CANVAS_W, CANVAS_H = 11520, 2160


def plan_layout():
    """Walk the U in plan view and return each wall's two endpoints (x, y).

    Start at the centre wall's left end and walk left/forward: C, then the 45
    degree chamfer LR, then L running straight forward. Mirror for the right.
    Units are pixels; the eyepoint is placed later.
    """
    C = next(s for s in SEGMENTS if s['id'] == 'C')
    half = C['w'] / 2.0
    d = 0.0                     # centre wall sits at y = 0; eye is at negative y
    out = {}
    out['C'] = ((-half, d), (half, d))

    # Left chamfer, 45 degrees out toward the viewer. IMPORTANT: every segment's
    # endpoints must be listed in MOSAIC ORDER (pixel x = 0 first), not in the
    # order you happen to walk the room. On the canvas L occupies 0-3519 and LR
    # 3520-3839, so L's pixel x=0 is its OUTER (front) end and LR runs from the L
    # side toward C. Listing them the other way round samples the panorama
    # backwards and the wall comes out mirrored — which is exactly what the
    # azimuth ruler showed on the first run.
    lr = next(s for s in SEGMENTS if s['id'] == 'LR')
    k = lr['w'] / np.sqrt(2.0)
    corner = (-half - k, d - k)          # where LR meets L
    out['LR'] = (corner, (-half, d))      # L side -> C side

    # left wall: pixel x=0 is the FRONT (nearest the audience), running back to
    # the corner where it meets LR.
    L = next(s for s in SEGMENTS if s['id'] == 'L')
    out['L'] = ((corner[0], corner[1] - L['w']), corner)

    rr = next(s for s in SEGMENTS if s['id'] == 'RR')
    rr_start = (half, d)
    rr_end = (half + k, d - k)
    out['RR'] = (rr_start, rr_end)
    R = next(s for s in SEGMENTS if s['id'] == 'R')
    out['R'] = (rr_end, (rr_end[0], rr_end[1] - R['w']))
    return out


def build_maps(eye_dist, pano_w, pano_h, kind='equirect', scale=1.0):
    """Precompute the sampling table for every wall. Returns {id: (mapx, mapy)}.

    eye_dist: distance from the eyepoint to the CENTRE wall, in pixel units.
    The eye sits on the room's axis at y = -eye_dist, at the height of the
    common top edge minus a seated eye height (taken as the midpoint of the
    side walls, which is where a seated viewer's eyeline falls).
    """
    plan = plan_layout()
    # Top-aligned: every segment starts at y=0 and C hangs 320px lower. Put the
    # eye at the vertical middle of the SIDE walls, which is the seated eyeline.
    side_h = next(s for s in SEGMENTS if s['id'] == 'L')['h']
    eye_z = -side_h / 2.0        # z measured downward from the common top edge
    maps = {}
    for s in SEGMENTS:
        (x0, y0), (x1, y1) = plan[s['id']]
        ow, oh = int(s['w'] * scale), int(s['h'] * scale)
        u = (np.arange(ow) + 0.5) / ow          # 0..1 across the wall
        v = (np.arange(oh) + 0.5) / oh          # 0..1 down the wall
        U, V = np.meshgrid(u, v)
        # world position of each output pixel
        X = x0 + (x1 - x0) * U
        Y = y0 + (y1 - y0) * U
        Z = -(V * s['h'])                        # down from the common top edge
        # direction from the eyepoint
        dx = X - 0.0
        dy = Y - (-eye_dist)
        dz = Z - eye_z
        az = np.arctan2(dx, dy)                  # 0 = straight ahead, + = right
        if kind == 'cylindrical':
            # cylindrical: elevation is linear in height, not angular
            r = np.sqrt(dx * dx + dy * dy)
            el = dz / np.maximum(r, 1e-6)
            mapy = (0.5 - el * 0.5) * pano_h
        else:
            el = np.arctan2(dz, np.sqrt(dx * dx + dy * dy))
            mapy = (0.5 - el / np.pi) * pano_h
        mapx = (0.5 + az / (2 * np.pi)) * pano_w
        maps[s['id']] = (mapx.astype(np.float32), mapy.astype(np.float32))
    return maps


def remap_all(img, maps, scale=1.0):
    out = {}
    for s in SEGMENTS:
        mx, my = maps[s['id']]
        out[s['id']] = cv2.remap(img, mx, my, cv2.INTER_CUBIC,
                                 borderMode=cv2.BORDER_WRAP)
    return out


def stitch(walls, scale=1.0):
    canvas = np.zeros((int(CANVAS_H * scale), int(CANVAS_W * scale), 3), np.uint8)
    for s in SEGMENTS:
        w = walls[s['id']]
        x = int(s['x'] * scale)
        canvas[0:w.shape[0], x:x + w.shape[1]] = w
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('src')
    ap.add_argument('--out', default='out')
    ap.add_argument('--kind', default='equirect', choices=['equirect', 'cylindrical'])
    ap.add_argument('--eye-dist', type=float, default=2400.0,
                    help='eyepoint distance to the CENTRE wall, in pixel units '
                         '(same scale as the segment widths). Measure once and pass it.')
    ap.add_argument('--scale', type=float, default=1.0,
                    help='output scale; 0.25 gives a fast preview')
    ap.add_argument('--video', action='store_true')
    ap.add_argument('--no-stitch', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)

    if a.video:
        cap = cv2.VideoCapture(a.src)
        if not cap.isOpened():
            print(json.dumps(dict(error=f'cannot open {a.src}'))); sys.exit(1)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30
        ok, f0 = cap.read()
        if not ok:
            print(json.dumps(dict(error='empty video'))); sys.exit(1)
        ph, pw = f0.shape[:2]
        maps = build_maps(a.eye_dist, pw, ph, a.kind, a.scale)
        writers = {}
        cw, ch = int(CANVAS_W * a.scale), int(CANVAS_H * a.scale)
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        stitched = None if a.no_stitch else cv2.VideoWriter(
            os.path.join(a.out, 'wall_stitched.mp4'), fourcc, fps, (cw, ch))
        for s in SEGMENTS:
            writers[s['id']] = cv2.VideoWriter(
                os.path.join(a.out, f"wall_{s['id']}.mp4"), fourcc, fps,
                (int(s['w'] * a.scale), int(s['h'] * a.scale)))
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        n = 0
        while True:
            ok, f = cap.read()
            if not ok: break
            walls = remap_all(f, maps, a.scale)
            for k, wimg in walls.items(): writers[k].write(wimg)
            if stitched is not None: stitched.write(stitch(walls, a.scale))
            n += 1
        cap.release()
        for w in writers.values(): w.release()
        if stitched is not None: stitched.release()
        print(json.dumps(dict(ok=True, frames=n, fps=fps, out=a.out,
                              eye_dist=a.eye_dist, kind=a.kind, scale=a.scale), indent=2))
        return

    img = cv2.imread(a.src)
    if img is None:
        print(json.dumps(dict(error=f'cannot read {a.src}'))); sys.exit(1)
    ph, pw = img.shape[:2]
    maps = build_maps(a.eye_dist, pw, ph, a.kind, a.scale)
    walls = remap_all(img, maps, a.scale)
    written = {}
    for k, wimg in walls.items():
        p = os.path.join(a.out, f'wall_{k}.png')
        cv2.imwrite(p, wimg); written[k] = p
    if not a.no_stitch:
        p = os.path.join(a.out, 'wall_stitched.png')
        cv2.imwrite(p, stitch(walls, a.scale)); written['stitched'] = p
    print(json.dumps(dict(ok=True, source=a.src, pano=[pw, ph], written=written,
                          eye_dist=a.eye_dist, kind=a.kind, scale=a.scale), indent=2))


if __name__ == '__main__':
    main()
