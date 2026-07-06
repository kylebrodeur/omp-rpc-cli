# omp-rpc

A **long-running [Oh My Pi](https://github.com/) (`omp`) session** you can send
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

## Install

```sh
npm  install -g omp-rpc-cli     # or: pnpm add -g omp-rpc-cli
```

This puts `omp-rpc` on your PATH. Requires `omp` on your PATH and Node ≥ 20.

## Use

```sh
omp-rpc start                       # boot the daemon (default model: glm, 1M ctx)
omp-rpc start --model kimi          # coding-tuned kimi-k2.7-code
omp-rpc start --cwd ~/repo

omp-rpc send "Summarize what this repo does"
omp-rpc send "Now add a health check to server.js"   # remembers the last turn
echo "review the diff" | omp-rpc send                # reads stdin
omp-rpc send --quiet "..."          # reply only (no thoughts/tools on stderr)
omp-rpc send --json  "..."          # raw {stopReason, usage}

omp-rpc model kimi                  # switch the model live — no restart
omp-rpc steer "skip the tests dir"  # inject into the turn currently running
omp-rpc abort                       # interrupt the running turn

omp-rpc status                      # pid, model, session id, turn count, busy?
omp-rpc logs -n 60                  # daemon log
omp-rpc stop                        # close session + clean up (see Safety)
omp-rpc stop --force                # stop even mid-task; -y skips the prompt
omp-rpc models                      # built-in aliases
```

### Model aliases

| alias | omp selector | context |
|-------|--------------|---------|
| `glm` (default) | `ollama/glm-5.2:cloud` | 1,000,000 |
| `kimi` | `ollama/kimi-k2.7-code:cloud` | 262,144 |
| `deepseek` | `ollama/deepseek-v4-pro:cloud` | 524,288 |
| `gemma` | `ollama/gemma4:31b-cloud` | 262,144 |

Any raw omp selector also works: `--model anthropic/claude-opus-4-8`, or live via
`omp-rpc model anthropic/claude-opus-4-8`. Confirm exact ids with
`omp models list --json` (the `selector` field). omp also exposes the same models
under an `ollama-cloud/<id>` provider; either works if authenticated.

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
  agent is told no; everything else is approved. It's a blast-radius net, not a
  sandbox — tune the patterns to taste.
- **Safe stop / cleanup.** `omp-rpc stop` refuses to tear down a session that's
  **mid-task** (use `--force` to override), lists exactly which runtime files it
  will remove, and **never touches the session's working directory** or anything
  the agent created there. It only deletes `daemon.sock`/`daemon.pid`/
  `daemon.json`; the log is kept. In a terminal it asks to confirm; when scripted
  (no TTY) or with `-y` it proceeds without prompting.

## Files

- `src/client.js` — reusable `RpcClient` (importable omp-RPC-over-stdio client).
- `src/daemon.js` — holds the session, serves tasks over the socket.
- `bin/omp-rpc.js` — the CLI.
- `src/danger.js` — dangerous-command guard patterns.

## Skills for driving agents

This repo ships two [agent skills](https://github.com/vercel-labs/skills) that
teach a driving agent (Claude Code, etc.) how to use `omp-rpc`. Install them
straight from the repo with the `skills` CLI:

```sh
npx skills add kylebrodeur/omp-rpc-cli          # both skills (add -g for user-global)
```

- **`using-omp-rpc`** — operate the daemon: commands, models, safety, architecture
  (with reference files).
- **`delegating-to-omp-rpc`** — the pattern for handing tasks to it as a
  persistent second agent.

Design/protocol findings from building it: [`docs/LEARNINGS.md`](docs/LEARNINGS.md).
