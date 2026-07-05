---
name: using-pi-acp
description: Use when you need to run, operate, or troubleshoot the pi-acp daemon — starting a persistent omp (oh-my-pi) ACP session, sending it tasks, picking an Ollama Cloud model, switching plan mode, reading its logs, or stopping and cleaning it up.
---

# Using pi-acp

## Overview

`pi-acp` keeps **one long-running [Oh My Pi](https://github.com/) (`omp`) session**
open and lets you send it tasks from the shell. A background **daemon** holds the
[ACP](https://agentclientprotocol.com) session (JSON-RPC over stdio); a thin
**`send`** command forwards each task over a Unix socket and streams the reply.
Because it's one session, **context accumulates across tasks**.

```
pi-acp send ──unix socket──▶ daemon ──stdio (ACP JSON-RPC)──▶ omp acp
```

## When to use

- You want a persistent second agent to hand work to (see the
  `delegating-to-pi-acp` skill for that workflow).
- You need to start/stop/inspect that session or change its model or mode.

**Not for:** one-shot prompts with no follow-up — just run `omp -p "..."`.

## Quick reference

| Command | Purpose |
|---|---|
| `pi-acp start [-m glm\|kimi\|deepseek\|gemma] [-c <cwd>] [--mode default\|plan]` | boot the daemon; **model is fixed for the session's life** |
| `pi-acp send "task"` | send a task; streams reply; remembers prior turns |
| `pi-acp send --quiet "task"` | reply only (thoughts/tools to stderr suppressed) |
| `pi-acp send --json "task"` | print raw `{stopReason, usage}` |
| `pi-acp status` | pid, model, session id, turn count, **busy?** |
| `pi-acp mode plan` \| `pi-acp mode default` | toggle plan mode on the live session |
| `pi-acp logs -n 60` | tail the daemon log |
| `pi-acp stop [-y] [--force]` | close session + clean up (see Safety) |
| `pi-acp models` | list model aliases |

Full flag detail: [references/commands.md](references/commands.md).

## Core workflow

```sh
pi-acp start --model glm --cwd ~/repo   # once
pi-acp send "Summarize what this repo does"
pi-acp send "Now add a health check to server.js"   # builds on the last turn
pi-acp stop                              # when done
```

- Prereqs: `omp` on PATH, Node ≥ 20, and the target model authenticated in `omp`.
- `send` reads stdin when given no args: `echo "review the diff" | pi-acp send`.
- Only one task runs at a time; a second `send` while busy returns a busy error.

## Models

Aliases map to Ollama Cloud ids; default is `glm` (glm-5.2, 1M context). Any raw
omp id also works (`--model anthropic/claude-opus-4-8`). Model **cannot** change
mid-session — restart to switch. See [references/models.md](references/models.md).

## Safety

The daemon auto-approves tool use, with two guardrails: a **dangerous-command
guard** that rejects destructive shell commands, and a **safe stop** that refuses
mid-task teardown and never touches the working directory. See
[references/safety.md](references/safety.md).

## Common mistakes

- **Expecting `--model` to change a running session.** It only applies at
  `start`; omp has no `session/set_model`. Restart to switch models.
- **`stop` "hangs" in a script.** It doesn't — with no TTY it auto-confirms. If a
  task is running it *refuses*; add `--force` to override.
- **Model not authenticated.** `start` comes up but `send` errors from omp. Verify
  with `omp models list` / `omp usage`.
- **Runtime dir.** State lives in `~/.pi-acp/`; override with `PI_ACP_DIR`.

## Internals / extending

Socket wire protocol, ACP message shapes, and file layout:
[references/architecture.md](references/architecture.md).
