# pi-acp — command reference

All commands operate on a single daemon whose runtime files live in `~/.pi-acp/`
(override with the `PI_ACP_DIR` env var).

## `start`

Boot the background daemon holding one omp ACP session open. Fails if one is
already running (`pi-acp stop` first). Clears stale files from a crashed daemon.

| Flag | Default | Notes |
|---|---|---|
| `-m, --model <model>` | `glm` | alias (`gemma`/`kimi`/`deepseek`/`glm`) or any raw omp id |
| `-c, --cwd <dir>` | current dir | working directory the omp session operates in |
| `--mode <mode>` | `default` | `default` or `plan` (read-only planning) |

The model is pinned for the session's lifetime — omp's ACP has no
`session/set_model`. To change model, `stop` then `start` again.

Waits for the socket + a status reply before printing the session summary.

## `send [task...]`

Forward a task to the running session and stream the reply to stdout. Session
context persists across calls. Reads the task from **stdin** if no args are given.

| Flag | Effect |
|---|---|
| `-q, --quiet` | suppress streamed thoughts + tool events (stderr); print only the reply text |
| `--json` | after the reply, print the raw `done` event (`{stopReason, usage}`) as JSON |

- Thoughts and tool-call events stream to **stderr** (dimmed); the answer streams
  to **stdout** — so `pi-acp send -q "..." > out.txt` captures just the answer.
- Only one task runs at a time. A `send` while the session is busy returns
  `{type:"error"}` ("session busy") rather than queueing.

## `status`

Print the live session's pid, model, cwd, mode, session id, turn count, `busy`
flag, and start time. Prints `● stopped` when no daemon is running.

## `mode <mode>`

Switch the live session between `default` and `plan` via ACP `session/set_mode`.
Unlike model, mode **is** changeable on a running session.

## `stop`

Close the session cleanly (ACP `session/close`), stop the daemon, and remove the
runtime files (`daemon.sock`, `daemon.pid`, `daemon.json`). The log is kept.

| Flag | Effect |
|---|---|
| `-y, --yes` | skip the confirmation prompt |
| `-f, --force` | stop even if a task is currently running (interrupts it) |

Refuses to stop a **busy** session unless `--force`. In a TTY it lists what will
be deleted and asks to confirm; with no TTY (scripted) or `-y` it proceeds.

## `logs`

Print the daemon log. `-n, --lines <n>` tails the last N lines (default 40).

## `models`

List the built-in aliases and their omp ids. For the full catalogue run
`omp models list`.
