// theatre.js — THE ROOM. One file, one source of truth, per the handbook's
// "write it down once" rule. Nothing downstream should ever contain a literal
// 3520 again.
//
// WHAT THIS CORRECTS
// ------------------
// Two things the tool had wrong, both now fixed against the wall brief:
//
//  1. THE SIDE WALL ANGLE IS 90 DEGREES, and I had removed it. An earlier pass
//     stripped "exactly 90 degrees" out of the prompts on the reasoning that the
//     Unreal wall meshes looked like angled quads. They look angled because they
//     are drawn in perspective from a free-flying editor camera. The room is a
//     literal U: L and R are perpendicular side planes, and the 320px RETURNS
//     are the corner bridges. Putting 90 back in.
//
//  2. THERE ARE FIVE SEGMENTS, NOT THREE. LR and RR are real, lit, addressable
//     walls — 320 x 1600 each — and the tool has never generated them. They are
//     also the exact part the handbook says AI cannot do by prompting, because
//     a diagonal corner view is a geometry problem, not an appearance one.
//
// nDisplay's five views, which is what the content has to match:
//     L   left orthographic            90 deg left
//     LR  diagonal, the MIDPOINT between centre and left     45 deg left
//     C   centre orthographic           0 deg
//     RR  diagonal, midpoint between centre and right        45 deg right
//     R   right orthographic           90 deg right

const CANVAS = { w: 11520, h: 2160, mosaic: '3 x 3840x2160', tilePx: 320 };

// Lit pixels, mosaic position, facing angle and role. Top-aligned: every
// segment starts at y = 0, so C's extra tile of height hangs 320px BELOW its
// neighbours. That makes the TOP edge the common horizon reference, not the
// floor line — and the bottom 320px of C the only band with no side-wall
// neighbour, which is where the podium safe-area belongs.
const SEGMENTS = [
  { id: 'L',  name: 'Left wall',    tiles: [11, 5], w: 3520, h: 1600, x: 0,    y: 0, monitor: 1,
    angleDeg: -90, view: 'left orthographic',  role: 'Side plane, off-axis frustum' },
  { id: 'LR', name: 'Left return',  tiles: [1, 5],  w: 320,  h: 1600, x: 3520, y: 0, monitor: 1,
    angleDeg: -45, view: 'diagonal, midway between centre and left', role: 'Corner bridge' },
  { id: 'C',  name: 'Centre',       tiles: [12, 6], w: 3840, h: 1920, x: 3840, y: 0, monitor: 2,
    angleDeg: 0,   view: 'centre orthographic', role: 'Back plane, on-axis' },
  { id: 'RR', name: 'Right return', tiles: [1, 5],  w: 320,  h: 1600, x: 7680, y: 0, monitor: 3,
    angleDeg: 45,  view: 'diagonal, midway between centre and right', role: 'Corner bridge' },
  { id: 'R',  name: 'Right wall',   tiles: [11, 5], w: 3520, h: 1600, x: 8000, y: 0, monitor: 3,
    angleDeg: 90,  view: 'right orthographic', role: 'Side plane, off-axis frustum' },
];

const BY_ID = Object.fromEntries(SEGMENTS.map(s => [s.id, s]));
// The three the tool actually generates today. LR/RR are lit walls it does not
// yet produce — see RETURNS_NOTE.
const WALL_TO_SEGMENT = { left: 'L', center: 'C', right: 'R' };

function seg(wallId) { return BY_ID[WALL_TO_SEGMENT[wallId] || wallId] || null; }
function aspect(wallId) { const s = seg(wallId); return s ? s.w / s.h : 16 / 9; }

// The tool forced 16:9 (1.778) on every wall. No segment is 16:9: the sides are
// 2.20 and the centre is 2.00, so every generated frame was being composed to
// the wrong shape and then squeezed onto the wall. Pick whatever the model
// actually offers that is closest to the true segment.
function closestAspectOption(wallId, options) {
  const want = aspect(wallId);
  const parsed = (options || []).map(o => {
    const m = String(o).match(/^(\d+(?:\.\d+)?)\s*[:x\/]\s*(\d+(?:\.\d+)?)$/);
    return { raw: o, ratio: m ? parseFloat(m[1]) / parseFloat(m[2]) : null };
  }).filter(p => p.ratio);
  if (!parsed.length) return null;
  parsed.sort((a, b) => Math.abs(a.ratio - want) - Math.abs(b.ratio - want));
  return parsed[0].raw;
}

const RETURNS_NOTE =
  'LR and RR are lit 320x1600 walls showing the DIAGONAL view midway between centre and each side. '
+ 'This tool does not generate them. That is deliberate, not an oversight: a corner bridge is a '
+ 'geometry problem — it needs the off-axis frustum, which a prompt cannot supply. The handbook\'s '
+ 'two answers are (A) render grey-box in nDisplay and use depth/normals/edges as ControlNet '
+ 'conditioning, or (B) generate ONE cylindrical plate from the shared eyepoint and reproject it into '
+ 'all five frusta. Both keep the rule: AI authors appearance, never geometry.';

// A compact statement of the room, for the top of every locked block. Short on
// purpose — it is context, not the instruction.
function roomBrief(wallId) {
  const s = seg(wallId);
  if (!s) return '';
  const facing = s.angleDeg === 0 ? 'straight ahead'
    : `${Math.abs(s.angleDeg)} degrees to the ${s.angleDeg < 0 ? 'left' : 'right'}`;
  return `THE ROOM: a U-shaped LED theatre. Three flat walls — left, centre, right — enclosing an `
    + `audience seated in the middle, with a 320px right-angle return bridging each corner. Every wall `
    + `is a window from ONE seated viewpoint at the centre of the room. This is the ${s.name} `
    + `(${s.w} x ${s.h}), facing ${facing}: the ${s.view}.`;
}

module.exports = { CANVAS, SEGMENTS, BY_ID, WALL_TO_SEGMENT, seg, aspect,
                   closestAspectOption, roomBrief, RETURNS_NOTE };
