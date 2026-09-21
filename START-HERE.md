# Tri-Wall Console — start here

A local tool for building three-wall immersive content. You run your own copy on
your own machine, against **your own** Claude and Higgsfield accounts.

---

## 1. Run it

**Windows** — double-click **`Launch Tri-Wall Console.bat`**
**macOS / Linux** — `chmod +x run.sh` once, then `./run.sh`

`run.bat` still works and does the same thing — both now run `launch.ps1`.

### Put a button on your desktop

Run this once, in PowerShell, from this folder. It puts a **Tri-Wall Console**
shortcut on your desktop; after that, starting the tool is one double-click and
you never need the terminal.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\make-shortcut.ps1
```

Right-click the shortcut → **Pin to taskbar** if you want it permanently to hand.

First run installs what's missing and takes a minute or two. After that it's a
few seconds. Your browser opens on `http://localhost:8934` **once the server is
actually listening** — not before, so you won't land on an error page.

If a console is already running, launching again just opens the browser at it
rather than starting a second copy and failing on the port.

Leave the black window open while you work — that's the server. Closing it stops
the tool.

## 2. Sign in

The **Connections** panel at the top of the page tells you exactly what's missing
and what to do about it. Green dot = ready.

| What | Needed for | Get it |
|---|---|---|
| **Higgsfield CLI** | all generation | `npm i -g @higgsfield/cli` then `higgsfield auth login` |
| **Claude CLI** | writing prompts | `npm i -g @anthropic-ai/claude-code`, then run `claude` and type `/login` |
| Python + OpenCV | decoding references, self-calibration | installed automatically by the launcher |
| FFmpeg | the left/right mirror fix only | `winget install Gyan.FFmpeg` / `brew install ffmpeg` |

**There are three steps for Higgsfield, not two** — the third catches everyone out:

1. **Install** — the button runs `npm i -g @higgsfield/cli` for you. No terminal.
2. **Sign in** — opens a terminal running `higgsfield auth login`, which signs you
   in through your browser against **your own** account.
3. **Pick a billing workspace** — a dropdown appears once you are signed in.
   **Until you pick one, every single generation fails** with "No workspace
   selected", even though you are signed in. This is also what your credits bill
   to, so on a shared project make sure it is the account you mean.

Then click **Re-check**. **Sign out** switches accounts on a shared machine.

> **The Claude desktop app does not sign in the Claude CLI.** Even if you use
> Claude Code every day in the app, the standalone `claude` command this tool
> shells out to has its **own** login. Verified: with the desktop app running and
> signed in, a CLI call still returned *"Not logged in · Please run /login"*.
> So everyone needs to do this once, separately:
>
> ```
> claude
> ```
> then type `/login` at the prompt and follow the browser. The Connections panel
> checks this for real now — a signed-out CLI shows **red**, not green. The check
> is free: a logged-out call fails in ~120ms at $0, and a genuine call is killed
> before it bills.

If the panel says the CLI is installed but nothing works, the grey line under the
banner shows the exact binary path it found — useful when there are two copies.

> **This tool never asks for a password, API key or token.** There is no field
> anywhere that takes one. Sign-in is handled entirely by each vendor's own CLI
> in its own browser flow, and your session file stays in your home directory.
> Credits are billed to whichever Higgsfield account *you* signed into.

## 3. Everyone runs their own

Five people = five copies, five machines, five accounts. Nothing is shared and
nothing talks to anyone else's copy: all state lives in `state.json` next to the
server, on your own machine.

If two of you ever share one machine, give the second copy its own port:

```
Windows :  set TRIWALL_PORT=8935 && run.bat
mac/Linux: TRIWALL_PORT=8935 ./run.sh
```

## 4. The short version of how to use it

1. **Connections** — all green.
2. **Reference images** — drop a centre image, or generate one, then
   *Generate left & right*. Approve what you like.
3. **Decode a reference** *(optional)* — drop a client clip and it measures the
   camera move for you: push, turn in degrees per second, symmetry, and any
   element that crosses the walls. *Apply to rig* adopts it.
4. **Camera rig** — pick what the physical camera does **once**. All three walls'
   locked rules are derived from it. Add a travelling element if you want
   something to fly across all three.
5. **Video generation** — *Generate prompt from image* per wall, review, Generate.
6. **Fix left/right mismatch** — if one side ended up faster than the other.
7. **Self-calibration** — *Measure set* after a finished set. Every 10 measured
   generations it re-derives its own correction numbers.

## 5. If something breaks

```
npm run doctor
```

Prints the same checks as the Connections panel, in the terminal.

| Symptom | Cause |
|---|---|
| Model dropdowns empty | Higgsfield not installed, signed out, **or no billing workspace picked** — see Connections |
| "No workspace selected" | Pick a billing workspace in Connections. Required even when signed in |
| "Generate prompt" fails | Claude CLI not signed in — run `claude` then `/login` (the desktop app does NOT cover this) |
| Decode / Measure greyed out | Python or numpy/opencv missing (optional feature) |
| Port already in use | Another copy is running, or set `TRIWALL_PORT` |
| A 4K video says "still rendering" | Normal. 4K takes 20–50 min; it keeps polling and updates itself |

**Costs are real.** 4K video ≈ 110 credits per wall, 720p ≈ 22.5, images ≈ 6.5.
Iterate at 720p, commit to 4K once.

## 6. What's in the box

```
run.bat / run.sh     launchers — start here
server.js            local server; drives both CLIs
index.html           the console UI
rig.js               camera rig model — one intent derives all three walls
motion_probe.py      reference decoding (optical flow)
learning.js          version history + self-calibration
preflight.js         the Connections checks
connect.js           finds/installs the Higgsfield CLI, workspaces
assets/              brand mark  (placeholder — drop the official SVG here)
README.md            technical notes, measurements, API
SKILL.md             the reasoning trail behind the locked prompt wording
```

Nothing writes outside this folder except the vendor CLIs' own session files.
