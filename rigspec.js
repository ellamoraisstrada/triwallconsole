// rigspec.js — the NUMBERS. One place where "how the camera moves" is a
// quantity rather than an adjective.
//
// WHY THIS FILE EXISTS
// --------------------
// The prompts said "slides steadily toward the LEFT edge" and "opens outward".
// A video model reads that and picks its own direction and its own speed, and
// the delivered sets proved it: one wall ran backwards, one ran at roughly
// three times the reference, and one had no camera move at all — just objects
// sliding over a fixed background. Prose cannot state a velocity. This file
// states velocities, total excursions, scale factors and timestamped landmark
// positions, and the prompt quotes them.
//
// WHERE THE NUMBERS COME FROM
// ---------------------------
// The four reference renders (C_PushIn, C_PushOut, C_TrackLeft, C_TrackRight).
// Each is the WHOLE 11520x2160 nDisplay canvas scaled to 1920x1080 — verified,
// not assumed: the coloured strip sits at y 360..720 and splits into three
// exactly-640px panels, which is the canvas at 1/6 scale. So
//
//     panel 1  master x [    0,  3840)  =  L (3520) + LR (320)   <- LEFT view
//     panel 2  master x [ 3840,  7680)  =  C (3840)              <- CENTRE view
//     panel 3  master x [ 7680, 11520)  =  RR (320) + R (3520)   <- RIGHT view
//
// All three views are exactly one third of the canvas. (A review pass claimed
// the side views were 4608px and every rate was therefore 2.5x wrong. It is
// not: 3520 + 320 = 3840. The only unit correction the sides need is the 1.09
// between the 3840px VIEW and the 3520px WALL the tool actually delivers, and
// that is applied below.)
//
// Each panel was decomposed frame to frame into a similarity transform
// (translation, uniform scale, rotation) fitted by RANSAC to sparse
// Lucas-Kanade correspondences, then accumulated over the clip. That is a
// different estimator from the Farneback flow in learn_rig.py, and it
// reproduced those figures to within a few percent on all twelve panel/move
// cells — which is the only reason these are quoted as measurements rather
// than as readings.
//
// THE DIRECTION QUESTION, SETTLED
// -------------------------------
// On C_PushIn the two side walls move APART: LEFT content travels to frame
// left at -31.4%/s, RIGHT content travels to frame right at +33.3%/s, while
// the centre expands x1.43/s with no lateral drift. Three independent passes
// now agree (Farneback medians, sparse LK displacement, RANSAC similarity),
// and it is what a forward dolly must do — you walk toward the far wall, and
// the side scenery flows backward past you, out of the rear end of each side
// view. Stated without left/right, which is where the confusion lives:
//
//     PUSH IN  — side walls travel from the SEAM edge toward the OUTER edge.
//     PUSH OUT — side walls travel from the OUTER edge toward the SEAM edge.
//
// (The seam edge is the one that touches the centre wall: the RIGHT edge of
// the left wall's frame, the LEFT edge of the right wall's frame.)
//
// SPEED: A RATE THE OPERATOR SETS
// -------------------------------
// This USED to freeze the total excursion, so every clip travelled the same
// distance whatever its length. That killed the "three times too far" bug but
// left no control of pace at all: a 15-second clip just crawled through the
// same gesture, and the km/h box governed nothing.
//
// The tables below are still the reference GESTURE (they fix the direction and
// the ratios between the three walls), but spec() now reads them as a rate at
// the reference's own duration and re-paces them by the speed dial, so
//
//     dx_total = dx_per_second x duration
//
// and one speed means the same thing at 4 seconds and at 15. See the speed
// dial section below for where 100% comes from and how it was measured.

const REF_VIEW_PX = 3840;      // one nDisplay view, master pixels
const MASTER_H = 2160;
const FPS = 30;

// Delivered wall sizes. theatre.js is the source of truth; these are the
// conversion factors, checked against it at load.
const WALL_PX = { left: 3520, center: 3840, right: 3520 };
const WALL_H = { left: 1600, center: 1920, right: 1600 };

// Totals over one reference gesture, in VIEW widths (3840 master px).
// dx      + = content travels toward frame RIGHT
// scale   linear zoom factor over the whole gesture; 1.0 = no scale change
// Left/right pairs are symmetrised: the rig is symmetric, and the raw spread
// between the two sides is scene content (the right side of this particular
// room has nearer objects), not rig behaviour. Raw readings sit in the comment
// beside each line so nothing is hidden.
const MOVES = {
  C_PushIn: {
    label: 'C_PushIn — the rig travels forward into the room',
    refClip: 'C_PushIn.mp4', refDur: 1.93,
    kind: 'dolly', sign: +1,
    walls: {
      // raw: L dx -0.607 scale 1.07 | R dx +0.643 scale 1.24
      left:   { dx: -0.61, dy: 0, scale: 1.10, roll: 0 },
      center: { dx:  0.00, dy: 0, scale: 2.00, roll: 0 },   // raw 2.01
      right:  { dx: +0.61, dy: 0, scale: 1.10, roll: 0 },
    },
  },
  C_PushOut: {
    label: 'C_PushOut — the rig withdraws backward out of the room',
    refClip: 'C_PushOut.mp4', refDur: 1.83,
    kind: 'dolly', sign: -1,
    walls: {
      // raw: L dx +0.571 scale 0.93 | R dx -0.600 scale 0.81
      left:   { dx: +0.61, dy: 0, scale: 0.91, roll: 0 },
      center: { dx:  0.00, dy: 0, scale: 0.50, roll: 0 },   // raw 0.51
      right:  { dx: -0.61, dy: 0, scale: 0.91, roll: 0 },
    },
  },
  C_TrackLeft: {
    label: 'C_TrackLeft — the whole rig slides to its left, still facing forward',
    refClip: 'C_TrackLeft.mp4', refDur: 1.60,
    kind: 'truck', sign: +1,
    walls: {
      // raw: L dx +0.397 scale 2.16 | C dx +0.588 scale 1.01 | R dx +0.396 scale 0.41
      left:   { dx: +0.40, dy: 0, scale: 2.30, roll: 0 },   // approaching -> grows
      center: { dx: +0.59, dy: 0, scale: 1.00, roll: 0 },   // pure slide, no zoom
      right:  { dx: +0.40, dy: 0, scale: 0.435, roll: 0 },  // receding -> shrinks
    },
  },
  C_TrackRight: {
    label: 'C_TrackRight — the whole rig slides to its right, still facing forward',
    refClip: 'C_TrackRight.mp4', refDur: 1.70,
    kind: 'truck', sign: -1,
    walls: {
      // raw: L dx -0.396 scale 0.46 | C dx -0.624 scale 0.98 | R dx -0.434 scale 2.60
      left:   { dx: -0.40, dy: 0, scale: 0.435, roll: 0 },
      center: { dx: -0.59, dy: 0, scale: 1.00, roll: 0 },
      right:  { dx: -0.40, dy: 0, scale: 2.30, roll: 0 },
    },
  },
  C_Hold: {
    label: 'C_Hold — the rig is locked off',
    refClip: null, refDur: 0,
    kind: 'static', sign: 0,
    walls: {
      left:   { dx: 0, dy: 0, scale: 1, roll: 0 },
      center: { dx: 0, dy: 0, scale: 1, roll: 0 },
      right:  { dx: 0, dy: 0, scale: 1, roll: 0 },
    },
  },
};

