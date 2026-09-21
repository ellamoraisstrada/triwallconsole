#!/usr/bin/env bash
# ===================================================================
#  Tri-Wall Console — macOS / Linux launcher
#  Run:  ./run.sh     (first time:  chmod +x run.sh)
#  Installs what's missing on first run, then starts the console.
#  Nothing here asks for a password, key or token.
# ===================================================================
set -u
cd "$(dirname "$0")"

echo
echo "  TRI-WALL CONSOLE"
echo "  ================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  [X] Node.js is not installed."
  echo "      macOS:  brew install node        Linux: use your package manager"
  echo "      or get the LTS build from https://nodejs.org"
  exit 1
fi
echo "  [ok] Node $(node --version)"

if [ ! -d node_modules/cross-spawn ]; then
  echo "  [..] First run - installing the one npm dependency..."
  if ! npm install --no-audit --no-fund >/dev/null 2>&1; then
    echo "  [X] npm install failed. Run 'npm install' here and read the error."
    exit 1
  fi
fi
echo "  [ok] Dependencies"

PY=""
for c in python3 python; do command -v "$c" >/dev/null 2>&1 && { PY="$c"; break; }; done
if [ -n "$PY" ]; then
  if ! "$PY" -c "import numpy,cv2" >/dev/null 2>&1; then
    echo "  [..] Installing numpy + opencv for reference decoding (optional, one time)..."
    "$PY" -m pip install --quiet numpy opencv-python-headless >/dev/null 2>&1 || true
  fi
  if "$PY" -c "import numpy,cv2" >/dev/null 2>&1; then
    echo "  [ok] Reference decoding ready"
    export TRIWALL_PYTHON="$(command -v "$PY")"
  else
    echo "  [--] Decoding unavailable - install numpy/opencv later if you want it."
  fi
else
  echo "  [--] Python not found - reference decoding and self-calibration are disabled."
  echo "       Everything else works. Install Python 3.10+ to enable them."
fi

PORT="${TRIWALL_PORT:-8934}"
export TRIWALL_PORT="$PORT"

echo
echo "  Starting on http://localhost:$PORT"
echo "  The Connections panel at the top will tell you if you still need to sign in."
echo "  Leave this terminal open. Ctrl-C to stop."
echo

( sleep 2; (command -v open >/dev/null && open "http://localhost:$PORT") \
  || (command -v xdg-open >/dev/null && xdg-open "http://localhost:$PORT") ) >/dev/null 2>&1 &

node server.js
