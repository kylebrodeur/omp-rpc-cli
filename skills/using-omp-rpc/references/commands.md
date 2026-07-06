# omp-rpc — command reference

All commands operate on a single daemon whose runtime files live in `~/.omp-rpc/`
(override with the `OMP_RPC_DIR` env var).

## `start`

Boot the background daemon holding one omp RPC session open. Fails if one is
already running (`omp-rpc stop` first). Clears stale files from a crashed daemon.

| Flag | Default | Notes |
|---|---|---|
| `-m, --model <model>` | `glm` | alias (`gemma`/`kimi`/`deepseek`/`glm`) or any raw omp selector |
| `-c, --cwd <dir>` | current dir | working directory the omp session operates in |

The daemon launches `omp --mode rpc-ui --approval-mode write --model <selector>
--cwd <dir>` and waits for omp's `{"type":"ready"}` frame, then for the socket +
a status reply before printing the session summary. The model is **not** pinned —
switch it live with `omp-rpc model` (below).

## `send [task...]`

Forward a task to the running session and stream the reply to stdout. Session
context persists across calls. Reads the task from **stdin** if no args are given.

| Flag | Effect |
|---|---|
| `-q, --quiet` | suppress streamed thoughts + tool events (stderr); print only the reply text |
| `--json` | after the reply, print the raw `done` event (`{stopReason, usage}`) as JSON |

- Thoughts and tool-call events stream to **stderr** (dimmed); the answer streams
  to **stdout** — so `omp-rpc send -q "..." > out.txt` captures just the answer.
- Only one task runs at a time. A `send` while the session is busy returns
  `{type:"error"}` ("session busy") rather than queueing — use `steer` to add to
  the running turn.

## `model <model>`

Switch the live session's model via RPC `set_model`. Accepts an alias or a raw
omp selector (`provider/id`, split on the first `/`). The accumulated session
context is preserved across the switch.

```sh
omp-rpc model kimi
omp-rpc model anthropic/claude-opus-4-8
```

## `steer <text...>`

Inject a message into the turn **currently running** (RPC `steer`). Errors if no
turn is in progress. Use it to redirect a turn without cancelling it.

## `abort`

Interrupt the running turn (RPC `abort`). The turn ends with its normal
`agent_end`; the session stays open.

## `status`

Print the live session's pid, model, cwd, session id, turn count, `busy`
flag, and start time. Prints `● stopped` when no daemon is running.

## `stop`

Tear down the omp child, stop the daemon, and remove the runtime files
(`daemon.sock`, `daemon.pid`, `daemon.json`). The log is kept.

| Flag | Effect |
|---|---|
| `-y, --yes` | skip the confirmation prompt |
| `-f, --force` | stop even if a task is currently running (interrupts it) |

Refuses to stop a **busy** session unless `--force`. In a TTY it lists what will
be deleted and asks to confirm; with no TTY (scripted) or `-y` it proceeds.

## `logs`

Print the daemon log. `-n, --lines <n>` tails the last N lines (default 40).

## `models`

List the built-in aliases and their omp selectors. For the full catalogue run
`omp models list` (or the RPC `get_available_models` command).
