// rigpaths.js — derive ALL FIVE wall camera paths from the CENTRE wall alone.
//
// WHY THE CENTRE IS ENOUGH
// ------------------------
// The five walls are one rigid rig around one eyepoint, so the room's geometry
// fully determines what every other wall must do once you know what the centre
// is doing. The decoder therefore only ever needs centre-wall pixels; the rest
// is arithmetic, not measurement.
//
// THE MATHS (far-field, which is what a panorama or a wide scene is)
// For a point at azimuth phi from the forward axis, a forward translation at
// rate v produces an apparent angular rate
//       dphi/dt  =  -(v / D) * sin(phi)
// and an apparent scale change proportional to cos(phi). So:
//
//   wall      phi     lateral share      expansion share
//   C          0      sin 0   = 0.00     cos 0   = 1.00   <- all push, no slide
//   LR/RR     45      sin 45  = 0.71     cos 45  = 0.71   <- both, equally
//   L/R       90      sin 90  = 1.00     cos 90  = 0.00   <- all slide, no push
//
// That is the whole "centre pivots the sides" relationship, and it is exact.
// It also explains the measured ground truth: on a push-in the centre shows the
// strongest divergence and near-zero lateral flow, while the side walls show
// pure lateral flow in opposite directions.
//
// A YAW is different in kind: a rotation of the rig moves every wall by the
// SAME angular amount, because the whole body turned. Common mode, no
// sin/cos weighting, and little parallax anywhere — which is why a yaw must
// never be described with the parallax language a translation needs.

const THEATRE = require('./theatre.js');

const DEG = Math.PI / 180;

// The selectable moves became C_* ids, and this switch still spoke the old
// vocabulary. Every unrecognised id fell through to the 'locked off' default, so
// from that rename onward EVERY locked block carried "No camera motion at all"
// for all five walls - directly under the line describing the move. The prompt
// contradicted itself and the generator believed the stronger, repeated half.
// That is why generated sets came back barely moving.
const C_TO_LEGACY = {
  C_PushIn: 'push_in', C_PushOut: 'pull_out',
  C_TrackLeft: 'truck_left', C_TrackRight: 'truck_right',
  C_TurnLeft: 'yaw_left', C_TurnRight: 'yaw_right',
  C_TiltUp: 'tilt_up', C_Hold: 'hold',
};

// Returns per-segment shares for a given rig intent. Accepts either vocabulary.
function shares(intent, angleDeg) {
  intent = C_TO_LEGACY[intent] || intent;
  const phi = Math.abs(angleDeg) * DEG;
  const lateral = Math.sin(phi);
  const expand = Math.cos(phi);
  switch (intent) {
    case 'push_in':
    case 'pull_out': {
      const sign = intent === 'push_in' ? 1 : -1;
      return { kind: 'translate', lateral, expand: expand * sign, sign,
               // On a forward move the world slides toward each side wall's
               // OUTER edge; on a reverse move, toward the seam.
               towardOuter: intent === 'push_in' };
    }
    case 'truck_left':
    case 'truck_right': {
      // Sliding sideways is the complement: a wall facing the direction of
      // travel gets the push, a wall facing across it gets the slide.
      return { kind: 'translate-lateral', lateral: Math.cos(phi), expand: Math.sin(phi),
               goingLeft: intent === 'truck_left' };
    }
    case 'yaw_left':
    case 'yaw_right':
      return { kind: 'rotate', lateral: 1, expand: 0, left: intent === 'yaw_left' };
    case 'tilt_up':
    case 'tilt_down':
      return { kind: 'rotate-v', lateral: 0, expand: 0, up: intent === 'tilt_up' };
    default:
      return { kind: 'static', lateral: 0, expand: 0 };
  }
}

function pct(x) { return `${Math.round(Math.abs(x) * 100)}%`; }

