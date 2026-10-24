#!/usr/bin/env bash
# A runnable example session: start a scoped session, delegate two turns
# that build on each other, inspect status, stop.
#
# Run from this repo's root:
#
#   examples/session.sh
#
# Needs: node >= 20, an installed + authenticated `omp`, and ONE exact
# model selector (the script discovers candidates if you export none).
# State lands under examples/.omp-rpc/ (kept out of git), so the example
# never touches your real ~/.omp-rpc.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
run_cli() { node "$REPO_ROOT/bin/omp-rpc.js" "$@"; }
RUNTIME="$REPO_ROOT/examples/.omp-rpc"
WORK="$REPO_ROOT/examples/workspace"

export OMP_RPC_DIR="$RUNTIME"

echo "==> cleanup any previous example run"
run_cli stop -y >/dev/null 2>&1 || true
rm -rf "$RUNTIME" "$WORK"
mkdir -p "$WORK"

echo "==> seed a tiny repo to delegate against"
cat > "$WORK/hello.js" <<'EOF'
const greeting = "Hello, omp-rpc world";

console.log(greeting);
EOF

echo "==> discover selectors (agent path: copy exact ones)"
run_cli models glm || true

SELECTOR="${OMP_RPC_EXAMPLE_MODEL:-}"
if [ -z "$SELECTOR" ]; then
  echo "!! export OMP_RPC_EXAMPLE_MODEL=<exact selector> to run the live turns;"
  echo "   e.g. OMP_RPC_EXAMPLE_MODEL='ollama/glm-5.2:cloud' examples/session.sh"
  echo "==> (stopping after discovery; discovery itself already ran)"
  exit 0
fi

echo "==> start a session scoped to: $SELECTOR"
run_cli start --models "$SELECTOR" --model "$SELECTOR" --cwd "$WORK"

echo "==> status"
run_cli status

echo "==> turn 1: run the file, then extend it"
run_cli send "Run \"node hello.js\" in this directory. Then, without changing what it already prints, rewrite hello.js so it also prints how many characters the greeting has."

echo "==> turn 2: build on the session's memory"
run_cli send "Now add a comment line at the top of hello.js saying what the script is. Keep the printed output identical."

echo "==> result (hello.js now):"
sed -n '1,8p' "$WORK/hello.js"

echo "==> daemon log (last 10 lines)"
run_cli logs -n 10

echo "==> stop"
run_cli stop -y
echo "done. The session's runtime files are gone; the workspace it edited (examples/workspace) stays so you can inspect it."