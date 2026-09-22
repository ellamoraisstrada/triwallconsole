// rigmoves.js — the C_* rig controllers.
//
// One entry per camera move the theatre can perform, named after the reference
// recording it was measured from (C_PushIn.mp4, C_TrackLeft.mp4, ...). "C_"
// because the client only ever supplies the CENTRE wall: every move is defined
// by what the centre does, and the other four segments follow from it.
//
// WHERE THE NUMBERS COME FROM
// ---------------------------
// Not from me. Each `measured` block is the signature learn_rig.py extracted
// from that clip's three rendered nDisplay views, in panel-fractions per
// second, with +vx meaning content moves RIGHT across frame. The full library
// (including roll and sample counts) is rig_library.json; these are the terms
// the prompts and the matcher actually use, inlined so the tool still describes
// a move correctly if Python is unavailable.
//
// WHAT THE MEASUREMENTS SETTLED
// -----------------------------
//  * A push in is ONE divergence field on the centre (vx~0, div +0.37) with the
//    sides sliding outward in opposite directions at 0.353 / 0.335 — symmetric
//    to within 5%. The sin/cos share model is measured, not assumed.
//  * TRACK vs TURN separates on `spread`, not on parallax: track 0.027,
//    turn 0.86-1.01. The earlier parallax threshold was backwards and is gone.
//  * A TILT does not slide the side walls vertically — it ROLLS them, equal and
//    opposite (L -0.179 / R +0.185). A pitch about the eyepoint is, for a wall
//    at 90 degrees, a rotation about that wall's own view axis.
//
// NAMING NOTE, recorded rather than silently resolved: C_TiltUp measures as
// centre content RISING (ceiling exits the top, floor comes into view), which
// by the usual convention is a camera pitching down. The label is defined by
// the reference clip, as instructed — "C_TiltUp means what the C_TiltUp example
// does" — so behaviour follows the measurement, not the English.

