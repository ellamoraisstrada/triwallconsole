---
name: tri-wall
description: |
  Open the Tri-Wall Console page and run the three-wall (triptych) video
  workflow through it, backed by the full Higgsfield CLI catalog. Use when:
  "three wall video", "tri-wall", "three monitor composition", "left center
  right wall", "open the tri-wall page", or continuing prior three-wall work.
  Left and right walls are ALWAYS locked at exactly 90 degrees from center's
  forward direction, regardless of what any reference image actually shows.
argument-hint: "[scene description]"
allowed-tools: Bash, Read
---

# Tri-Wall

A local page (not a hosted website) that gives full drag-and-drop review —
image drop, live model dropdowns, generation, previews — while every actual
generation call goes through the `higgsfield` CLI (see the
`higgsfield-generate` skill for CLI mechanics), so it always has the CLI's
full model catalog, never a hardcoded subset.

Prompts get filled in two ways, and the user can use either or both:
- **Auto-template, no LLM**: the page's own "Save & generate prompts"
  button builds all five prompts from the scene text with a fixed JS
  template — instant, free, but mechanical (no real reasoning, no looking
  at the reference image).
- **"✨ Improve" button, genuine Claude**: the page's server shells out to
  the standalone `claude` CLI (`claude auth login` once, against the
  user's own account — no separate API key) to actually rewrite one wall's
  prompt, reading the reference image file when there is one. This is a
  SEPARATE Claude Code CLI install from this skill/session — see
  `app/server.js`'s `/api/improve-prompt` handler for the exact
  invocation. Two non-obvious things that cost real debugging time, if this
  ever needs revisiting:
  1. **The prompt MUST go over stdin, never as a positional CLI argument.**
     On Windows, `claude` is a `.cmd` shim; any argument containing a
     newline gets silently truncated/corrupted at the first `\n` when
     passed positionally. Passing it via stdin (`spawn(..., {stdio:
     ['pipe',...]})` then `child.stdin.write(text); child.stdin.end()`)
     works fine regardless of length or newlines.
  2. **Never mention "Higgsfield" or "three-wall"/"tri-wall" in the
     instruction sent to headless `claude`.** In this account/org, those
     words make the model try to invoke an unauthorized Higgsfield MCP
     connector instead of just doing the task — this survived
     `--safe-mode`, a replaced `--system-prompt`, and `--setting-sources
     ''`, so it's coming from an admin-managed policy, not anything a CLI
     flag can override. Keep the instruction generic ("a separate AI
     image/video generator", "a synchronized multi-view composition").
  Also use `--json-schema '{"type":"object","properties":{"improved_prompt":
  {"type":"string"},"notes":{"type":"string"}}}'` (read back from
  `structured_output`) rather than a plain-text response — otherwise a
  genuinely useful caveat Claude wants to flag (e.g. "the scene says
  cartoony but the reference image is photorealistic") ends up prepended
  into the prompt text itself instead of surfaced separately.

The app lives at `app/server.js` + `app/index.html` next to this file
(`~/.claude/skills/tri-wall/app/`). It exposes a small local REST API the
page calls — `GET /api/models?type=image|video` and `GET /api/model/:jst`
pull the live catalog and per-model param schema straight from the CLI;
`POST /api/generate` shells out to `higgsfield generate create ... --json`
(deliberately WITHOUT `--wait` — see the submit-then-poll note below); `POST /api/improve-prompt` shells out to `claude` as above;
`POST /api/prompt` is how THIS skill (in chat) hands drafted prompts to
the page, for when the user wants that instead.

## Step 0 — Bootstrap and open the page

1. If `higgsfield` is not on `$PATH`, install it (see `higgsfield-generate`).
   If `higgsfield account status` fails, ask the user to run `higgsfield
   auth login` first.
2. Check if the server is already up: `curl -s http://localhost:8934/api/state`.
   If that fails, start it in the background:
   ```bash
   cd ~/.claude/skills/tri-wall/app && node server.js
   ```
   (On Windows, make sure Node and the npm global bin are on `PATH` for
   that shell before running it — the same PATH issue `higgsfield-generate`
   describes.)
3. Open `http://localhost:8934/` for the user (e.g. via the Browser pane's
   `preview_start`/`navigate` if available in this client).

## The fixed rules (structurally locked on the page — reference only)

**Angle** — set once per wall, never changes:
- **Center wall**: its camera's forward-facing direction is the 0-degree
  reference axis.
- **Left wall**: camera oriented at exactly 90 degrees LEFT of center's
  forward direction, perpendicular to that axis for the whole clip/frame.
- **Right wall**: camera oriented at exactly 90 degrees RIGHT of center's
  forward direction, perpendicular to that axis for the whole clip/frame.

If a reference image's apparent angle looks different from a perfect 90
degrees, treat the image only as a content/style/lighting reference — the
camera direction actually described must still be locked at the exact
angle above, not whatever the photo happens to show.

**Movement** — video only, in precise film-terminology (not vague words
like "drift") because three separately-generated AI video jobs have no
shared camera rig or seed — only the text tells each one what to do. Three
rounds of user-reported bugs shaped the current wording, in order:
1. Vague direction wording ("drift toward the right side of its own
   frame") → left wall rendered moving BACKWARD, center rendered faster
   than the sides. Fixed with exact film terms (dolly/truck/pan) and
   explicit exclusions of every motion NOT wanted.
2. That fix also said the motion should be "gentle and understated... a
   viewer notices only on a second look" → overcorrected into a
   near-static shot (right wall test clip: first and last frame were
   essentially identical, camera never actually moved). Fixed by requiring
   the motion be "clearly and unmistakably visible."
3. That fix said "physical forward dolly... do not zoom" — but naming and
   negating the effect wasn't a strong enough constraint: the center wall's
   test clip was an obvious lens zoom (mountain, treeline, and reflection
   all scaled up together at the same rate — no differential motion
   between near and far elements, confirmed by direct frame comparison),
   despite the prompt explicitly saying not to. Fixed by giving the model
   an explicit, checkable geometric definition instead of just a label to
   avoid: **parallax** — nearer elements must shift/grow position
   noticeably faster than distant ones; if the whole frame scales
   uniformly with no near/far difference, that's a zoom and is wrong. See
   the exact wording in `buildFixedVideoRules` in `app/index.html`, don't
   paraphrase it from memory here — applied to both dolly and truck, since
   the same zoom-instead-of-move failure could equally hit the side walls.
- **Center wall**: physical forward DOLLY only, defined by visible
  parallax (near shoreline/trees shift/grow faster than the distant
  mountain/sky) — no rotation, tilt, pan, or zoom. Shared reference speed
  the side walls match.
- **Left wall**: physical sideways TRUCK to the right only, same parallax
  definition (near elements shift faster than distant background) — no
  rotation, tilt, pan, zoom, or forward/backward movement.
- **Right wall**: physical sideways TRUCK to the left only — mirrors the
  left wall, same constant speed.

If a future test shows motion still off (wrong direction, wrong relative
speed, too much/too little, or zoom instead of real movement), don't just
tweak from memory — read the actual generated clip's first/last frame
(`ffmpeg -vf select=...`) to see what actually happened before rewording
again; every prior fix here was confirmed against actual frame comparisons
(parallax vs. uniform scaling is often only obvious once you look), not
guessed from the prompt text alone. A subject with no close foreground
element (a distant mountain shot, say) has less to show parallax against
than one with close-up subjects (e.g. animals near the camera) — if a
correctly-worded dolly/truck still comes out looking zoom-like or static
on a very distant/flat scene, that may be a scene-composition limit worth
flagging to the user rather than a further wording problem.

All three explicitly rule out zoom and rule out every motion type other
than their one permitted move, and all three are phrased to reference the
SAME constant speed rather than three independently-guessed "slow"s — that
shared anchor is what actually keeps them visually in sync, more than any
single wall's wording in isolation.

**Spec** — every wall is one of three displays in a synchronized 4K
(3840x2160), 30fps video wall; say so explicitly in every video prompt.

**This text is not just documentation — it's generated by
`buildFixedVideoRules(wallId, mode)` in `app/index.html` and rendered as a
read-only `<pre class="fixed-rules">` block on each video wall's card, per
the user's explicit request that it be locked and unchangeable from the
page itself (not editable by typing, not touchable by "✨ Improve").** The
ONLY way to change what it says is editing that function here in chat —
never tell the user to edit it on the page, because there's nothing there
to edit. `fullVideoPrompt(wallId, editableText)` concatenates this locked
block with the wall's separate editable field at the moment of generation;
the two are never merged or stored together in `state.json`.

### Two selectable movement modes: "Moving" vs "Idle"

Per explicit user request, `buildFixedVideoRules` takes a second param,
`mode` (`'moving'` | `'idle'`), selected via a dropdown
(`#videoMotionMode`) in the Video Generation section header — **one
global control for all three walls, not per-wall**, because the whole
point of the angle/parallax rules above is that the three walls read as
one physical camera rig; mixing a moving wall with an idle one would break
that. Selection is global JS state (`videoMotionMode`) plus persisted
server-side (`state.videoMotionMode`, via `POST /api/model-choice`, same
endpoint as image/video model choice) so it survives reload.

Implementation: the old `buildFixedVideoRules` body was split into
`buildAngleRule(wallId)` (unchanged — which wall faces which direction,
identical regardless of mode) and `buildMovingMovementRule(wallId)`
(the parallax dolly/truck text — verbatim, unchanged, this is the "perfect
for small movement forwards" version the user explicitly said to keep) and
a new `IDLE_MOVEMENT_RULE` constant. `buildFixedVideoRules` assembles
`angle + movement(by mode) + RIG_NOTE`.

**"Idle" mode** — the camera itself does not move at all (no dolly, truck,
pan, tilt, rotate, zoom), but the shot isn't a frozen photograph: the user
still wants real motion in the frame, coming entirely from the scene
itself — drifting clouds, flickering light, falling snow, rippling water —
and that motion is written into the wall's existing editable "Your
description" field, the **same field** the moving mode uses for subject
text. No third field was added; only the locked block above it changes
per-mode. This deliberately reuses the ambient-motion instruction already
built for `/api/improve-prompt`'s video branch (see below) — "idle" mode
is really "moving mode's camera rules swapped out, ambient-motion mode's
content approach kept."

Unlike the moving variant, `IDLE_MOVEMENT_RULE` is **one shared constant**
used verbatim by all three walls — there's no direction/speed to
differentiate the way "truck left" vs. "truck right" differs, since
"locked" doesn't vary by wall. If you reword it, all three walls change at
once, which is intended.

**Loop requirement, added after the mode itself**: an idle wall is meant to
play on a continuous loop (a static-camera display, not a one-shot clip),
so `IDLE_MOVEMENT_RULE` also carries a second paragraph — "Fixed loop
rule" — telling the generator the final frame must lead back into the
first with no visible jump, and constraining what counts as valid ambient
motion to **cyclical/steady-state** (falling snow, flickering light,
rippling water) rather than **cumulative or one-directional** (a cloud
drifting off toward one edge and gone, snow visibly piling up) — the
latter can't loop without a visible discontinuity. This is a real
constraint on what the wall's own editable "description" text should
describe in idle mode, not just a note to the generator: if the user (or
Claude drafting via Improve) writes motion that trends in one direction
over the clip, it will read as looping badly even though the fixed rule
told the generator to try.

**Known gap, flagged rather than silently left**: `/api/improve-prompt`'s
video branch (the "Generate descriptive prompt" / "Generate prompt from
image" auto-draft) has no idea whether the wall is currently in moving or
idle mode — the client never sends `videoMotionMode` to that endpoint. So
Claude drafting ambient-motion text for an idle wall could plausibly write
something one-directional (e.g. "the cloud drifts toward the horizon") that
contradicts the loop rule once concatenated, the same class of problem the
image-mode landmark-repeat bug was. Not yet fixed — if the user reports
idle-mode drafts describing non-looping motion, that's why, and the fix is
to pass `mode` through to `/api/improve-prompt` and add a loop-aware
sentence to its video instruction when `mode === 'idle'`.

### Locked numeric camera speed (moving mode only)

Per explicit user request, `buildMovingMovementRule(wallId, speedKmh)` now
takes a speed and bakes it into the text as a concrete km/h number — a
stronger anchor than the qualitative "slow, smooth, clearly visible"
language alone (same lesson as the parallax fix: a checkable number beats
a vague adjective). Inserted at the two points that already talked about
pace, without touching anything else in the user-approved wording.
Idle mode has no speed (no camera movement at all), so this only applies
when `mode === 'moving'`.

Global JS state `videoCameraSpeedKmh` (default **15**, the user's own
example value), a number input (`#videoCameraSpeed`, "Speed ___ km/h") next
to the mode dropdown in the Video Generation section header, persisted
server-side (`state.videoCameraSpeedKmh`, same `/api/model-choice`
endpoint). **Global for all three walls, same one-rig reasoning as the mode
dropdown** — a real rig doesn't have three different speeds. The input
hides itself (`updateSpeedInputVisibility()`) when mode is `idle`, since a
locked camera has no speed to state.

Wording pattern used — note the two different phrasings for the two
mentions (`exactly ${speedKmh} kilometers per hour` the first time,
`${speedKmh} km/h` on the shorter cross-reference) — an earlier draft used
the long form both times and read as "this exactly 15 kilometers per hour
pace," which is clunky; caught on the first read-through and fixed before
reporting back:

> *"...at one constant, unchanging speed of exactly 15 kilometers per hour
> for the entire clip... This 15 km/h pace is the shared reference speed
> for the whole three-wall rig..."*

## Image composition mode: "Distinct" vs "Panoramic"

Round 6 of the image fixed rules (see "The fixed image rules" below) locked
in "Distinct" — each wall a genuinely separate photo, no shared landmark —
as the only option, after the user had explicitly moved away from round 1's
original panoramic-pivot concept. Later, per explicit user request ("I want
to add option between the fixed rule I have right now for image generation,
as well as another one that is for image extension like we had before... I
want people to be able to choose between the two"), that panoramic concept
came back as a SECOND SELECTABLE mode rather than a replacement — the two
now live side by side via `#imageCompositionMode` in the "Reference images"
section header, the same "Moving"/"Idle" dropdown pattern already
established for video's `videoMotionMode`. Global across all three walls,
same one-composition reasoning as everywhere else a global mode dropdown
exists in this app — mixing modes between walls would break whichever
effect is intended. Persisted as `state.imageCompositionMode` (default
`'distinct'`) via the same `/api/model-choice` endpoint.

**This is not a literal revert to round 1's own wording.** The user's
request this time was more specific than round 1 ever was: continuity has
to hold at the SEAM between adjacent walls specifically — their own
example: half a cloud visible at the left wall's right edge, the rest of
that same cloud picked up at the center wall's left edge. Round 1's
wording ("same mountain, same horizon, continuing seamlessly from the
center image's viewpoint") never actually named edges or seams explicitly.
`buildPanoramicImageRules(side)` in `app/index.html` does: each wall is
told it's one third of a single continuous panorama, its OUTER edge (the
one with no neighbor) needs nothing, and its SEAM edge (the one bordering
center) must continue whatever crosses that boundary — named explicitly per
side (left's right edge ↔ center's left edge; center's own left edge ↔
left's right edge AND center's right edge ↔ right's left edge; right's left
edge ↔ center's right edge). It keeps round 2's straight-on/pulled-back
camera framing and the shared `STATIC_LOCK_NOTE` — the user never said
either of those was the problem; round 1 was dropped for the panoramic
CONCEPT itself ("too much like a panoramic view"), not for anything added
on top of it in round 2.

**Original round-4 "Distinct" wording is untouched** — it's now
`buildDistinctImageRules(side)` (renamed, byte-for-byte the same body as
the old `buildFixedImageRules`), selected via `buildFixedImageRules(side,
mode)` dispatching on `mode`. Same architecture as `buildFixedVideoRules`
dispatching on `videoMotionMode`: a thin `mode`-aware wrapper over two
otherwise-independent, fully-formed rule builders.

**`/api/improve-prompt`'s image-mode branch also had to become mode-aware**,
caught while building this: its existing instruction explicitly tells
Claude NOT to describe the reference image's own subject/landmark (correct
for "Distinct," where the fixed block forbids repeating it) — which would
directly CONTRADICT "Panoramic" mode's fixed block, which requires exactly
that continuity. The client now sends `compositionMode` (only meaningful
for `kind === 'img'`) alongside the existing `mode`/`currentPrompt`/`scene`/
`imagePath` fields; the server branches on it before either mode's
`instruction` is built, so Claude is always given guidance that matches
whichever fixed block will actually be concatenated with its output.
Verified live: with an empty draft under Panoramic mode and no scene text,
Claude correctly described continuing scenery grounded in the actual
reference image, without needing to repeat continuity/edge-matching
language (already covered by the fixed block) or inventing an unrelated
subject.

**Reference wording, for when this needs adjusting again** — read the exact
current text from `buildPanoramicImageRules`/`buildDistinctImageRules` in
`app/index.html`, don't paraphrase from memory; this doc explains the
reasoning, not the literal prompt.

## Start/end frame for MiniMax H3 and similar video models

Per explicit user request: "video minimax h3 has start and end frames I can
add. However in tri wall console I cannot add a start frame and end frame."
Most video models here take one reference image and animate FROM it; a
model shaped like MiniMax H3 instead takes a separate **start** and **end**
frame — feeding the same image as both produces a clean seamless loop
(useful for idle-mode walls), and different images morph between the two.

**Scoped to an explicit allowlist, NOT detected from the live model
schema** — first built the other way (checking whether a model's own
`params` list contained both `start_image` and `end_image` by name), which
seemed like it would generalize better than hardcoding one job_type. That
turned out wrong in practice: Seedance 2.0's schema ALSO has both params
(confirmed live), so the frame UI was showing up there too — and the user
explicitly does NOT want that: **"I only want start frame and end frame
option for when I am using Minimax H3... if I am using Seedance or other
AIs it does not do that."** Fixed by replacing the schema check with a
plain allowlist, `START_END_FRAME_MODELS = new Set(['minimax_h3',
'minimax_h3_max'])` in `app/index.html`, checked via
`videoModelWantsStartEndFrame(jst)` — H3 Max included per the user's own
follow-up confirmation (same capability, same family), everything else
excluded even if its schema happens to look the same. **If a future model
should get this UI, it needs to be added to that allowlist explicitly —
schema shape alone is deliberately NOT trusted for this decision anymore.**
(Google Veo 3, which only has `start_image` and no `end_image`, was never
affected either way — it was never a candidate under either approach.)

**UI**: each wall's Video Generation card gets a `Start frame`/`End frame`
dropzone PAIR (`vidframes-${id}` in `buildWallCard`'s `vid` branch),
positioned right after the wall's normal reference-image dropzone. Hidden
(`display:none`) by default; `refreshStartEndFrameVisibility()` shows or
hides them for all three walls together on page load and whenever
`#videoModelSelect` changes — this has to be global-not-per-wall the same
way the video model itself is, since it's driven by which model is
currently selected, not by anything wall-specific. When shown, both
dropzones behave like any other dropzone here (drag-and-drop or click to
upload, ✕ to remove) via their own small self-contained implementation
(`renderFrameDropzone`/`handleFrameUpload`/`wireFrameDropzone` — kept
separate from the existing generic `renderDropzone`/`handleUpload`/
`wireDropzone`, which are already stretched across three kinds ('img',
'vid', 'ref') and would have gotten harder to follow stretched across a
fourth and fifth).

**State**: two new per-wall fields, `startFramePath`/`endFramePath` (local
file paths, same shape as `uploadedImagePath` — set via `POST /api/upload`
with an added `field` param naming which one to write to, cleared via
`POST /api/clear-image` with the same `field` param so removing a frame
never touches the wall's actual main image state).

**Generation**: in `generate('vid', id)`, if the CURRENTLY selected video
model is in the allowlist, the wall's normal single `imagePath` is
deliberately left `null` and
`startFramePath`/`endFramePath` (from `state.walls[id]`) are sent instead —
MiniMax H3's own validation rule rejects `start_image`/`end_image` mixed
with `image_references` (confirmed via `higgsfield model get minimax_h3
--json`), so these three are kept mutually exclusive by construction, not
just by the server trusting the client. Server-side, `/api/generate` maps
them straight to the CLI's own `--start-image`/`--end-image` flags
(confirmed via `higgsfield generate create --help` — these are real,
distinct flags from `--image`/`--image-references`, not an alias).

**A real, unrelated bug found and fixed while adding this**: `state.json`
loading did `Object.assign(defaultState(), JSON.parse(saved))` — since
`walls` is itself one top-level key, a SAVED `walls` object (written before
`startFramePath`/`endFramePath`, or before `editPrompt` from the Refine
feature above, existed) completely replaced `defaultState()`'s freshly-
defaulted `walls` object rather than merging into it, silently dropping
those fields' defaults from an existing `state.json` (they'd end up
`undefined` instead of `null`/`''` until first explicitly written — mostly
harmless since every reader already falls back with `||`, but exactly the
kind of thing that quietly bites the THIRD time a new per-wall field gets
added). Fixed by merging each wall individually — `WALL_IDS.forEach(id =>
{ merged.walls[id] = Object.assign(defaultState().walls[id],
saved.walls?.[id] || {}); })` — so an old `state.json` always fills in a
newly-added per-wall field's default without needing to be deleted or
reset.

## Refine image: remove or add one small thing

Per explicit user request — "the images I want to approve are almost
perfect however there might be one object that is in the image that I want
removed or added afterward" — there's a **"Refine image"** section between
Reference Images and Video Generation (`#refineWalls`, one card per wall via
`buildRefineCard` in `app/index.html`). Each card shows a read-only preview
of the wall's CURRENT image, the locked edit note, an editable "what to
change" instruction, a **Generate descriptive prompt** button (Claude), an
**Apply edit** button, and its own **Approve** button.

**Why this is a small, separate feature rather than reusing the main image
generation** — regenerating from scratch redraws the whole photo and loses
the parts that were already right; this instead runs the wall's *existing*
image through an image-**editing** model (Flux Kontext / Nano Banana /
similar — any catalog model shaped like `image_references` + `prompt`
works, picked via `#editModelSelect`, defaulted to `flux_kontext` but never
hardcoded as the only option, same `never hardcode a model list` principle
as everywhere else in this app) with an instruction naming just the one
thing to remove or add.

**Locked edit note** (`EDIT_LOCK_NOTE` in `app/index.html`, architecturally
identical to `STATIC_LOCK_NOTE`/the video fixed rules — locked, read-only,
never sent to Improve, concatenated with the editable instruction only at
generation time via `fullEditPrompt`): tells the editing model to change
ONLY what the instruction says and leave composition, framing, lighting,
palette, and every other object exactly as-is. Without this, an editing
model asked to "add a squirrel" can still take noticeable liberties with
the rest of the photo.

**Reuses `genImageUrl`/`genImageStatus`** — the SAME state fields the main
Reference Images generation writes, rather than a separate result slot. An
edit's output IS this wall's new generated image, so it shows up in the
Reference Images card too, and BOTH cards' Approve buttons pick it up with
zero new state shape. This also means edits chain naturally — editing twice
in a row edits the first edit's own result, not the original.

**The one real wrinkle: working on an image BEFORE it's Approved.**
Approving is normally what downloads a Higgsfield result locally (see
`/api/approve`) — before that, a wall's current image only exists as a
remote `genImageUrl`, but both the CLI's `--image` flag and Claude's Read
tool need a real local file. Per the user's own stated workflow (touch up
*before* approving), this can't just require Approve-first. Fixed by
`resolveWallLocalImagePath(wall)` in `server.js`: downloads `genImageUrl`
fresh to a local temp file if that's the wall's current image, else falls
back to `approvedImagePath`/`uploadedImagePath` (already local). Used by
both `POST /api/edit-image` (the actual edit) and `POST /api/improve-prompt`
with `mode: 'edit'` (see below) — always re-downloads rather than caching,
since a second edit needs the LATEST result, not a stale copy of the first.

**`POST /api/edit-image`**: `{ wall, jst, prompt, params }` → resolves the
local image path, runs `generate create <jst> --prompt <prompt> [...params]
--image <path> --json` (no `--wait`, same submit-then-poll pattern as every
other generation call here — see the big comment on `pollJobUntilDone` for
why), writes the result to `genImageUrl`/`genImageStatus` on completion.

**`/api/improve-prompt` gained a third mode, `'edit'`** (alongside
`'image'`/`'video'`): unlike those two, it ignores whatever `imagePath` the
client sends and resolves the wall's own current image itself via
`resolveWallLocalImagePath` — the client only ever has a display URL for a
not-yet-approved image, never a real local path. Its instruction asks
Claude for ONE clear, concrete, single-item edit instruction (naming the
specific object, with enough detail to disambiguate if more than one
plausible match is visible) — explicitly not a scene re-description, not a
lighting/style change, not more than one change bundled together. **If the
draft instruction is empty**, mirroring how the image/video Improve buttons
already draft fresh content from nothing, Claude instead picks ONE small,
plausible object to remove (or one unobtrusive one to add) by looking at
the actual image, and is told to flag in `notes` that it was Claude's own
suggestion rather than the user's request — verified live: on an empty
instruction, Claude correctly proposed "Add a small brown squirrel sitting
on top of the wooden bench..." grounded in what was actually in that wall's
photo, and clearly labeled it as its own suggestion.

**Apply Edit is disabled until both a current image exists AND the
instruction field is non-empty** (`updateRefineGenerateEnabled`) — unlike
image/video Generate, which are always enabled since their fixed block is a
complete prompt on its own, the edit lock note alone ("change only what's
below") is meaningless with nothing below.

**A real bug caught and fixed during this build, worth knowing if
`restoreGenState` is ever touched again**: it originally hardcoded
`imgapprove-${id}` as the Approve button id regardless of the `kind`
argument passed in — harmless while only `'img'`/`'vid'` existed (video
never uses that branch), but once `'refine'` started calling
`restoreGenState('refine', id, ...)` too, it silently updated the WRONG
button (`imgapprove-` instead of `refineapprove-`), so the refine card's
own Approve button never appeared on page load even though the state said
it should. Fixed to use `${kind}approve-${id}` generically. `clearWallImage`
had the same-shaped gap (only ever cleared `imgapprove-`) and was extended
to also clear `refineapprove-`'s visibility and the refine pill/status.

## Fixing left/right speed or path mismatches with Genjutsu

Left and right walls are independently-generated AI video jobs — even with
identical locked rules (see above), they have no shared camera rig or seed,
so one occasionally comes out at a visibly different speed, or (rarer)
following a different-shaped path, than its counterpart. Per explicit user
request ("center's movement almost always works, that won't play a factor"
— this feature is scoped to LEFT/RIGHT only, never center), the page has a
**"Fix left/right mismatch"** section below the video walls
(`#genjutsuGoodWall` dropdown, `#genjutsuFixBtn`) that regenerates the
*mismatched* wall's video to match the *good* wall's exact speed/path, using
Higgsfield's `hf_mult_motion_control` ("Genjutsu") motion-transfer model.

**The core problem this solves isn't just "copy the good wall's motion
onto the bad wall's content"** — left and right are mirror-opposite
movements by design (left trucks right, right trucks left, see "The fixed
rules" above). If you naively feed the good wall's video straight into
Genjutsu as the motion reference against the bad wall's image, you get back
a video with the *good* wall's own direction, not its mirror — e.g.
referencing left's video (which trucks right) to fix right's image produces
a video that ALSO trucks right, when right is supposed to truck left. This
was the user's exact concern raised before building this
("...give back a right wall video that has the same camera path as the
left wall video of moving to the right, where we want the movement to be
to the left").

**The fix: horizontally mirror the good wall's video before handing it to
Genjutsu as the motion reference.** `ffmpeg -vf hflip` flips every frame
left-right, which reverses the apparent camera-motion direction while
preserving exact timing/speed (frame-for-frame, nothing about pacing
changes) — so mirroring left's rightward-trucking video produces a
reference that trucks *left*, exactly what right's fix needs. `goodWall` is
whichever the user picks as correct; `badWall` is inferred as the other of
`left`/`right` (never center — the dropdown only offers left/right).

Implementation, `POST /api/genjutsu-fix` in `app/server.js`:
1. Validate `goodWall` is `'left'` or `'right'`; infer `badWall` as the
   opposite.
2. Download the good wall's current video, mirror it with `runFfmpeg(['-y',
   '-i', rawPath, '-vf', 'hflip', '-c:a', 'copy', mirroredPath])`.
3. Submit `hf_mult_motion_control` with `--image-references <badWall's own
   image>` (content — keeps the bad wall's actual scene), `--video-references
   <mirrored video>` (motion only), `--resolution 1080p` (this model's max —
   no 4K, unlike the main video models; the response includes a note about
   this cap so the user isn't surprised by a lower-res result), and an
   optional `--prompt <badWall's imagePrompt>`. Per the `higgsfield-generate`
   skill's established Genjutsu finding, keep this prompt minimal/content-only
   — the reference video already carries the motion signal, and text
   describing motion competes with it rather than reinforcing it.
4. Submit-without-`--wait`, poll-separately (same pattern as the rest of this
   app): `runCli` → parse job id → `pollJobUntilDone(jobId, maxWaitMs)` →
   `pollJobInBackground` fallback on timeout.
5. On completion, write the result to `state.walls[badWall].genVideoUrl` /
   `genVideoStatus` — this **replaces** the bad wall's existing video, same
   as any other generate action; there's no separate before/after slot.

`resolveFfmpegBinary()` mirrors the existing `resolveHiggsfieldBinary()`
defensive-resolution pattern — ffmpeg is NOT reliably on bare `$PATH` for a
backgrounded `node server.js` process even when it works in an interactive
shell (confirmed: it's only added via shell-profile PATH changes, not
system-wide), so it checks absolute install-path candidates
(`C:\FFmpeg\bin\ffmpeg.exe` on Windows) before falling back to a bare
`'ffmpeg'` spawn call.

**Verified end-to-end** (2026-09-15) against real left/right wall content:
downloaded the "fixed" result's first/middle/last frames and compared them
against (a) the original good wall's own first/last frames and (b) a
locally-reproduced mirrored copy of the good wall's video. The bad wall's
fixed output tracked the *mirrored* reference's motion pattern (content
receding toward opposite edges frame-over-frame, monotonically across all
three sampled frames) rather than the original good wall's un-mirrored
pattern, and clip duration matched to within 20ms — confirming the mirror
step correctly reverses direction while Genjutsu faithfully transfers speed
and path onto the new content. Caveat worth knowing: the actual motion
transferred was whatever the good wall's video *actually* contained, which
in this test read more like a combined dolly-zoom than a pure lateral truck
(likely because that AI-generated clip didn't perfectly follow the locked
truck-only rule to begin with, an upstream generation imperfection, not a
flaw in the mirror/transfer technique) — this fix reproduces the good
wall's real motion faithfully, but can't correct for the good wall's own
video already being imperfect.

## Layout: all three walls get an Image Generation card

**Changed from an earlier version of this doc** — center used to have no
card in Reference Images at all (image-source-only, upload/generate via the
Video Generation section only). Per explicit user request for parity across
left/center/right, `IMAGE_WALLS` now equals `WALLS` (all three), and center
gets the same card as left/right: locked fixed rules, an editable subject
field, Generate, "Generate descriptive prompt" (Improve), and Approve.

- Left/right's IMAGE generation still automatically sends center's image
  (`walls.center.approvedImagePath` or, failing that,
  `walls.center.uploadedImagePath`) as the CLI's `--image` reference.
- **Changed from an earlier version of this doc**: center's own IMAGE
  generation used to pass NO `--image` reference at all — a pure
  text-to-image call, on the reasoning that center is the anchor with
  nothing to pivot off. That silently ignored any photo the user dropped on
  center's own dropzone, which is exactly what the user ran into: "I am
  trying to generate a center image however there is no reference image
  being shown in higgsfield." Per their explicit follow-up confirmation,
  `referenceImagePathFor('img', id)` in `app/index.html` now resolves to
  `wallReferencePath('center')` for EVERY wall including center itself —
  since that function is `approvedImagePath || uploadedImagePath`, for
  center that's simply its own image, so no special-casing was needed
  beyond removing the old `id !== 'center' ? ... : null` branch. If center
  has nothing uploaded/approved yet this still resolves to `null` exactly
  as before (plain text-to-image), so nothing broke for the empty case —
  this only changes behavior once a photo is actually present on center.
  `/api/improve-prompt`'s image-mode instruction also needed a
  center-specific branch to match: the existing instruction explicitly told
  Claude NOT to describe the reference's own subject (correct for
  left/right, whose fixed block forbids repeating center's landmark) —
  which would have directly contradicted center's own case, where the
  reference is now this wall's OWN photo meant to be built from, not
  avoided. Verified live: with an empty draft and center's own photo
  attached (a cartoon city street), Claude correctly wrote a detailed
  description grounded in what was actually pictured, rather than avoiding
  it. The panoramic-mode instruction got a smaller matching fix (a
  parenthetical that assumed the reference was always "the neighboring
  wall's own photo," now conditional on `wall === 'center'`).
- Center can still also be set by simply dropping a photo on the Video
  Generation section's dropzone, unchanged — both paths write to the same
  `state.walls.center` fields (`uploadedImagePath`/`genImageUrl`/
  `approvedImagePath`), so they stay in sync regardless of which one the
  user uses.
- Left/right's own video generation still references THEIR OWN approved/
  uploaded image, same as before.
- The "Generate left & right" one-click button (below) is unchanged in
  scope — still only left+right. Center has its own Generate button on its
  own card now instead.

## The fixed image rules (structurally locked, mirrors video's — reference only)

Every left/right wall IMAGE also has a locked, page-generated "fixed rules"
block now, the same mechanism as the video fixed rules above — a read-only
`<pre class="fixed-rules">` on each image wall's card, generated by
`buildFixedImageRules(side)` in `app/index.html`, never editable by typing
or touched by "✨ Improve". `fullImagePrompt(wallId, editableText)`
concatenates it with the wall's own editable subject field at generation
time; the two are never merged or stored together in `state.json`. The
ONLY way to change what it says is editing that function here in chat.

This exists because of a live back-and-forth with the user over what
"left/right locked at 90 degrees from center" should actually mean for
IMAGE content specifically (video's camera-angle lock is separate and
unaffected by any of this) — six rounds, in order:
1. First version: a literal 90-degree pivot off the center image — explicit
   "same mountain, same horizon, continuing seamlessly from the center
   image's viewpoint." User's verdict: **"this feels too much like a
   panoramic view"** — it read as one wide photo sliced into three, not
   three related but independent photographs.
2. Fixed: match the reference's lighting, season, time of day, palette, and
   mood — but require a genuinely distinct composition, explicitly no
   repeat of the center image's specific landmark or horizon line. Went too
   far the other way at first (too close, shot at an angle, shoreline
   receding diagonally) — refined with explicit straight-on/perpendicular
   camera framing and a pulled-back distance. Confirmed by the user as
   "perfect" at this point, BUT the wording still hardcoded lake/mountain/
   forest/rocks vocabulary, since it happened to be tested on a lake scene.
3. User caught that scene-specific vocabulary wouldn't generalize and asked
   for it removed — rewritten to be scene-agnostic (no environment type
   assumed at all) while keeping every structural principle.
4. User then asked for the 90-degree LEFT/RIGHT orientation concept back —
   they'd only rejected the *literal panoramic implementation* of it
   (shared landmark, continuous horizon) in round 1, not the idea that each
   wall faces a different direction than center. Current version: states
   the 90-degree relationship explicitly (`side` param, "left"/"right"),
   immediately paired with the same "genuinely distinct, not a continued/
   extended view" language from round 2 — the direction is real, the
   content is not a stitched-together extension of center's frame.
5. **Extended to cover CENTER**, which previously had no fixed-rules block
   at all (it was upload/generate-only, no locked style, no card in
   Reference Images). `buildFixedImageRules(side)` now branches on
   `side === 'center'`: no 90-degree/"distinct from center" language (it
   IS the anchor, nothing to be distinct from), but the same camera-framing
   paragraph (straight-on, pulled-back) and the new shared static-lock note
   (next point). `IMAGE_WALLS` changed from `WALLS.filter(w => w.id !==
   'center')` to plain `WALLS` — center now renders a full card (locked
   rules, editable subject, Generate, Improve, Approve) exactly like
   left/right. See "Layout" above for what changed mechanically.
6. **Added an explicit, shared "this is a static shot, camera does not
   move" clause** (`STATIC_LOCK_NOTE`) to all three walls' image rules —
   previously this was only implied by a single trailing sentence ("This is
   a single still photograph, not a video"). Explicitly requested by the
   user. Same constant, reused identically in the center branch and the
   left/right branch — if you reword one, reword both, they're meant to
   read identically.

See the actual wording of both `STATIC_LOCK_NOTE` and `buildFixedImageRules`
in `app/index.html`, don't paraphrase from memory here.

The user explicitly confirmed this is now the **default look for every
image on every wall** going forward, and asked for it to be locked the same
way video's rules are — don't revert to the panoramic-pivot wording, don't
reintroduce scene-specific vocabulary, don't drop the 90-degree orientation
sentence (left/right) or the anchor-role sentence (center), and don't drop
the static-lock note from any of the three.

**Chaining between left and right**: both still reference CENTER's image at
generation time (`referenceImagePathFor` is unchanged), but nothing stops
using an already-generated LEFT/RIGHT image as the reference for the other
side instead, if the user asks for that — pass its job id or a local file
path as `imagePath` in `/api/generate`'s body. Worth doing when one side's
result is confirmed as the exact look wanted and the goal is matching style
precisely, rather than both independently guessing style from center alone.

**One-click "Generate left & right"**: a button next to the "Reference
images" section header (`#genLeftRightBtn` in `app/index.html`) fires both
walls' existing `generate('img', 'left'/'right')` calls together. It
doesn't change how either wall generates — it's just a convenience so
setting/swapping center's image (a mountain, a snow cabin, anything else)
and clicking once produces a correctly-matched left and right, without two
separate manual Generate clicks. Explicitly requested by the user as
"one click" behavior; live-tested against a snow-cabin center image with
both wall subject fields left blank — the model inferred plausible,
on-theme content automatically from the fixed rules alone (a woodshed, a
smaller cabin with a lit tree), confirming the locked rules generalize
without needing per-scene subject text. It refuses to run (with a status
message) if center has no reference image set yet.

Also fixed alongside this: `renderFieldsFor` now pre-selects `16:9` for an
image model's `aspect_ratio` field whenever the model offers it (GPT Image
2 otherwise defaults to a square 1:1, wrong for a wall in a widescreen
composition) — this applies to every image generation, one-click or manual,
not just this button.

**Auto-drafting descriptions with Claude, one click**: the per-wall button
formerly labeled "✨ Improve" is now labeled **"Generate descriptive
prompt"** on both image and video wall cards (still the same
`improvePrompt(kind, id)` function underneath) — renamed at the user's
request since "Improve" undersold what it actually does when the field is
empty: write a fresh description from scratch by reading the reference
image, not just polish existing text.

`genLeftRightBtn` (image, described above) now also auto-drafts first: for
each of left/right whose editable field is still blank, it runs
`improvePrompt('img', id)` before generating — Claude looks at CENTER's
image and writes fresh subject text, no scene description or typing
required. A wall that already has text is left alone (never overwritten by
the one-click flow). **Caught and fixed live**: the first version of the
image-mode Improve instruction let Claude describe the reference image's
own main subject when nothing else was given (e.g. reference showed a
decorated cabin → it wrote "a cozy log cabin decorated for Christmas..."
literally describing that cabin) — which directly fights the fixed block's
"don't repeat the reference's landmark" rule once concatenated. Fixed by
telling Claude explicitly, in the improve-prompt instruction itself, that
it must describe a *different* plausible subject in the same setting/mood,
never the reference's own pictured subject.

A parallel button, **`draftVideoPromptsBtn`**, labeled "Generate prompt
from image", sits next to the "Video generation" header and runs
`improvePrompt('vid', id)` for all three walls at once — but
**only drafts, never generates video**, unlike the image button. Video
generation is slow/expensive enough that auto-triggering it wasn't wanted;
the user reviews wording first, then clicks Generate per wall themselves.
Each wall reads from its OWN reference image (not center's) via the exact
same `referenceImagePathFor('vid', id)` the per-wall button already used —
no new server-side behavior, just fired for three walls together. Skips
(with a status note, not an error) any wall that has no reference image
yet, and leaves alone any wall that already has text.

**What the video Improve instruction actually asks for changed since the
above was written.** It originally asked Claude to describe the static
scene (setting/objects/lighting/mood) from the reference image — but the
user pointed out that's entirely redundant: the wall's own IMAGE prompt
already covers exactly that, so the video prompt was just repeating it.
What a still photo genuinely lacks for video is motion. The instruction
now asks for ONLY ambient motion within the scene — grounded in what's
actually pictured, not invented: snow or rain falling, clouds drifting,
water rippling, smoke/steam rising, lights or fire flickering, foliage or
fabric stirring in a breeze. Still explicitly out of scope: the static
scene itself (covered by the image prompt) and camera rig movement (the
fixed block). Verified live on the left wall's snow-cabin-adjacent
reference (a woodshed/lantern/fence photo) — Claude correctly wrote about
falling snow, flickering lantern flames, drifting clouds, and pine boughs
releasing powder, with zero re-description of the shed/fence/lantern
themselves. If asked to redo this again, the exact wording lives in the
`mode === 'video'` branch of `/api/improve-prompt` in `app/server.js` —
don't paraphrase from memory, and don't revert to describing the static
scene.

**Any video prompt already drafted before this change is stale** — it
still describes static content, not motion, since it was written under the
old instruction. Redraft with the "Generate prompt from image"/per-wall
button (or ask the user if they want that done) rather than assuming
existing text already fits the new ambient-motion intent.

## Workflow

1. **Get the scene, once.** The user may type it directly on the page
   (Scene card → **Save scene**) instead of dictating it in chat — so
   before asking for it, check `curl -s http://localhost:8934/api/state`
   for a non-empty `scene` field and use that if present. Only ask the
   user to describe it in chat if the page's scene is empty. If they DO
   give it to you in chat, push it: `curl -s -X POST
   http://localhost:8934/api/scene -H "Content-Type: application/json"
   -d '{"text": "<scene>"}'`.

2. **Center's image**: tell the user to drop or generate it directly on the
   Center wall's Video Generation card — it's the anchor everything else
   pivots off, and it has no separate image-prompt card of its own.

3. **Draft left/right's IMAGE prompts' editable text only** (mode
   `image`) — just the subject/action for that wall (e.g. "A mother grizzly
   bear and two cubs stand at the rocky water's edge, dipping their heads to
   drink"), NOT a pivot instruction and NOT a full re-description of the
   scene. **Never include camera-framing or "match the reference" language**
   — the page renders that itself as a locked block (see "The fixed image
   rules" above) and concatenates it at generation time. Pushing it again
   here would just duplicate/conflict with what's already there, which is
   exactly the mistake that produced the old panoramic-pivot behavior the
   user rejected.

   Push each with mode `image`:
   ```bash
   curl -s -X POST http://localhost:8934/api/prompt -H "Content-Type: application/json" \
     -d '{"wall":"left","mode":"image","text":"<wall-specific subject only>"}'
   ```

4. **Draft the three VIDEO prompts' editable text only** (mode `video`) —
   see "Drafting a video prompt" below. **Never include the fixed
   camera-angle/movement/4K-30fps-spec text** in what you push; the page
   renders that itself as a locked block (see "The fixed rules" above) and
   concatenates it at generation time. Pushing it again here would just
   duplicate it in the wall's editable field, which the user explicitly
   doesn't want. Push each with mode `video`:
   ```bash
   curl -s -X POST http://localhost:8934/api/prompt -H "Content-Type: application/json" \
     -d '{"wall":"left","mode":"video","text":"<wall-specific description only>"}'
   ```

   Tell the user to click **Sync from chat** on the page (or refresh) once
   pushed, then review/edit there and click **Generate** per wall. The user
   drives image drop, model choice, field tweaks, generation and approval
   on the page itself — that's the whole point of it existing.

5. **If asked to redraft** a wall's prompt, draft again and push the same
   way — it overwrites what's there.

6. **Model choice**: leave it to the user on the page; it lists every
   model the CLI reports (image and video) with real parameters, and
   defaults to GPT Image 2 / Seedance 2.0 if untouched.

## Drafting a video prompt

For wall `W` (`left` | `center` | `right`), draft ONLY the wall-specific
descriptive text — setting, objects, action, lighting, mood, materials,
timing. **Do not** write or restate the camera-angle rule, the movement
rule, or the 4K/30fps spec — those are the page's locked block (see "The
fixed rules"), added automatically, and duplicating them in the editable
text is exactly what the user asked to stop happening.

- Fully self-contained per wall — don't reference "the left wall" or "the
  right wall" in `W`'s own text; just describe what's on `W`.
- The scene description the user gives you may describe multiple walls at
  once (e.g. "on the left wall I want bears... and on the right wall I
  want caribou..."). Use ONLY the part of it that's actually about `W` —
  ignore anything that's about a different wall. This is the exact bug
  that prompted this whole split: the old template dumped the same raw
  scene text into all three walls verbatim, so center's prompt ended up
  mentioning "left wall" and "right wall" nonsensically.
- Pull setting/objects/lighting from that wall's reference image (check
  `GET /api/state` for `walls.<id>.genImageUrl` / `uploadedImagePath`) as
  the visual starting point — describe what's actually there, don't invent
  unrelated content.
- Include timestamps if the scene description implies them.
- All three should describe the SAME lighting, time of day, palette and
  materials — they're three angles on one physical scene, not three
  unrelated ones.
- This mirrors what the page's own "✨ Improve" button does server-side
  (`app/server.js`'s `/api/improve-prompt`, `mode:'video'` branch) — draft
  in the same spirit if the user asks you to do it directly in chat instead
  of clicking Improve on the page.

## Notes

- Never hardcode a model list as the only choice for anything you do
  outside the page (e.g. if the user asks you to generate something
  directly in chat instead) — always check the live catalog.
- If the user already has their own reference photos, they can drop them
  directly on any wall's card — no need to generate anything first.
- The page persists its state to `app/state.json` next to the server, so
  closing and reopening the page (or restarting the server) keeps the
  scene, prompts, and generated results.