// The house coherent-lateral-flow ceiling for the side walls, from the wall
// brief's energy table: 6 px per frame at master resolution. Reported, never
// silently applied — the reference gesture itself runs above it because it is a
// two-second beat, and quietly slowing a move the user asked to match is how
// the tool ended up disagreeing with its own verifier.
const SAFE_PX_PER_FRAME = 6;

// ----------------------------------------------------------- the speed dial ---
// SPEED IS A RATE NOW, NOT A TOTAL. This inverts what this file used to do, and
// the reason is worth stating because the old rule is still written in README
// section 6 ("scale by total excursion, never by per-second rate").
//
// That rule existed to stop a 1.9-second reference BEAT being replayed as a
// 5-second clip's per-second rate, which asked for ~3x the travel. It solved
// that by freezing the total: every clip travelled the same distance whatever
// its length, so a 15-second clip just crawled. The operator had no control of
// pace at all - the km/h box was inert, feeding one advisory string into the
// contract and governing nothing.
//
// What the owner asked for instead: one linear speed that means the same thing
// at 4 seconds and at 15 seconds, so distance = rate x duration.
//
// WHERE 100% COMES FROM. Six operator reference clips (L_Clouds, R_Clouds,
// R_BLDG, L_grass, R_Desert, L_Desert), each measured twice - by wall_motion.py
// (RANSAC similarity) and by accumulated phase correlation. The two estimators
// agreed on sign in all six and within 17% on magnitude:
//
//     clip        wall_motion   phase-corr    mean |dx|/s
//     L_Clouds      0.0026        0.0091        0.0059
//     R_Clouds      0.0072        0.0210        0.0141
//     R_BLDG        0.2349        0.2072        0.2211
//     L_grass       0.1439        0.1247        0.1343
//     R_Desert      0.0356        0.0294        0.0325
//     L_Desert      0.0990        0.1028        0.1009
//                                      mean =   0.0848
//
// Every L_ clip travelled toward frame LEFT and every R_ clip toward frame
// RIGHT - independently confirming the push-in topology already in MOVES.
// (The two cloud clips sit far below the rest: their camera barely translates
// and almost all of their apparent motion is the cloud layer itself. Excluding
// them raises the benchmark to 0.1222. The owner asked for all six averaged.)
const BENCHMARK_DX_RATE = 0.0848;   // frame widths per second at Speed = 100%

// THE CENTRE RUNS AT A QUARTER OF THE REFERENCE RATIO. This is the standard,
// not a starting point, and it is set from delivered output rather than from
// the nDisplay render.
//
// The reference render pairs a side dx of 0.61 view widths with a centre scale
// of x2.00, and holding that ratio is what the gesture model does by default.
// The generator does not honour it: over three delivered sets the sides tracked
// what they were asked while the centre overshot its scale by 3-9x, and the
// centre's delivered rate barely moved with the ask at all. A set built on the
// raw reference ratio therefore lands as a fast centre between two slow sides,
// every time, whatever the speed dial says.
//
// 25 was arrived at from the wall, by the owner, watching stitched output - "the
// centre should be about 75% slower to match the sides". An earlier 65 was still
// visibly too fast. The Centre % box overrides it per scene; this is what it
// starts at, and what a contract built without an explicit rig uses.
const CENTRE_TRIM_DEFAULT = 25;     // percent, applied to the centre wall only

// The theatre's own reference gesture runs much harder than that. This is the
// side wall's rate in the SAME units, so SPEED_UNITY below is the honest
// statement of how much gentler the operator's clips are: 100% on the dial is
// about a quarter of the nDisplay render's pace.
//   C_PushIn left: 0.61 view widths x (3840/3520) = 0.6655 over refDur 1.93 s
const REF_SIDE_DX_RATE = 0.61 * (REF_VIEW_PX / 3520) / 1.93;   // 0.3448 fw/s
const SPEED_UNITY = BENCHMARK_DX_RATE / REF_SIDE_DX_RATE;      // 0.2460

// Scale rides the same dial, in log space, so every ratio the reference render
// measured between the walls survives at any speed. Cross-check that this is
// not arbitrary: at 100% it puts the SIDE walls' scale at x1.0122/s, and the
// six reference clips measured x1.0113/s. Those agree to 0.1%, which is the
// only reason the centre's much larger scale is trusted to the same coupling.
// The reference gesture's own side-wall excursion, in delivered frame widths.
// Both presets share it (C_PushOut is C_PushIn reversed), which is what lets
// the two stay EXACT inverses of each other at every speed and duration.
const REF_SIDE_DX_TOTAL = 0.61 * (REF_VIEW_PX / 3520);   // 0.6655

// How much of the reference gesture this clip performs.
//
//     g = speed x BENCHMARK_DX_RATE x duration / REF_SIDE_DX_TOTAL
//
// Note what is NOT in that: refDur. An earlier pass divided each move by its
// own reference clip length, and because C_PushIn.mp4 is trimmed to 1.93 s and
// C_PushOut.mp4 to 1.83 s, the two presets stopped being exact inverses
// (-0.424 against +0.447 on the same wall). They are the same gesture played
// in opposite directions - README section 3 verified that frame by frame - so
// the trim difference is measurement noise and must not reach the contract.
// Working in gesture-fractions makes clip length drop out algebraically.
function gestureFraction(speedPct, T) {
  const p = Number(speedPct);
  const pct = (Number.isFinite(p) && p > 0 ? p : 100) / 100;
  return pct * BENCHMARK_DX_RATE * T / REF_SIDE_DX_TOTAL;
}