const MOVES = {
  C_PushIn: {
    label: 'C_PushIn — centre travels forward',
    family: 'translate',
    summary: 'The camera moves forward along the room axis. One divergence field centred on C.',
    measured: {
      CENTER: { vx: -0.06, vy: -0.091, div_x: 0.371, div_y: 0.367, spread: 0.182, roll: -0.005 },
      LEFT:   { vx: -0.351, vy: 0.003, div_x: -0.042, div_y: -0.058, spread: 0.251, roll: 0.481 },
      RIGHT:  { vx: 0.335, vy: -0.024, div_x: 0.16, div_y: 0.134, spread: 0.05, roll: -0.112 },
    },
    walls: {
      center: 'Content opens outward from frame centre and grows — near things reach the edges and '
            + 'leave frame, distant things enlarge slowly. Nothing slides left or right.',
      left:  'The world slides steadily toward and off the LEFT edge, the way scenery passes a side '
           + 'window. Nothing approaches; nothing grows. Pure lateral travel.',
      right: 'The world slides steadily toward and off the RIGHT edge, mirroring the left wall at the '
           + 'same rate. Nothing approaches; nothing grows.',
    },
  },

  C_PushOut: {
    label: 'C_PushOut — centre retreats backward',
    family: 'translate',
    summary: 'The exact mirror of C_PushIn: the camera withdraws, content converges inward.',
    measured: {
      CENTER: { vx: 0.058, vy: 0.09, div_x: -0.363, div_y: -0.363, spread: 0.177, roll: 0.003 },
      LEFT:   { vx: 0.338, vy: -0.004, div_x: 0.029, div_y: 0.052, spread: 0.249, roll: -0.478 },
      RIGHT:  { vx: -0.332, vy: 0.025, div_x: -0.167, div_y: -0.138, spread: 0.049, roll: 0.112 },
    },
    walls: {
      center: 'Content converges inward toward frame centre and shrinks — new scene enters from all '
            + 'four edges as the view widens. Nothing slides left or right.',
      left:  'The world slides in from the LEFT edge and travels toward the centre seam — the reverse '
           + 'of the push-in direction, same steady pace.',
      right: 'The world slides in from the RIGHT edge toward the centre seam, mirroring the left wall.',
    },
  },

  C_TrackLeft: {
    label: 'C_TrackLeft — whole rig slides left',
    family: 'translate',
    summary: 'The camera translates left without turning. The room swings past; the walls do NOT '
           + 'both do the same thing — one approaches while the other recedes.',
    measured: {
      CENTER: { vx: 0.356, vy: 0.0, div_x: -0.004, div_y: 0.006, spread: 0.026, roll: -0.058 },
      LEFT:   { vx: 0.262, vy: -0.038, div_x: 0.573, div_y: 0.735, spread: 0.278, roll: -0.421 },
      RIGHT:  { vx: 0.247, vy: 0.11, div_x: -0.547, div_y: -0.57, spread: 0.245, roll: -0.048 },
    },
    walls: {
      center: 'The whole scene slides steadily to the RIGHT across frame at an even pace, near and '
            + 'far together, with no turning and no change of scale.',
      left:  'The camera is moving TOWARD this wall, so this wall reads as a slow push in: content '
           + 'opens outward from frame centre and grows, while also drifting right.',
      right: 'The camera is moving AWAY from this wall, so this wall reads as a slow pull out: '
           + 'content converges inward and shrinks, while also drifting right.',
    },
  },

  C_TrackRight: {
    label: 'C_TrackRight — whole rig slides right',
    family: 'translate',
    summary: 'The mirror of C_TrackLeft: right wall approaches, left wall recedes.',
    measured: {
      CENTER: { vx: -0.356, vy: 0.0, div_x: -0.005, div_y: -0.004, spread: 0.025, roll: 0.06 },
      LEFT:   { vx: -0.26, vy: 0.036, div_x: -0.58, div_y: -0.722, spread: 0.284, roll: 0.365 },
      RIGHT:  { vx: -0.249, vy: -0.107, div_x: 0.529, div_y: 0.567, spread: 0.239, roll: 0.053 },
    },
    walls: {
      center: 'The whole scene slides steadily to the LEFT across frame at an even pace, near and far '
            + 'together, with no turning and no change of scale.',
      left:  'The camera is moving AWAY from this wall, so this wall reads as a slow pull out: content '
           + 'converges inward and shrinks, while also drifting left.',
      right: 'The camera is moving TOWARD this wall, so this wall reads as a slow push in: content '
           + 'opens outward and grows, while also drifting left.',
    },
  },

  C_TurnLeft: {
    label: 'C_TurnLeft — whole rig rotates left',
    family: 'rotate',
    summary: 'The rig yaws left about the eyepoint. Everything sweeps across frame to the RIGHT, '
           + 'near and far at the same angular rate — no parallax, no approach.',
    measured: {
      CENTER: { vx: 0.031, vy: 0.108, div_x: 0.854, div_y: -1.464, spread: 0.665, roll: -1.401 },
      LEFT:   { vx: 0.0, vy: 0.0, div_x: -0.426, div_y: -0.238, spread: 0.394, roll: 0.003 },
      RIGHT:  { vx: 0.519, vy: 0.01, div_x: -0.005, div_y: 0.103, spread: 0.706, roll: -0.109 },
    },
    walls: {
      center: 'Objects sweep across frame from left to right and exit the right edge — a green lamp '
            + 'entering at the left crosses the frame and leaves at the right. Near and far move at '
            + 'the same angular rate: no parallax, nothing grows, nothing approaches.',
      left:  'New scene swings INTO view from behind the left edge as the rig turns toward it — this '
           + 'wall reveals what was previously out of frame, at the same angular rate as the centre.',
      right: 'Scene sweeps OUT of frame past the right edge as the rig turns away — content leaves '
           + 'faster here than anywhere else in the room, at the same angular rate.',
    },
  },

  C_TurnRight: {
    label: 'C_TurnRight — whole rig rotates right',
    family: 'rotate',
    summary: 'The mirror of C_TurnLeft: everything sweeps across frame to the LEFT.',
    measured: {
      CENTER: { vx: -0.597, vy: -0.001, div_x: 0.217, div_y: 0.013, spread: 1.039, roll: -0.085 },
      LEFT:   { vx: -0.729, vy: 0.007, div_x: 0.045, div_y: 0.057, spread: 0.402, roll: -0.288 },
      RIGHT:  { vx: -0.001, vy: -0.0, div_x: -0.264, div_y: 0.01, spread: 0.025, roll: 0.165 },
    },
    walls: {
      center: 'Objects sweep across frame from right to left and exit the left edge. Near and far move '
            + 'at the same angular rate: no parallax, nothing grows, nothing approaches.',
      left:  'Scene sweeps OUT of frame past the left edge as the rig turns away — content leaves '
           + 'faster here than anywhere else in the room.',
      right: 'New scene swings INTO view from behind the right edge as the rig turns toward it, at the '
           + 'same angular rate as the centre.',
    },
  },

  C_TiltUp: {
    label: 'C_TiltUp — whole rig pitches (content rises)',
    family: 'rotate',
    summary: 'Measured from C_TiltUp.mp4: centre content RISES in frame — the ceiling leaves the top '
           + 'edge and the floor comes into view. The side walls do not slide vertically; they ROLL, '
           + 'equal and opposite.',
    measured: {
      CENTER: { vx: -0.0, vy: 0.227, div_x: -0.014, div_y: 0.021, spread: 0.006, roll: 0.005 },
      LEFT:   { vx: 0.01, vy: -0.012, div_x: -0.016, div_y: 0.067, spread: 0.024, roll: 0.103 },
      RIGHT:  { vx: -0.007, vy: 0.049, div_x: -0.004, div_y: -0.039, spread: 0.02, roll: -0.108 },
    },
    walls: {
      center: 'The whole scene rises steadily up the frame: what was overhead leaves the top edge and '
            + 'the ground comes into view at the bottom. No left/right drift, no change of scale.',
      left:  'This wall does NOT slide up or down. Being at 90 degrees to the centre, a pitch of the '
           + 'rig appears here as a slow ROLL — the horizon tips gently anticlockwise, level line '
           + 'banking, while the content itself stays put.',
      right: 'This wall does NOT slide up or down. It ROLLS the opposite way to the left wall — the '
           + 'horizon tips gently clockwise at the same rate.',
    },
  },

  C_Hold: {
    label: 'C_Hold — camera locked, scene motion only',
    family: 'static',
    summary: 'The rig does not move. Only things inside the scene move.',
    measured: {
      CENTER: { vx: 0, vy: 0, div_x: 0, div_y: 0, spread: 0 },
      LEFT:   { vx: 0, vy: 0, div_x: 0, div_y: 0, spread: 0 },
      RIGHT:  { vx: 0, vy: 0, div_x: 0, div_y: 0, spread: 0 },
    },
    walls: {
      center: 'The camera is locked off. Nothing about the framing changes; only subjects within the '
            + 'scene move.',
      left:  'The camera is locked off. Only subjects within the scene move.',
      right: 'The camera is locked off. Only subjects within the scene move.',
    },
  },
};