// One line per segment, in plain language, with the derived share.
function pathLine(segId, intent, measured) {
  const s = THEATRE.BY_ID[segId];
  if (!s) return '';
  const sh = shares(intent, s.angleDeg);
  const outer = s.angleDeg < 0 ? 'LEFT' : 'RIGHT';
  const inner = s.angleDeg < 0 ? 'RIGHT' : 'LEFT';
  const tag = `${s.id} (${s.name}, ${s.angleDeg === 0 ? 'facing forward'
    : Math.abs(s.angleDeg) + '° ' + (s.angleDeg < 0 ? 'left' : 'right')})`;

  if (sh.kind === 'static') {
    return `  ${tag}: locked off. No camera motion at all; only the scene moves.`;
  }
  if (sh.kind === 'rotate') {
    const dir = sh.left ? 'RIGHT' : 'LEFT';
    const rate = measured && measured.yawDegPerSec
      ? ` at ${Math.abs(measured.yawDegPerSec).toFixed(1)}°/s` : '';
    return `  ${tag}: the whole rig turns${rate}, so this view sweeps toward its ${dir} edge by the `
         + `same angle as every other wall. Little parallax — correct for a turn.`;
  }
  if (sh.kind === 'rotate-v') {
    return `  ${tag}: the rig tilts ${sh.up ? 'up' : 'down'}; content slides `
         + `${sh.up ? 'down' : 'up'} through frame by the same angle as every other wall. No sideways drift.`;
  }
  if (sh.kind === 'translate') {
    if (s.angleDeg === 0) {
      return `  ${tag}: ${sh.sign > 0 ? 'the only wall anything approaches on' : 'the only wall anything recedes on'} `
           + `— ${pct(sh.expand)} push, ${pct(sh.lateral)} sideways. Content opens `
           + `${sh.sign > 0 ? 'outward from frame centre' : 'inward toward frame centre'} with strong near/far separation.`;
    }
    const dir = sh.towardOuter ? outer : inner;
    return `  ${tag}: ${pct(sh.lateral)} sideways, ${pct(sh.expand)} push — the world slides past and off `
         + `the ${dir} edge. ${Math.abs(s.angleDeg) === 90
           ? 'Nothing approaches this wall at all; it is pure lateral travel.'
           : 'A corner view, so it both slides and opens — between the centre and the side wall in equal part.'}`;
  }
  const goingLeft = sh.goingLeft;
  if (s.angleDeg === 0) {
    return `  ${tag}: content travels across frame toward the ${goingLeft ? 'RIGHT' : 'LEFT'} edge, `
         + `${pct(sh.lateral)} sideways.`;
  }
  const approaching = (goingLeft && s.angleDeg < 0) || (!goingLeft && s.angleDeg > 0);
  return `  ${tag}: sliding ${goingLeft ? 'left' : 'right'} is movement ${approaching ? 'toward' : 'away from'} `
       + `what this wall sees, so its content ${approaching ? 'grows and opens out' : 'shrinks and closes in'} `
       + `(${pct(sh.expand)} push, ${pct(sh.lateral)} sideways).`;
}

// The block that goes into EVERY wall's locked rules, so each wall knows not
// just its own path but the whole rig's — which is what stops one wall being
// generated as if it were alone.
function allPathsBlock(intent, measured) {
  const head = `CAMERA PATHS — ALL FIVE WALLS, derived from the centre. One rig, one eyepoint: `
    + `once the centre's move is known, every other wall follows by geometry (lateral share = sin of the `
    + `wall's angle, push share = cos). Nothing here is guessed.`;
  const lines = ['L', 'LR', 'C', 'RR', 'R'].map(id => pathLine(id, intent, measured));
  const src = measured && measured.source
    ? `\nMeasured from: ${measured.source}${measured.confidence ? ` (confidence: ${measured.confidence})` : ''}.`
    : '\nNo reference decoded yet — these follow from the rig intent you selected.';
  return `${head}\n\n${lines.join('\n')}${src}`;
}

module.exports = { shares, pathLine, allPathsBlock };