// HOW SMALL A SCALE CHANGE IS WORTH STATING, per wall.
//
// One flat 0.15 used to cover both, and trimming the centre exposed why that
// is wrong. The centre's ONLY motion is scale - it is a dolly with dx = 0 - so
// flattening a x1.117 push to "no size change" does not slow the centre down,
// it switches the centre off, and the contract then actively says "no zoom, no
// dolly, nothing gets bigger or smaller" on the one wall whose whole job is to
// push. At 25% and 5 s that is exactly what happened.
//
// A side wall is the opposite case: its move is dx, its scale is incidental,
// and a side wall that invents a zoom is a failure this project has measured
// more than once (x0.58 against a contract that said 1.00). There the wide
// deadzone is protection and it stays.
function zoomDeadzone(wall) { return wall === 'center' ? 0.02 : 0.15; }

function normalise(id) {
  if (id && MOVES[id]) return id;
  const legacy = {
    push_in: 'C_PushIn', pull_out: 'C_PushOut', push_out: 'C_PushOut',
    truck_left: 'C_TrackLeft', truck_right: 'C_TrackRight',
    track_left: 'C_TrackLeft', track_right: 'C_TrackRight',
    hold: 'C_Hold', sway: 'C_Hold', unknown: 'C_Hold',
    // Turns and tilts are no longer offered. If saved state or the decoder
    // still names one, the nearest offered move is used and the caller is told
    // by `substituted` on the spec.
    C_TurnLeft: 'C_TrackLeft', C_TurnRight: 'C_TrackRight',
    yaw_left: 'C_TrackLeft', yaw_right: 'C_TrackRight',
    C_TiltUp: 'C_Hold', C_TiltDown: 'C_Hold', tilt_up: 'C_Hold', tilt_down: 'C_Hold',
  };
  return legacy[id] || 'C_PushIn';
}

function wallKey(w) {
  return (w === 'left' || w === 'right' || w === 'center') ? w : 'center';
}

function round(x, n) { const f = Math.pow(10, n); return Math.round(x * f) / f; }

/**
 * The full numeric spec for one wall of one move at one clip length.
 * Everything downstream — prompt text, inspector, verifier — reads this, so
 * there is exactly one place where a number can be wrong.
 */
function spec(moveId, wallId, durationSec, speedPct, centrePct) {
  const id = normalise(moveId);
  const m = MOVES[id];
  const w = wallKey(wallId);
  const raw = m.walls[w];
  const T = Math.max(0.5, Number(durationSec) || 5);

  // View widths -> delivered wall widths. The sides are delivered 3520 wide but
  // were measured across a 3840 view, so the same world travel is a slightly
  // larger fraction of the delivered frame.
  const conv = REF_VIEW_PX / WALL_PX[w];

  // The reference gesture, converted to a PER-SECOND rate at the reference's
  // own duration, then re-paced by the speed dial. Reading the gesture as a
  // rate is what lets one speed mean the same thing at 4 s and at 15 s; the
  // ratios between the three walls are untouched, so the rig still moves as
  // one body however hard it is driven.
  // THE CENTRE GETS ITS OWN TRIM, because it does not obey like the sides do.
  //
  // Measured over three delivered sets: the side walls tracked what they were
  // asked (delivered/asked 1.44, 0.84, 1.71 - mean 1.33), while the centre
  // overshot its scale by 3-9x and its delivered rate barely moved with the
  // ask at all (asked ~1.017/s every time; delivered 1.05, 1.16, 1.17/s, which
  // tracks DURATION, not the number it was given). One dial cannot serve two
  // walls that respond that differently: set it so the sides look right and the
  // centre runs hot, set it so the centre looks right and the sides crawl.
  //
  // So `centrePct` trims the centre alone, on top of the main speed. 100 means
  // "keep the reference ratio between centre and sides"; lower slows the centre
  // without touching the sides. It multiplies the gesture fraction, so it acts
  // on the centre's scale exponent and stays consistent at every duration.
  const cp = Number(centrePct);
  const centreTrim = w === 'center'
    ? ((Number.isFinite(cp) && cp > 0) ? cp : CENTRE_TRIM_DEFAULT) / 100
    : 1;
  const g = gestureFraction(speedPct, T) * centreTrim;
  const dxTotal = raw.dx * conv * g;
  const dxRate = dxTotal / T;                       // frame-widths per second
  const dyTotal = raw.dy * (MASTER_H / WALL_H[w]) * g;

  // Scale compounds, so it takes the gesture fraction as an exponent. Because
  // the two presets' raw scales are exact reciprocals (x2.00 and x0.50), so are
  // their results at any speed and any duration.
  const scaleTotal = Math.pow(raw.scale, g);
  const scaleRate = Math.pow(scaleTotal, 1 / T);
  const pxPerFrame = Math.abs(dxTotal) * WALL_PX[w] / (T * FPS);

  const seamEdge = w === 'left' ? 'RIGHT' : w === 'right' ? 'LEFT' : null;
  const outerEdge = w === 'left' ? 'LEFT' : w === 'right' ? 'RIGHT' : null;
  const towardEdge = dxTotal === 0 ? null : (dxTotal > 0 ? 'RIGHT' : 'LEFT');
  const towardSeam = towardEdge && seamEdge ? towardEdge === seamEdge : null;

  return {
    move: id, label: m.label, wall: w, kind: m.kind,
    // Only a genuine substitution counts: a turn or a tilt is no longer an
    // offered preset, so it silently becomes the nearest translation and the
    // UI must say so. A legacy alias for a move that still exists is not a
    // substitution and must not raise a mismatch warning.
    substituted: (moveId && !MOVES[moveId] && /Turn|Tilt|yaw|tilt/.test(String(moveId)))
      ? String(moveId) : null,
    refClip: m.refClip, refDur: m.refDur,
    speedPct: round(g * REF_SIDE_DX_TOTAL / (BENCHMARK_DX_RATE * T) * 100, 1),
    durationSec: T, framePx: WALL_PX[w], frameH: WALL_H[w], fps: FPS,
    dxTotal: round(dxTotal, 4), dxRate: round(dxRate, 4),
    dyTotal: round(dyTotal, 4), dyRate: round(dyTotal / T, 4),
    scaleTotal: round(scaleTotal, 4), scaleRate: round(scaleRate, 4),
    rollTotal: raw.roll,
    pxPerFrame: round(pxPerFrame, 2),
    overSafeCap: pxPerFrame > SAFE_PX_PER_FRAME && w !== 'center',
    calmDurationSec: pxPerFrame > SAFE_PX_PER_FRAME
      ? round(Math.abs(dxTotal) * WALL_PX[w] / (SAFE_PX_PER_FRAME * FPS), 1) : null,
    seamEdge, outerEdge, towardEdge, towardSeam,
  };
}

/**
 * Where a landmark starting at x0 (fraction of frame width) sits at time t.
 * Scale is about frame centre, translation is uniform — the same model that
 * was fitted to the reference, so the table and the measurement agree.
 */