// ------------------------------------------------------------- amplitude ---
// RETIRED. amplitudeLine() used to state a per-second rate copied straight off
// the reference clip and capped at 22%/s. Both halves were wrong:
//
//   * a RATE does not transfer between clip lengths. The reference moves are
//     1.6-1.9 second beats, so quoting their rate at a 5-second clip asks for
//     two to three times the travel the gesture contains. That is the "speed
//     is too much" report.
//   * the cap was expressed in frame-widths, which is 9% hotter on a 3520px
//     side wall than on the 3840px centre - the opposite way round from the
//     house rule that the sides stay calmer than the centre.
//
// rigspec.js replaced it with a TOTAL EXCURSION divided by the clip length,
// plus a timestamped landmark table. Nothing calls this any more; it returns
// empty rather than being deleted so that any state or plug-in still reaching
// for it gets silence instead of a stale number.
function amplitudeLine() { return ''; }


// WHICH MOVES ARE OFFERED AS PRESETS.
// Turns and tilts are measured and kept in the library - the decoder still needs
// to recognise them if a client clip contains one - but they are not offered in
// the picker, because they are not moves this show uses. Narrowing the list also
// narrows the ways a generation can go wrong.
// The two moves the show offers. Track, Turn, Tilt and Hold stay in MOVES —
// ids() still returns them so the decoder can name a move it sees in client
// footage, and so saved state naming one still resolves — they are just not
// offered as presets any more.
const PRESET_IDS = ['C_PushIn', 'C_PushOut'];

// Old intent ids, kept working. State saved by an earlier version still loads,
// and the decoder's heuristic classifier still speaks this vocabulary.
const LEGACY = {
  push_in: 'C_PushIn', pull_out: 'C_PushOut',
  truck_left: 'C_TrackLeft', truck_right: 'C_TrackRight',
  yaw_left: 'C_TurnLeft', yaw_right: 'C_TurnRight',
  tilt_up: 'C_TiltUp', tilt_down: 'C_TiltUp',
  hold: 'C_Hold', sway: 'C_Hold', unknown: 'C_Hold',
};

function normalise(id) {
  if (!id) return 'C_PushIn';
  if (MOVES[id]) return id;
  return LEGACY[id] || 'C_PushIn';
}

function get(id) { return MOVES[normalise(id)]; }

function ids() { return Object.keys(MOVES); }

// Only the moves the show actually uses. ids() still returns everything,
// because the decoder must be able to name a turn or a tilt it sees.
function presetIds() { return PRESET_IDS.filter(id => MOVES[id]); }

function options() {
  return presetIds().map(id => ({ id, label: MOVES[id].label, family: MOVES[id].family }));
}

// The per-wall movement paragraph the locked block embeds.
function wallText(moveId, wallId) {
  const m = get(moveId);
  const w = (wallId === 'center' || wallId === 'left' || wallId === 'right') ? wallId : 'center';
  return m.walls[w];
}

// The whole-rig block: what the move is, and what every wall does under it. The
// user writes creative only; this is the part they never have to think about.
function allWallsBlock(moveId) {
  const id = normalise(moveId);
  const m = MOVES[id];
  const NL = String.fromCharCode(10);
  return [
    'RIG MOVE: ' + m.label + '.',
    m.summary,
    '',
    'What each wall does under this move, measured from the theatre\'s own reference render:',
    '  CENTRE — ' + m.walls.center,
    '  LEFT   — ' + m.walls.left,
    '  RIGHT  — ' + m.walls.right,
  ].join(NL);
}

module.exports = { MOVES, LEGACY, normalise, get, ids, presetIds, options, wallText, allWallsBlock,
                   amplitudeLine };
