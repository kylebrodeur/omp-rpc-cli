---
name: using-omp-rpc
description: Use when you need to run, operate, or troubleshoot the omp-rpc daemon — starting a persistent omp (oh-my-pi) RPC session, sending it tasks, switching its model live, steering or aborting a running turn, picking an Ollama Cloud model, reading its logs, or stopping and cleaning it up.
---

# Using omp-rpc

## Overview

`omp-rpc` keeps **one long-running [Oh My Pi](https://github.com/) (`omp`) session**
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
| `omp-rpc start [-m glm\|kimi\|deepseek\|gemma] [-c <cwd>]` | boot the daemon |
| `omp-rpc send "task"` | send a task; streams reply; remembers prior turns |
| `omp-rpc send --quiet "task"` | reply only (thoughts/tools to stderr suppressed) |
| `omp-rpc send --json "task"` | print raw `{stopReason, usage}` |
| `omp-rpc model kimi` | **switch the model live** (no restart needed) |
| `omp-rpc steer "..."` | inject a message into the turn currently running |
| `omp-rpc abort` | interrupt the running turn |
| `omp-rpc status` | pid, model, session id, turn count, **busy?** |
| `omp-rpc logs -n 60` | tail the daemon log |
| `omp-rpc stop [-y] [--force]` | close session + clean up (see Safety) |
| `omp-rpc models` | list model aliases |

Full flag detail: [references/commands.md](references/commands.md).

## Core workflow

```sh
omp-rpc start --model glm --cwd ~/repo   # once
omp-rpc send "Summarize what this repo does"
omp-rpc send "Now add a health check to server.js"   # builds on the last turn
omp-rpc model kimi                        # switch model live, keeps the session
omp-rpc stop                              # when done
```

- Prereqs: `omp` on PATH, Node ≥ 20, and the target model authenticated in `omp`.
- `send` reads stdin when given no args: `echo "review the diff" | omp-rpc send`.
- Only one task runs at a time; a second `send` while busy returns a busy error
  (use `omp-rpc steer` to add to the running turn instead).

## Models

Aliases map to Ollama Cloud ids; default is `glm` (glm-5.2, 1M context). Any raw
omp selector also works (`omp-rpc model anthropic/claude-opus-4-8`). Unlike the
old ACP transport, the model **can** change mid-session — `omp-rpc model <x>`
uses RPC `set_model` on the live session. See [references/models.md](references/models.md).

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