function posAt(sp, x0, t) {
  const f = t / sp.durationSec;
  const s = Math.pow(sp.scaleTotal, f);
  return 0.5 + (x0 - 0.5) * s + sp.dxTotal * f;
}

function posAtY(sp, y0, t) {
  const f = t / sp.durationSec;
  const s = Math.pow(sp.scaleTotal, f);
  return 0.5 + (y0 - 0.5) * s + sp.dyTotal * f;
}

/**
 * The landmark clock: five timestamps, three anchor positions, as fractions of
 * frame width. This is the part a human can check on a timeline and a model can
 * actually aim at, and it is why the prompt now contains numbers.
 */
function landmarkRows(sp, anchors, steps) {
  const A = anchors || anchorsFor(sp.dxTotal);
  const N = steps || 4;
  const times = [];
  for (let i = 0; i <= N; i++) times.push(round(sp.durationSec * i / N, 2));
  return {
    times,
    rows: A.map(x0 => ({
      x0,
      xs: times.map(t => round(posAt(sp, x0, t), 3)),
      ys: times.map(t => round(posAtY(sp, x0, t), 3)),
      exits: times.reduce((acc, t) => {
        const x = posAt(sp, x0, t);
        return acc === null && (x < 0 || x > 1) ? t : acc;
      }, null),
    })),
  };
}

