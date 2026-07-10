# omp-rpc — command reference

All commands operate on a single daemon whose runtime files live in `~/.omp-rpc/`
(override with the `OMP_RPC_DIR` env var).

## `start`

Boot the background daemon holding one omp RPC session open. Fails if one is
already running (`omp-rpc stop` first). Clears stale files from a crashed daemon.

| Flag | Default | Notes |
|---|---|---|
| `-m, --model <selector>` | first of `--models`, else omp default | active model — exact selector/id from `omp-rpc models` |
| `-M, --models <list>` | — | comma-separated exact selectors; scopes the session to this set |
| `-p, --preset <name>` | — | load scope + active from a saved preset |
| `-c, --cwd <dir>` | current dir | working directory the omp session operates in |

Scope precedence: explicit flags → `--preset` → interactive picker (on a TTY,
no flags) → omp's own default, unscoped (no TTY, no flags — so agents never hang).
The daemon launches `omp --mode rpc-ui --approval-mode write [--model <selector>]
[--models <list>] --cwd <dir>`, waits for omp's `{"type":"ready"}` frame, then for
the socket + a status reply before printing the summary. The model is **not**
pinned — switch it live within scope with `omp-rpc model` (below).

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

## `model [selector]`

Switch the live session's model via RPC `set_model`, **within the session's
scope**. The CLI resolves the argument to an exact selector against the catalog;
the daemon rejects anything outside the scope with the allowed list. With **no
argument** on a TTY, opens a picker limited to the scope. Session context is
preserved across the switch.

```sh
omp-rpc model ollama/kimi-k2.7-code:cloud   # exact selector, must be in scope
omp-rpc model                               # no arg on a TTY → pick from scope
```

## `steer <text...>`

Inject a message into the turn **currently running** (RPC `steer`). Errors if no
turn is in progress. Use it to redirect a turn without cancelling it.

## `abort`

Interrupt the running turn (RPC `abort`). The turn ends with its normal
`agent_end`; the session stays open.

## `status`

Print the live session's pid, model, **scope**, cwd, session id, turn count,
`busy` flag, and start time. Prints `● stopped` when no daemon is running.

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

## `models [pattern]`

Browse omp's live model catalog — the source of all selectors.

| Flag | Effect |
|---|---|
| `--json` | machine-readable array (the agent path — copy exact `selector`s) |
| `--refresh` | re-fetch omp's catalog first (picks up newly-added models) |

`pattern` filters by substring on selector/id/name. When a session is running,
in-scope models are marked.

## `pick`

Interactive multi-select (clack) to choose a scope from the catalog, then start
the daemon, `--print` the equivalent `start` command, or `--save <name>` it as a
preset. Requires a TTY.

## `presets [action] [name]`

`omp-rpc presets` lists saved presets; `omp-rpc presets rm <name>` deletes one.
Presets are stored in `~/.omp-rpc/presets.json`.
