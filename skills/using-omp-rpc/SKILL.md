---
name: using-omp-rpc
description: Use when you need to run, operate, or troubleshoot the omp-rpc daemon — starting a persistent omp (oh-my-pi) RPC session, sending it tasks, switching its model live, steering or aborting a running turn, picking an Ollama Cloud model, reading its logs, or stopping and cleaning it up.
---

# Using omp-rpc

## Overview

`omp-rpc` keeps **one long-running [Oh My Pi](https://omp.sh) (`omp`) session**
open and lets you send it tasks from the shell. A background **daemon** holds an
omp [RPC](https://omp.sh/docs/rpc) session (newline-delimited JSON over stdio);
a thin **`send`** command forwards each task over a Unix socket and streams the
reply. Because it's one session, **context accumulates across tasks**.

```
omp-rpc send ──unix socket──▶ daemon ──stdio (omp RPC, JSON lines)──▶ omp --mode rpc-ui
```

## When to use

- You want a persistent second agent to hand work to (see the
  `delegating-to-omp-rpc` skill for that workflow).
- You need to start/stop/inspect that session, switch its model live, or steer
  a running turn.

**Not for:** one-shot prompts with no follow-up — just run `omp -p "..."` (or
`omp --mode json "..."` for a machine-readable event stream).

## Quick reference

| Command | Purpose |
|---|---|
| `omp-rpc models [pattern] [--json]` | **browse the live model catalog** (source of selectors) |
| `omp-rpc start --models "<sel>,<sel>" --model <sel> -c <cwd>` | boot the daemon, scoped to a model set |
| `omp-rpc start --preset <name>` | boot from a saved scope preset |
| `omp-rpc send "task"` | send a task; streams reply; remembers prior turns |
| `omp-rpc send --quiet "task"` | reply only (thoughts/tools to stderr suppressed) |
| `omp-rpc send --json "task"` | print raw `{stopReason, usage}` |
| `omp-rpc model <sel>` | **switch the model live** within scope (no restart) |
| `omp-rpc steer "..."` | inject a message into the turn currently running |
| `omp-rpc abort` | interrupt the running turn |
| `omp-rpc status` | pid, model, scope, session id, turn count, **busy?** |
| `omp-rpc logs -n 60` | tail the daemon log |
| `omp-rpc stop [-y] [--force]` | close session + clean up (see Safety) |
| `omp-rpc pick` / `omp-rpc presets` | interactive scope picker / manage presets (human) |

Full flag detail: [references/commands.md](references/commands.md).

## Choosing models — never guess selectors

There are **no hardcoded aliases**. Model selectors come from omp's live catalog,
which changes as models are added — so **do not recall selectors from memory**.
Discover them first:

```sh
omp-rpc models --json          # machine-readable: [{provider,id,selector,name,contextWindow}]
omp-rpc models kimi            # human-readable, filtered by substring
```

Then pass **exact selectors** copied from that output. A selector is
`provider/id` (e.g. `ollama/glm-5.2:cloud`). Ambiguous or partial names
(`glm`) are **rejected** with a candidate list — pick an exact one. Humans can
instead run `omp-rpc pick` for an interactive multi-select.

## Core workflow

```sh
omp-rpc models --json                                  # discover exact selectors
omp-rpc start --models "ollama/glm-5.2:cloud,ollama/kimi-k2.7-code:cloud" \
              --model ollama/glm-5.2:cloud --cwd ~/repo  # scope + active
omp-rpc send "Summarize what this repo does"
omp-rpc send "Now add a health check to server.js"     # builds on the last turn
omp-rpc model ollama/kimi-k2.7-code:cloud              # switch live (must be in scope)
omp-rpc stop                                           # when done
```

- Prereqs: `omp` on PATH, Node ≥ 20, and the target model authenticated in `omp`.
- `send` reads stdin when given no args: `echo "review the diff" | omp-rpc send`.
- Only one task runs at a time; a second `send` while busy returns a busy error
  (use `omp-rpc steer` to add to the running turn instead).

## Models & scope

A session runs with a **scope** — the set of selectors passed to `--models` (or a
preset). `omp-rpc model <sel>` can switch live, but only to a model **in that
scope**; anything else is rejected with the allowed list. Start with just
`--model <sel>` (no `--models`) to lock the session to one model. Omit both on a
non-interactive start to run on omp's own default, unscoped. The model **can**
change mid-session (RPC `set_model`), unlike the old ACP transport. See
[references/models.md](references/models.md).

## Safety

The daemon auto-approves tool use, with two guardrails: a **dangerous-command
guard** that denies destructive shell commands, and a **safe stop** that refuses
mid-task teardown and never touches the working directory. See
[references/safety.md](references/safety.md).

## Common mistakes

- **`stop` "hangs" in a script.** It doesn't — with no TTY it auto-confirms. If a
  task is running it *refuses*; add `--force` to override.
- **Model not authenticated.** `start` comes up but `send` errors from omp. Verify
  with `omp models list` / `omp usage`.
- **Steering when idle.** `steer` only works while a turn is running; otherwise
  use `send`.
- **Runtime dir.** State lives in `~/.omp-rpc/`; override with `OMP_RPC_DIR`.

## Internals / extending

Socket wire protocol, omp RPC message shapes, and file layout:
[references/architecture.md](references/architecture.md).