function pct(x) { return (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%'; }

/**
 * The block the locked prompt carries. Numbers first, prose only to say what
 * the numbers mean.
 */
function numericBlock(moveId, wallId, durationSec, speedPct, centrePct) {
  const sp = spec(moveId, wallId, durationSec, speedPct, centrePct);
  const NL = String.fromCharCode(10);
  const L = [];
  const wallName = sp.wall === 'center' ? 'CENTRE WALL' : sp.wall.toUpperCase() + ' WALL';

  L.push('CAMERA PATH — ' + sp.label);
  L.push(wallName + '. Delivered frame ' + sp.framePx + ' x ' + sp.frameH + ' px, '
       + sp.durationSec.toFixed(2) + ' s at ' + sp.fps + ' fps.');
  L.push('All positions below are fractions of the frame: x = 0.000 is the left edge, x = 1.000 the right edge.');
  L.push('');

  if (sp.kind === 'static') {
    L.push('MEASURED TARGETS: dx = 0.000, scale = 1.000, roll = 0 deg. The camera does not move at all.');
    L.push('Every edge of the frame stays exactly where it is. Only things inside the scene may move.');
    return L.join(NL);
  }

  // A machine-readable copy first. The same figures appear in prose below,
  // because a video model reads prose better than a struct, but the JSON is
  // unambiguous and it is what the operator can diff against the verifier.
  L.push('CAMERA_SPEC = ' + JSON.stringify({
    move: sp.move, wall: sp.wall, duration_s: sp.durationSec, fps: sp.fps,
    frame_px: [sp.framePx, sp.frameH],
    dx_total_frac: sp.dxTotal, dx_per_s_frac: sp.dxRate, dx_px_per_frame: sp.pxPerFrame,
    dy_total_frac: 0, scale_total: sp.scaleTotal, scale_per_s: sp.scaleRate,
    roll_deg: 0, yaw_deg: 0, pitch_deg: 0, easing: 'none', velocity: 'constant',
  }));
  L.push('');
  L.push('MEASURED TARGETS (from ' + sp.refClip + ', the theatre\'s own nDisplay render):');
  L.push('  horizontal travel   dx = ' + pct(sp.dxTotal) + ' of frame width over the clip = '
       + pct(sp.dxRate) + ' per second = ' + sp.pxPerFrame.toFixed(1) + ' px per frame at '
       + sp.framePx + ' px wide');
  L.push('  scale               x' + sp.scaleTotal.toFixed(2) + ' over the clip = x'
       + sp.scaleRate.toFixed(3) + ' per second');
  L.push('  vertical travel     dy = 0.000  — the frame must not drift up or down');
  L.push('  roll                0.0 deg     — the horizon must not tip');
  L.push('  yaw / pitch         none        — the camera does not turn, and does not look up or down');
  L.push('  Constant velocity. No ease in, no ease out, no hold, no acceleration, no handheld drift.');
  L.push('');

  // Direction, stated twice in two different vocabularies, because this is the
  // single term that has been wrong in delivered sets.
  if (sp.towardEdge) {
    const seamClause = sp.seamEdge
      ? ' This wall\'s ' + sp.seamEdge + ' edge is the SEAM where it meets the centre wall; its '
        + sp.outerEdge + ' edge is the OUTER end of the room. So content travels '
        + (sp.towardSeam ? 'from the OUTER end TOWARD the seam' : 'from the SEAM TOWARD the outer end')
        + ', and the new material that enters frame appears at the '
        + (sp.towardSeam ? sp.outerEdge : sp.seamEdge) + ' edge.'
      : '';
    L.push('DIRECTION: every landmark moves toward the ' + sp.towardEdge + ' edge of frame. '
         + 'Its x value ' + (sp.dxTotal > 0 ? 'INCREASES' : 'DECREASES') + ' with time.' + seamClause);
  } else {
    L.push('DIRECTION: no sideways drift at all. dx = 0.000. Content expands or contracts about the '
         + 'exact centre of frame, symmetrically — the left half moves left by the same amount the '
         + 'right half moves right.');
  }
  L.push('');

  // The clock.
  const lm = landmarkRows(sp);
  L.push('LANDMARK CLOCK — pick a distinct landmark in the supplied reference image at each starting');
  L.push('x below, name it, and put it at these positions at these timestamps. A value below 0.000 or');
  L.push('above 1.000 means that landmark has left the frame by then and must not be visible:');
  L.push('  landmark start    ' + lm.times.map(t => ('t=' + t.toFixed(2) + 's').padStart(10)).join(''));
  for (const r of lm.rows) {
    let line = '  x0 = ' + r.x0.toFixed(2) + '        '
      + r.xs.map(v => v.toFixed(3).padStart(10)).join('');
    if (r.exits !== null) line += '   (out of frame by t=' + r.exits.toFixed(2) + 's)';
    L.push(line);
  }
  if (Math.abs(sp.scaleTotal - 1) > 0.02) {
    L.push('  Vertical follows the same scale about frame centre: a landmark at y0 sits at '
         + '0.5 + (y0 - 0.5) x ' + sp.scaleTotal.toFixed(2) + ' at the end of the clip.');
  }
  L.push('');

  // The failure this block exists to stop.
  L.push('THIS IS A CAMERA MOVE, NOT AN ANIMATION. Every pixel obeys the table above — the furthest');
  L.push('background, the sky, the ground, the horizon line, the buildings, everything. If the');
  L.push('background is held and only the foreground objects travel, the shot is wrong and will be');
  L.push('rejected. Nothing in the scene moves under its own power; nothing moves relative to');
  L.push('anything else except through parallax, where nearer things travel further than distant');
  L.push('things along the same direction.');

  if (sp.overSafeCap) {
    L.push('');
    L.push('NOTE FOR THE OPERATOR (not an instruction to the generator): ' + sp.pxPerFrame.toFixed(1)
         + ' px/frame is above the room\'s ' + SAFE_PX_PER_FRAME + ' px/frame coherent-flow ceiling for '
         + 'a side wall. The reference gesture is a ' + sp.refDur.toFixed(2) + ' s beat; spreading the '
         + 'same excursion over ' + sp.calmDurationSec + ' s would bring it inside the ceiling.');
  }
  return L.join(NL);
}

// Rows for the preset inspector — the same numbers the prompt gets, so the
// debug window cannot disagree with the generation.
// THE SAME MOVE SAID BOTH WAYS, FOR A HUMAN ONLY.
//
// The contract deliberately never names the camera body - every direction
// inversion in this project came from a camera word being read as a content
// word or the reverse. But that leaves an operator reading "slides toward the
// LEFT edge" with nothing to check it against, because a person thinks in
// camera moves: "the camera goes left to right on the left wall."
//
// Both are true at once and they are opposites: a camera tracking toward
// frame right pushes the picture toward frame left. So the INSPECTOR prints
// both readings side by side. This string is never sent to a generator.
function cameraGloss(sp) {
  const zooms = Math.abs(sp.scaleTotal - 1) >= zoomDeadzone(sp.wall);

  if (sp.kind === 'static') {
    return { camera: 'camera is locked off', picture: 'nothing moves', numbers: '' };
  }

  const numbers = sp.towardEdge
    ? Math.abs(sp.dxTotal * 100).toFixed(1) + '% total  ·  '
      + Math.abs(sp.dxRate * 100).toFixed(1) + '%/s  ·  '
      + sp.pxPerFrame.toFixed(1) + ' px/f'
      + (sp.overSafeCap ? '  ·  OVER the ' + SAFE_PX_PER_FRAME + ' px/f room ceiling' : '')
    : (zooms ? 'x' + sp.scaleTotal.toFixed(2) + ' over ' + sp.durationSec.toFixed(1) + 's' : '');

  // Centre wall: the move is a dolly, so the camera word is forward or back.
  if (!sp.towardEdge) {
    return {
      camera: zooms ? (sp.scaleTotal > 1 ? 'camera dollies FORWARD, into the scene'
                                         : 'camera pulls BACK, away from the scene')
                    : 'camera holds position',
      picture: zooms ? (sp.scaleTotal > 1
                          ? 'everything gets BIGGER to x' + sp.scaleTotal.toFixed(2)
                            + ' - the frame shows LESS of the scene'
                          : 'everything gets SMALLER to x' + sp.scaleTotal.toFixed(2)
                            + ' - the frame shows MORE of the scene')
                     : 'the picture stays the same size',
      numbers: numbers,
    };
  }

  // Side wall: the camera travels the OPPOSITE way to the picture. On a push
  // in the rig moves forward, which on this wall's own image is toward the
  // deep end - the seam edge - so the picture slides toward the outer edge.
  const cameraEdge = sp.towardEdge === 'LEFT' ? 'RIGHT' : 'LEFT';
  const deep = sp.wall === 'left' ? 'RIGHT' : 'LEFT';
  const forward = cameraEdge === deep;
  return {
    camera: 'camera tracks toward frame ' + cameraEdge
          + (forward ? ' (the rig moving forward, deeper into the room)'
                     : ' (the rig moving back, out of the room)'),
    picture: 'the whole picture is carried toward frame ' + sp.towardEdge
           + (zooms ? ', and grows x' + sp.scaleTotal.toFixed(2) : ''),
    numbers: numbers,
  };
}

function inspector(moveId, durationSec, speedPct, centrePct) {
  return ['left', 'center', 'right'].map(w => {
    const sp = spec(moveId, w, durationSec, speedPct, centrePct);
    return {
      wall: w,
      framePx: sp.framePx + ' x ' + sp.frameH,
      dxTotal: pct(sp.dxTotal),
      dxRate: pct(sp.dxRate) + '/s',
      pxPerFrame: sp.pxPerFrame.toFixed(1) + ' px/f',
      scaleTotal: 'x' + sp.scaleTotal.toFixed(2),
      scaleRate: 'x' + sp.scaleRate.toFixed(3) + '/s',
      dy: sp.dyTotal.toFixed(3),
      roll: sp.rollTotal.toFixed(1) + ' deg',
      // "expanding" / "contracting" were the words that read as a camera move
      // and came back inverted on the centre wall. The panel now says it the
      // way the contract says it.
      direction: sp.towardEdge
        ? 'toward frame ' + sp.towardEdge
          + (sp.seamEdge ? (sp.towardSeam ? ' (toward the seam)' : ' (toward the outer end)') : '')
        : (Math.abs(sp.scaleTotal - 1) > 0.02
            ? (sp.scaleTotal > 1 ? 'everything gets bigger' : 'everything gets smaller')
            : 'locked off'),
      gloss: cameraGloss(sp),
      overSafeCap: sp.overSafeCap,
      raw: sp,
    };
  });
}

/**
 * Grade one measured clip against the spec its prompt carried.
 *
 * Lives here, next to the spec itself, for the reason the old verifier failed:
 * it graded a five-second clip against a 1.9-second reference RATE, so a clip
 * that obeyed the prompt exactly was reported "too weak" and one running at
 * three times the asked-for travel was reported a match. Same file, same
 * units, one set of thresholds - the check and the instruction cannot drift
 * apart again.
 *
 * `measured` is a wall_motion.py result: dxTotal, scaleTotal, rollTotal,
 * bgRatio, durationSec - all in the delivered clip's own frame units, which is
 * exactly what spec() states.
 */
function compare(moveId, wallId, measured, speedPct, centrePct) {
  const want = spec(moveId, wallId, measured.durationSec || 5, speedPct, centrePct);
  const row = { wall: wallId, problems: [], want: want };

  row.dx = { want: want.dxTotal, got: measured.dxTotal };
  row.scale = { want: want.scaleTotal, got: measured.scaleTotal };
  row.roll = { want: 0, got: measured.rollTotal };
  row.bgRatio = measured.bgRatio === undefined ? null : measured.bgRatio;

  const dxWanted = Math.abs(want.dxTotal) > 0.05;
  if (dxWanted) {
    const sameDir = (want.dxTotal > 0) === (measured.dxTotal > 0);
    const ratio = Math.abs(measured.dxTotal) / Math.abs(want.dxTotal);
    row.dx.ratio = round(ratio, 2);
    row.dx.sameDirection = sameDir;
    if (!sameDir && Math.abs(measured.dxTotal) > 0.05) row.problems.push('travelling the WRONG WAY');
    else if (ratio < 0.5) row.problems.push('travelling only ' + Math.round(ratio * 100)
      + '% as far as the preset - press Lock motion on this wall and regenerate; prompting '
      + 'alone has not moved it');
    else if (ratio > 1.8) row.problems.push('travelling ' + Math.round(ratio * 100) + '% of the preset - too fast');
  } else if (Math.abs(measured.dxTotal) > 0.15) {
    row.problems.push('drifting sideways when the preset asks for none');
  }

  // Scale is compared in log space: x2.0 and x0.5 are the same size of error,
  // and a linear comparison would call one of them twice as bad as the other.
  const scaleWanted = Math.abs(want.scaleTotal - 1) > zoomDeadzone(want.wall);
  if (scaleWanted) {
    const lw = Math.log(want.scaleTotal);
    const lg = Math.log(Math.max(0.05, measured.scaleTotal));
    const sr = lg / lw;
    row.scale.ratio = round(sr, 2);
    if (lg * lw < 0) row.problems.push('zooming the WRONG WAY');
    else if (sr < 0.45) row.problems.push('only ' + Math.round(sr * 100) + '% of the scale change the preset asks for');
    else if (sr > 1.9) row.problems.push('far more scale change than the preset');
  }

  // The static-plate test, which is the failure the last right wall had: the
  // objects slid and the background did not. Only meaningful under near-pure
  // translation - a real zoom barely moves the frame centre, so a low
  // background ratio there is geometry, not a fault.
  if (!scaleWanted && dxWanted && row.bgRatio !== null && row.bgRatio < 0.45) {
    row.problems.push('the background is not moving with the camera - objects are sliding over a '
                    + 'static plate instead of the camera travelling');
  }

  // A zoom nobody asked for. The right wall came back at x0.58 on a move whose
  // contract says 1.00, and nothing flagged it, because the check only looked
  // at scale when the PRESET wanted scale.
  if (!scaleWanted && Math.abs(Math.log(Math.max(0.05, measured.scaleTotal))) > Math.log(1.2)) {
    row.problems.push('zooming ' + (measured.scaleTotal > 1 ? 'in' : 'out') + ' to x'
      + Number(measured.scaleTotal).toFixed(2) + ' when the preset asks for no size change at all');
  }
  if (Math.abs(measured.rollTotal || 0) > 4) {
    row.problems.push('the horizon rolls ' + Number(measured.rollTotal).toFixed(1) + ' deg');
  }
  return row;
}

// ------------------------------------------------------------------ JSON ---
// THE PROMPT FORMAT THAT ACTUALLY WORKED.
//
// The user supplied seven of their own hand-written prompts that produced
// correct camera motion, and every one of them is a JSON document with the
// camera described as a real camera: projection, yaw, a start and end
// transform, a velocity vector, easing, and a block of explicit "allow_*:
// false" locks plus a negative_prompt list. Prose versions of the same
// instruction - including the numeric prose this file emitted before - kept
// getting loosely interpreted: the right wall zoomed when it was told to
// slide, and the left wall grew furniture that was never in the plate.
//
// THE DIRECTION FIELDS, AND THE CONFUSION THEY RESOLVE
// ---------------------------------------------------
// In those working prompts, `camera.motion.type` is "pan_left_to_right" on the
// LEFT wall and "pan_right_to_left" on the RIGHT wall. Those describe the
// CAMERA, not the picture. In the same files, `environmental_fx.clouds.motion`
// - which describes CONTENT - is "right_to_left" on the left wall and
// "left_to_right" on the right wall. Camera right means content left, so both
// fields agree, and both agree with the reference renders: on a push in, the
// left wall's content travels to frame LEFT and the right wall's to frame
// RIGHT. Every round of "the direction is wrong" came from reading a camera
// field as if it were a content field.
//
// So the JSON below keeps the exact key names that worked, and adds
// `content_direction` alongside them, stated in the picture's own terms, so
// nothing has to be inferred ever again.

// NO CAMERA-FRAME VOCABULARY. THIS IS WHY.
//
// The first JSON build described the move twice: `type: "pan_left_to_right"`
// (the camera body) and `content_direction: "frame_right_to_frame_left"` (the
// picture). Those are the same move - a camera panning right makes the picture
// travel left - but only if the reader knows which frame of reference each key
// uses. The generator did not.
//
// Measured off the C_PushOut set: the RIGHT wall was asked for dx -0.665, its
// `type` read "pan_left_to_right", and it came back travelling +0.137 - the
// camera field followed, the content field ignored. The LEFT wall got the
// mirror pair and came back at +0.015, i.e. paralysed between them.
//
// So every direction statement below is now in the PICTURE's frame, and there
// is exactly one of them. `camera_direction` and `pan_*_to_*` are gone. A
// signed number plus one unambiguous word is the whole vocabulary:
//
//     dx < 0  ->  the picture travels toward FRAME_LEFT
//     dx > 0  ->  the picture travels toward FRAME_RIGHT
function travelWord(dxTotal) {
  if (Math.abs(dxTotal) < 0.02) return 'NONE';
  return dxTotal < 0 ? 'FRAME_LEFT' : 'FRAME_RIGHT';
}

// Landmark anchors are chosen AGAINST the direction of travel, so most of them
// are still on screen at the end of the clip. With fixed anchors at
// 0.15/0.50/0.85 a rightward move put two of the three off the right edge
// before the halfway mark, and a table where most rows read "gone" is a table
// a generator can satisfy by doing nothing.
function anchorsFor(dxTotal) {
  if (Math.abs(dxTotal) < 0.05) return [0.15, 0.50, 0.85];
  return dxTotal > 0 ? [0.08, 0.24, 0.40] : [0.60, 0.76, 0.92];
}

const WALL_YAW = { left: -90, center: 0, right: 90 };
const CANVAS_X = { left: 0, center: 3840, right: 8000 };

// WHAT A GENERATOR IS TOLD NOT TO DO. Twelve lines, not fifty.
//
// The previous list ran to fifty entries inside a 9.5KB contract, and the
// delivered set ignored the load-bearing ones: the right wall zoomed 0.58
// where the contract said 1.00, rolled 8 degrees where it said 0, and left
// its background at 5% of the frame rate. Long inputs get attended to in the
// middle least of all, and the important constraints were in the middle.
// Everything here is something a delivered clip has actually got wrong.
function negativePrompt(sp) {
  const n = [];
  if (sp.towardEdge) {
    const wrong = sp.towardEdge === 'LEFT' ? 'RIGHT' : 'LEFT';
    n.push('nothing travels toward the ' + wrong + ' edge - not one object, not the crowd');
  }
  // Outside the direction test on purpose: a centre wall on a dolly has dx = 0,
  // so these two used to be omitted and its contract carried no rule against an
  // element moving on its own at all.
  if (sp.kind !== 'static') {
    n.push('the background is never still while the foreground moves');
    n.push('no object travels across the picture on its own - the picture is what moves, and '
         + 'nothing changes its position within the scene');
  }
  if (Math.abs(sp.scaleTotal - 1) < zoomDeadzone(sp.wall)) {
    n.push('no zoom, no dolly, nothing gets bigger or smaller');
  }
  if (Math.abs(sp.dxTotal) < 0.02) n.push('no sideways drift, no pan');
  n.push('no held frame and no jump - the motion is continuous from frame 1 to the last frame');
  n.push('no roll, no tilt, no yaw, no camera shake');
  n.push('nothing added: no new object, character, crowd, sign, text, confetti, sparkle, particle, weather or light');
  n.push('nothing removed, redrawn, restyled or recoloured');
  n.push('characters keep their exact design, count and facing');
  n.push('the horizon stays at the same height in every frame');
  n.push('no cut, no dissolve, no speed ramp, no ease');
  return n;
}

// HOW A CHANGE OF SIZE IS DESCRIBED, AND WHY IT IS NOT "expand" OR "contract".
//
// The centre wall came back inverted on BOTH presets: a push in rendered as a
// zoom out, and a push out measured x1.37 where the contract asked x0.50.
// The contract said "the entire picture contracts inward toward the exact
// centre of frame". "Inward" and "outward" are camera words - a camera moving
// inward is a push IN - so the sentence read as the opposite of what it
// specified. Same failure as pan_left_to_right, different vocabulary.
//
// So size is now described only by what happens to the PICTURE: things get
// bigger or smaller, and the frame shows less or more. Neither has a camera
// reading.
function sizeWords(scaleTotal, deadzone) {
  if (Math.abs(scaleTotal - 1) < (deadzone == null ? 0.15 : deadzone)) {
    return { change: 'none - everything stays exactly the size it is now', fov: 'unchanged' };
  }
  if (scaleTotal > 1) {
    return {
      change: 'everything in the picture gets BIGGER, reaching x' + scaleTotal.toFixed(2)
            + ' of its starting size. The frame shows LESS of the scene every second, and content '
            + 'runs off past all four edges. No new scene appears anywhere.',
      fov: 'narrows',
    };
  }
  return {
    change: 'everything in the picture gets SMALLER, down to x' + scaleTotal.toFixed(2)
          + ' of its starting size. The frame shows MORE of the scene every second, and new scene '
          + 'comes in at all four edges. Nothing runs off the edges.',
    fov: 'widens',
  };
}

/**
 * The locked camera contract. Deliberately small.
 *
 * It was 9.5KB of JSON across nine top-level sections - a room description, a
 * perspective essay, the room's energy law, fifty negatives - and the terms
 * that actually decide whether a clip is usable were buried in the middle of
 * it. This is the same information at about a quarter of the size, with every
 * key load-bearing. The operator-facing material (energy law, seam prose) is
 * still in the inspector; it was never something the generator could act on.
 */
function cameraJson(moveId, wallId, durationSec, opts) {
  const sp = spec(moveId, wallId, durationSec, opts && opts.speedPct, opts && opts.centrePct);
  const zooms = Math.abs(sp.scaleTotal - 1) >= zoomDeadzone(sp.wall);
  const scaleEnd = zooms ? sp.scaleTotal : 1.0;
  const sz = sizeWords(scaleEnd, zoomDeadzone(sp.wall));
  const lm = landmarkRows(sp);
  const n = Math.max(2, Math.round(sp.durationSec));

  const headline = sp.kind === 'static'
    ? 'THE ONE THING THAT MUST BE RIGHT: the camera does not move at all.'
    : (sp.towardEdge
        ? 'THE ONE THING THAT MUST BE RIGHT: the WHOLE PICTURE is carried toward the '
          + sp.towardEdge + ' edge of frame as one locked piece - background, sky, floor, far crowd, '
          + 'every pixel together, keeping their exact positions relative to each other - travelling '
          + Math.abs(sp.dxTotal * 100).toFixed(1) + '% of the frame width over '
          + sp.durationSec.toFixed(1) + ' seconds at a constant speed. Nothing inside the picture '
          + 'travels on its own or changes place within the scene.'
        : 'THE ONE THING THAT MUST BE RIGHT: ' + sz.change + ' There is no sideways drift at all.');

  const checkpoints = [];
  for (let i = 0; i <= n; i++) {
    const t = round(sp.durationSec * i / n, 2);
    const f = t / sp.durationSec;
    checkpoints.push([t, round(sp.dxTotal * f, 3), round(Math.pow(scaleEnd, f), 3)]);
  }

  const out = {
    headline: headline,
    id: sp.move + ' / ' + sp.wall.toUpperCase() + ' wall / ' + sp.durationSec.toFixed(1) + 's',
    frame: {
      px: [sp.framePx, sp.frameH],
      fps: sp.fps,
      duration_s: sp.durationSec,
      x_scale: '0.000 = left edge of frame, 1.000 = right edge',
      first_frame: 'must be the supplied reference image, unchanged',
    },
    camera: {
      travel: sp.towardEdge
        ? 'the whole picture is carried toward the ' + sp.towardEdge + ' edge as one locked piece'
        : 'no sideways movement',
      dx_total: sp.dxTotal,
      dx_per_second: sp.dxRate,
      px_per_frame: sp.pxPerFrame,
      size_change: sz.change,
      scale_end: scaleEnd,
      field_of_view: sz.fov,
      dy_total: 0,
      roll_degrees: 0,
      speed: 'constant from the first frame to the last - no ease, no hold, no acceleration',
    },
    checkpoints: checkpoints,
    checkpoints_key: '[seconds, dx_so_far_in_frame_widths, size_so_far] - the picture must be at '
                   + 'these values at these times. Equal movement in every equal slice of time.',
  };

  // No km/h. It was never measurable here - pixels carry no depth - so it rode
  // in the contract as an advisory string that governed nothing while looking
  // authoritative. What the dial sets is a real, checkable rate, and it is
  // already stated above as dx_per_second; this only records where it came from.
  if (sp.kind !== 'static') {
    out.camera.speed_percent = sp.speedPct;
    out.camera.speed_note =
      'Speed is a RATE, so the travel above is dx_per_second x duration: the same speed over a '
      + 'longer clip covers proportionally more ground. 100% is the measured average of the '
      + 'operator reference clips (' + BENCHMARK_DX_RATE + ' of frame width per second on a side wall).';
  }

  if (sp.wall !== 'center' && sp.towardEdge) {
    out.parallax = {
      foreground_dx_total: round(sp.dxTotal * 1.45, 3),
      midground_dx_total: sp.dxTotal,
      far_background_dx_total: round(sp.dxTotal * 0.75, 3),
      rule: 'measured from the reference render. All three travel the SAME way. Depth changes HOW '
          + 'FAR something travels, never WHICH WAY. The furthest thing in frame still moves '
          + Math.abs(sp.dxTotal * 0.75 * 100).toFixed(0) + '% of the frame width. If a character is '
          + 'also animating on its own, that is ON TOP of this, not instead of it.',
    };
  }

  out.landmarks = lm.rows.map((r, i) => ({
    x_start: r.x0,
    x_at: lm.times.map((t, k) => [t, r.xs[k]]),
    name: '<name the real thing at this position in the reference image>',
  }));
  out.landmarks_key = '[seconds, x] - pick a real, nameable thing at each x_start and hold it to '
                    + 'these positions. Outside 0..1 means it has left frame by then.';

  if (sp.towardEdge) {
    out.revealed_edge = {
      edge: sp.towardEdge === 'RIGHT' ? 'LEFT' : 'RIGHT',
      width_by_end: round(Math.abs(sp.dxTotal), 3),
      fill: 'continue the material right next to it - the same floor, wall, sky or crowd. Put no '
          + 'new object, character or feature in this band.',
    };
  }

  // CONFIRMED WORKING ON C_PushIn - DO NOT REWORD WITHOUT A MEASURED SET.
  // The owner checked delivered output after this went in: "right motion is
  // fixed, it's looking nice for push in." Three sets before it were wrong-way
  // three times out of three. The wording below and the rig_context block are
  // the only things that changed, so they are load-bearing until something
  // measured says otherwise.
  //
  // THE RIGHT WALL USED TO TRAVEL THE SAME WAY AS THE LEFT ONE.
  //
  // Measured across three delivered sets (Snow, Toronto, Bear): the LEFT wall
  // obeyed its direction every time, and the RIGHT wall travelled the SAME way
  // as the left every time - asked +0.130 got -0.018, asked +0.162 got -0.364,
  // asked +0.081 got -0.179. Three for three, wrong way. Reversing it in the
  // edit is not a fix: it runs the scene's own animation backwards too, so a
  // walking animal walks backwards.
  //
  // EACH JOB SEES ONE IMAGE AND ONE PROMPT. Nothing else is uploaded - not the
  // other walls' plates, not their prompts, not their clips. So a rule phrased
  // as "the other side wall goes the opposite way" is unusable: there is no
  // other wall in front of the model to be opposite TO. A first version of this
  // field said exactly that and would have been dead text.
  //
  // What IS in front of it is the reference image, and that image already
  // carries the answer, because the two side walls are mirrored in PERSPECTIVE:
  // the left wall recedes toward its RIGHT edge, the right wall toward its
  // LEFT. Anchoring travel to the visible vanishing direction therefore comes
  // out mirrored on its own, from a rule that only ever talks about this one
  // frame. Same reason `perspective` works and never needed a sibling either.
  if (sp.wall !== 'center' && sp.towardEdge) {
    out.direction_from_perspective =
      'Read the direction off this image: the world recedes toward its ' + sp.seamEdge
      + ' edge and the nearest, largest things sit at its ' + sp.outerEdge + ' edge. '
      + (sp.towardSeam
          ? 'The picture travels INTO that depth, toward the far ' + sp.seamEdge + ' end.'
          : 'The picture travels OUT of that depth, off the near ' + sp.outerEdge + ' end - the closest '
            + 'things leave frame first.');
  }

  if (sp.wall !== 'center') {
    out.perspective = 'a flat side plane at 90 degrees to the centre wall, seen from one seat in the '
      + 'middle of the room. The world recedes toward the '
      + (sp.wall === 'left' ? 'RIGHT' : 'LEFT') + ' edge and is nearest and largest at the '
      + (sp.wall === 'left' ? 'LEFT' : 'RIGHT') + ' edge. This never changes during the shot.';
  }

  // THE OTHER TWO WALLS, AS NUMBERS.
  //
  // Each wall is a separate job: one image and one prompt go up, and nothing
  // else - not the other walls' plates, not their prompts, not their finished
  // clips. So the only way this job can know what it has to cut together with
  // is to be TOLD, in figures. The prose block has carried an all-walls table
  // for a long time, but prose is not what gets sent; this is the same table in
  // the contract that is.
  //
  // Deliberately numbers and nothing else: no scene description, no subject, no
  // style. Describing another wall's CONTENT is how a wall ends up drawing its
  // neighbour's subject, which is the failure IMAGE_MODE 'extension' exists to
  // stop. Direction and magnitude are safe to share; content is not.
  const others = ['left', 'center', 'right'].filter(w => w !== sp.wall);
  out.rig_context = {
    note: 'The other two walls are separate jobs you are not shown. Figures only, so your clip cuts '
        + 'together with theirs as one move. Draw your own frame only, never their content.',
  };
  for (const w of others) {
    const o = spec(sp.move, w, sp.durationSec, opts && opts.speedPct, opts && opts.centrePct);
    const oz = Math.abs(o.scaleTotal - 1) >= zoomDeadzone(o.wall);
    out.rig_context[w] = {
      dx_total: o.dxTotal,
      travel: o.towardEdge ? 'toward its ' + o.towardEdge + ' edge' : 'no sideways travel',
      scale_end: oz ? round(o.scaleTotal, 3) : 1.0,
    };
  }
  out.rig_context.your_wall = sp.wall;

  out.never = negativePrompt(sp);
  return out;
}


function presetIds() { return Object.keys(MOVES); }

module.exports = {
  cameraGloss,
  MOVES, REF_VIEW_PX, WALL_PX, WALL_H, FPS, SAFE_PX_PER_FRAME,
  normalise, spec, posAt, posAtY, landmarkRows, numericBlock, inspector, presetIds, compare,
  cameraJson, travelWord, anchorsFor,
};
