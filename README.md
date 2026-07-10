# omp-rpc

A **long-running [Oh My Pi](https://omp.sh) (`omp`) session** you can send
tasks to from the shell — a persistent second coding agent that a driver (you, or
Claude Code) can delegate work to and check back on.

`omp --mode rpc` speaks omp's native [RPC protocol](https://omp.sh/docs/rpc)
(newline-delimited JSON over stdio). `omp-rpc` is the client: a small **daemon**
keeps one RPC session open, and a thin **`send`** command forwards tasks over a
Unix socket and streams the reply back. Because it's one session, **context
accumulates across tasks** — you can build on earlier work.

> Previously `pi-acp`, built on the generic Agent Client Protocol. It moved to
> omp's native RPC because RPC is a superset for driving omp — most importantly it
> allows **switching models live**, which ACP could not. See
> [`docs/LEARNINGS.md`](docs/LEARNINGS.md).

## Using with Claude Code

First make sure [`omp`](https://omp.sh/docs) is installed and authenticated (its
docs cover setup). Then:

1. **Install the CLI** — puts `omp-rpc` on your PATH (needs Node ≥ 20):

   ```sh
   npm install -g omp-rpc-cli     # or: pnpm add -g omp-rpc-cli
   ```

2. **Add the skills to Claude Code** — teaches it how to drive `omp-rpc`:

   ```sh
   npx skills add kylebrodeur/omp-rpc-cli -g
   ```

   - **`delegating-to-omp-rpc`** — when and how to hand work off to it.
   - **`using-omp-rpc`** — the daemon mechanics (commands, models, safety).

Now just ask Claude Code in plain language, e.g.:

> *"Start an omp-rpc session on this repo and delegate writing the migration
> script to it, then review what it produced."*

Claude handles the `start` / `send` / `stop` lifecycle via the skills. You can
also drive it yourself with the CLI:

## Use

```sh
omp-rpc models                      # browse the live catalog (source of selectors)
omp-rpc models --json               # machine-readable (the agent path)
omp-rpc pick                        # interactive multi-select → start / save / print

omp-rpc start --models "ollama/glm-5.2:cloud,ollama/kimi-k2.7-code:cloud" \
              --model ollama/glm-5.2:cloud --cwd ~/repo   # scope + active model
omp-rpc start --preset coding       # boot from a saved preset

omp-rpc send "Summarize what this repo does"
omp-rpc send "Now add a health check to server.js"   # remembers the last turn
echo "review the diff" | omp-rpc send                # reads stdin
omp-rpc send --quiet "..."          # reply only (no thoughts/tools on stderr)
omp-rpc send --json  "..."          # raw {stopReason, usage}

omp-rpc model ollama/kimi-k2.7-code:cloud  # switch live — within scope, no restart
omp-rpc steer "skip the tests dir"  # inject into the turn currently running
omp-rpc abort                       # interrupt the running turn

omp-rpc status                      # pid, model, scope, session id, turns, busy?
omp-rpc logs -n 60                  # daemon log
omp-rpc stop                        # close session + clean up (see Safety)
omp-rpc stop --force                # stop even mid-task; -y skips the prompt
omp-rpc presets                     # list saved presets (`presets rm <name>` deletes)
```

### Choosing models — no hardcoded aliases

Selectors come from **omp's live catalog**, not a baked-in alias table, so
newly-added models are always available and nothing goes stale. Discover them,
then pass exact selectors:

```sh
omp-rpc models --json     # [{provider,id,selector,name,contextWindow}] — copy `selector`
omp-rpc models glm        # human-readable, filtered by substring
```

A **selector** is `provider/id` (e.g. `ollama/glm-5.2:cloud`,
`anthropic/claude-opus-4-8`). A partial/ambiguous name like `glm` is **rejected**
with a candidate list — pick an exact one, or run `omp-rpc pick` for an
interactive multi-select. `--models` scopes the session to a set; `--model`
chooses which is active; `omp-rpc model <sel>` switches live but only within that
scope. Save a chosen scope with a preset (`omp-rpc pick --save <name>`) and reuse
it via `omp-rpc start --preset <name>`.

## How it works

```
omp-rpc send ──unix socket──▶ daemon ──stdio (omp RPC, JSON lines)──▶ omp --mode rpc-ui
  (streams chunks back)        (holds one session open)               (the agent)
```

- **Model is live** — `omp-rpc model <x>` issues RPC `set_model` on the open
  session, keeping the accumulated context.
- **Turns are steerable** — `steer` injects into a running turn, `abort` cancels
  it, without tearing down the session.
- **Permissions auto-approve** so the session runs unattended (headless) —
  *except* commands the danger guard flags (see Safety). The daemon runs omp as
  `--mode rpc-ui --approval-mode write` precisely so the guard has a veto point.
- Runtime state lives in `~/.omp-rpc/` (`daemon.sock`, `daemon.pid`,
  `daemon.json`, `daemon.log`); override with `OMP_RPC_DIR` (keep it short — see
  the socket-path note in the architecture reference).

## Safety

Because the daemon approves tool use unattended, two guardrails apply:

- **Dangerous-command guard** (`src/danger.js`). Each mutating tool surfaces an
  approval `select` under `rpc-ui`; before answering "Approve", the command is
  matched against destructive patterns — recursive force-`rm` of root/home/cwd,
  `mkfs`, `dd` to a raw disk, `shred`/`wipe`, fork bombs, `curl|wget … | sh`,
  recursive `chmod`/`chown` on `/`, `shutdown`/`reboot`, destructive
  `git clean/reset`. A match is answered **"Deny"** (logged as `BLOCKED …`) and the
  agent is told no; safe shell commands and non-shell tools (write/edit, scoped to
  `--cwd`) are approved. The guard reads the tool/command out of omp's
  human-readable approval title — the only channel `select` exposes — so it **fails
  closed**: any approval it can't fully parse (e.g. omp reworded the prompt) is
  denied and logged, never silently approved. It's a blast-radius net, not a
  sandbox — tune the patterns to taste.
- **Safe stop / cleanup.** `omp-rpc stop` refuses to tear down a session that's
  **mid-task** (use `--force` to override), lists exactly which runtime files it
  will remove, and **never touches the session's working directory** or anything
  the agent created there. It only deletes `daemon.sock`/`daemon.pid`/
  `daemon.json`; the log is kept. In a terminal it asks to confirm; when scripted
  (no TTY) or with `-y` it proceeds without prompting.

## Files

- `src/client.js` — reusable `RpcClient` (importable omp-RPC-over-stdio client).
- `src/daemon.js` — holds the session, serves tasks over the socket, enforces scope.
- `bin/omp-rpc.js` — the CLI.
- `src/models.js` — live catalog access + exact selector resolution.
- `src/presets.js` — named scope presets. `src/picker.js` — clack scope picker.
- `src/danger.js` — dangerous-command guard patterns.

## Skills & docs

The two [agent skills](https://github.com/vercel-labs/skills) that drive this tool
(`using-omp-rpc`, `delegating-to-omp-rpc`) install via `npx skills add
kylebrodeur/omp-rpc-cli` — see [Using with Claude Code](#using-with-claude-code).
Their source lives in [`skills/`](skills/).

Design/protocol findings from building it: [`docs/LEARNINGS.md`](docs/LEARNINGS.md).
