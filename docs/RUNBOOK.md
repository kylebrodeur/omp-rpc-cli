<!-- STATUS: VERIFIED 2026-10-22 against bin/omp-rpc.js + src/*.js (14 node tests passing). Every error string below was captured from a live run or copied from the source; runtime-file behavior was exercised by starting and stopping real sessions. -->
# RUNBOOK.md: the operator's reference

The full command surface, the runtime files, every error string and its
fix, and the recovery procedures. Task-shaped guidance lives in
[how-to.md](how-to.md); the boundary rules live in
[../AGENTS.md](../AGENTS.md).

## The command surface

Exactly ten commands (`bin/omp-rpc.js`, commander), no more:

```
omp-rpc start   [--model <sel>] [--models <list>] [--preset <name>] [--cwd <dir>]
omp-rpc send    [task...]        [-q|--quiet] [--json]
omp-rpc steer   <text...>
omp-rpc abort
omp-rpc model   [selector]
omp-rpc status
omp-rpc stop    [-y|--yes] [-f|--force]
omp-rpc logs    [-n <lines>]
omp-rpc models  [pattern]        [--json] [--refresh]
omp-rpc pick                     [-c <dir>] [--save <name>] [--print]
omp-rpc presets [action] [name]  (action: rm)
```

`omp-rpc --version` prints the package version (0.3.0 today).

## How the pieces fit

```
omp-rpc send ──unix socket──▶ daemon ──stdio (omp RPC, JSON lines)──▶ omp --mode rpc-ui
  (streams chunks back)        (holds one session open)               (the agent)
```

- `start` spawns the daemon DETACHED (it survives the starting terminal)
  with the resolved scope in `OMP_RPC_MODELS` and the active model in
  `OMP_RPC_MODEL`, then polls for the socket and a status reply.
- Every other command opens the socket, writes one request, streams the
  reply, closes. There is no long-lived CLI process.
- The daemon holds one `RpcClient` (src/client.js) driving
  `omp --mode rpc-ui --approval-mode write`, whose approval prompts are
  answered by the danger guard (src/danger.js), not by a human.

## Start scope precedence

The first rule that applies wins:

1. `--models` and/or `--model` flags: every selector validated exactly
   against the live catalog (`findExact`).
2. `--preset <name>`: loads the saved `{ models, active }`.
3. On a TTY with no flags: the interactive picker runs.
4. No TTY and no flags: omp's own default model, unscoped. An agent
   caller never hangs on a TUI.

`--model` alone (no `--models`) locks the session to that one model:
the scope is exactly that selector, so a live switch has nowhere to go.

## The runtime files

`~/.omp-rpc/` by default; the `OMP_RPC_DIR` env var overrides the whole
directory (the five paths move together).

| File | Contents | Removed on stop |
|---|---|---|
| `daemon.sock` | Unix domain socket the CLI talks to | yes |
| `daemon.pid` | daemon pid (liveness checked via `kill(pid, 0)`) | yes |
| `daemon.json` | session metadata (pid, sessionId, model, scope, cwd, startedAt, turns) | yes |
| `daemon.log` | append-only daemon log | **no** (kept) |
| `presets.json` | saved scope presets | not a session file (preserved) |

> **Keep `OMP_RPC_DIR` short.** macOS caps AF_UNIX socket paths at
> ~104 bytes; a deep override directory makes `listen()` fail, and it
> surfaces as `EADDRINUSE`, not a length error. The default
> `~/.omp-rpc/daemon.sock` is well within the limit.

## The daemon wire protocol (for scripting the socket directly)

Newline-delimited JSON, both directions, one object per line.

Client to daemon:

```
{cmd:"prompt", text}
{cmd:"steer", text} | {cmd:"abort"}
{cmd:"model", selector}
{cmd:"status"}
{cmd:"stop"}
```

Daemon to client:

```
{type:"thought"|"chunk", text}     // streamed during a turn
{type:"tool", title, status}       // a tool event (approval result included)
{type:"done", stopReason, usage}   // turn finished
{type:"status", pid, model, model, scope, cwd, sessionId, turns, busy, startedAt}
{type:"error", message}
```

A `send` whose socket closes with no `done` and no `error` is a daemon
crash or an omp exit: the CLI dies with
`session closed before the turn completed` so a script never reads it
as success.

## Env vars

| Var | Meaning |
|---|---|
| `OMP_RPC_DIR` | runtime dir for the five files above (keep it short, see the socket note) |
| `OMP_RPC_MODEL` | active model handed to the daemon at start (set by the CLI, read by the daemon) |
| `OMP_RPC_MODELS` | comma-separated scope handed to the daemon at start (set by the CLI, read by the daemon) |
| `OMP_RPC_CWD` | working directory handed to the daemon at start (set by the CLI, read by the daemon) |

The last three are internal plumbing: set them by using the `start`
flags, not by exporting them.

## Error strings and their fixes

Every error below exits code 1 with the exact string the CLI emits.
Find your message, apply its fix.

### Connection and lifecycle

| Error string | Cause and fix |
|---|---|
| `not running. Start it with: omp-rpc start` | no live daemon for this runtime dir. Fix: `omp-rpc start ...` (or, from a checkout, you typed the bare `node bin/omp-rpc.js` from the wrong cwd: run it from the repo root). |
| `not running.` (`steer`, `abort`, `model`) | same state, terse variant those commands print. Fix: start first. |
| `already running (pid <pid>). Use 'omp-rpc stop' first.` | a live daemon holds the runtime files. Fix: `omp-rpc stop` before a new `start`. |
| `✗ daemon did not come up in time, check logs (omp-rpc logs)` | the daemon failed during boot (omp not on PATH, omp exited, socket never appeared). Fix: `omp-rpc logs`, resolve the cause (most often: install/authenticate omp), `stop` to clear stale files, start again. |
| `✗ session closed before the turn completed, check omp-rpc logs` | the socket closed mid-turn: the daemon or omp died. Fix: read the log, then `stop -y` (clears state) and start again. The turn's work is lost; the session's committed file edits in `--cwd` are not. |
| `● stopped` (from `status`) | not an error: nothing is running under this runtime dir. |

### Start and scope

| Error string | Cause and fix |
|---|---|
| `✗ no exact model match for "<input>". Candidates: ...` | the flag value was not an exact selector or a unique id. Fix: copy one exact `provider/id` selector from the candidate list (sorted by context window) or from `omp-rpc models --json`. |
| `✗ --model <sel> is not in --models scope: ...` | `--model` named a model outside the `--models` set. Fix: add it to `--models` or pass an in-scope `--model`. |
| `✗ no preset named "<name>". List them: omp-rpc presets` | the preset does not exist (or lives under a different `OMP_RPC_DIR`). Fix: check `omp-rpc presets`, or save it first with `omp-rpc pick --save <name>`. |
| `✗ "pick" needs a terminal. Non-interactive? Use "omp-rpc models --json" + "omp-rpc start --models".` | `pick` is the human TUI and refuses to run headless. Fix: the non-interactive path quoted in the message. |

### Send and steering

| Error string | Cause and fix |
|---|---|
| `✗ session busy with another task; try again shortly (or use "omp-rpc steer")` | the session runs one task at a time. Fix: wait for the turn to finish (`omp-rpc status` shows `busy`), or inject with `steer`, or `abort` and send anew. |
| `no task given. Usage: omp-rpc send "your task"` | an empty send: no args and stdin had nothing (a TTY with no args hits this too). Fix: pass the task text or pipe it in. |
| `✗ no turn in progress to steer into` | `steer` only reaches a RUNNING turn. Fix: use `send` for a new task; steer only while `busy: true`. |

### Model switching

| Error string | Cause and fix |
|---|---|
| `✗ "<sel>" is not in this session's scope: ...` (from `model`) | the selector is real but outside the scope set at start. Fix: pick from the allowed list the error prints, or restart with a wider `--models`. |
| `no model given. Usage: omp-rpc model <selector>  (or run on a TTY to pick)` | `model` with no argument and no TTY. Fix: pass the selector; the TTY picker is the interactive alternative. |

### Stop

| Error string | Cause and fix |
|---|---|
| `✗ session is busy running a task (turn <n>). Wait for it to finish, or use: omp-rpc stop --force` | the refusal to discard in-flight work. Fix: wait, or accept the interruption with `--force`. |
| `aborted, session left running` | you answered no at the confirmation prompt: not an error, nothing was changed. |
| `already stopped` | a `stop` on a stopped session: idempotent, it also clears stale runtime files. |

### Model/catalog layer

| Error string | Cause and fix |
|---|---|
| `no models matched (try "omp-rpc models" to browse)` (inside a candidates message) | the substring matched nothing at all. Fix: run plain `omp-rpc models` (or `omp models list --json`) and re-check the spelling. |
| omp spawn failures from `models` (`execFile ENOENT`) | `omp` is not on PATH. Fix: install omp or fix your PATH, then retry; `--refresh` needs omp too. |

### The danger guard (not an error string, a log one)

A denied command logs to `daemon.log` in this shape:

```
BLOCKED dangerous command (recursive force rm): rm -rf / -> Deny
```

The agent inside the session sees a denial ("The tool-use request was
denied by the user..."). If a legitimate command is being denied, check
which pattern matched (src/danger.js `PATTERNS`), reword the command to
drop the destructive shape, or tune the patterns in your checkout.

## Recovery procedures

### A task is stuck (turn never ends)

1. `omp-rpc status`: confirm `busy: true` and note the turn number.
2. `omp-rpc steer "wrap up now and summarize what you did"`: gives the
   model a nudge it absorbs this turn; wait briefly.
3. Still stuck: `omp-rpc abort` (cancels the turn, session stays).
4. Session itself wedged: `omp-rpc stop --force -y`, then start again.
   The runtime files are recreated; the log survives for the post
   mortem.

### The daemon is dead but the files remain

Symptom: `status` says stopped, but another tool claims the socket is
there. Nothing to fix: `cleanStaleFiles()` removes leftover
`daemon.sock`/`daemon.pid`/`daemon.json` at the next `start`, and `stop`
clears them too. A stale file set never blocks a fresh start.

### The socket path is too long (EADDRINUSE at start)

Symptom: start fails under a custom `OMP_RPC_DIR` whose
`.omp-rpc/daemon.sock` path is long, with `EADDRINUSE` in the log even
though nothing is running.

Fix: point `OMP_RPC_DIR` at a shorter path (the macOS ~104-byte
AF_UNIX cap is the cause), or accept the default `~/.omp-rpc/`.

### omp lost authentication mid-session

Symptom: `start` succeeds, `send` fails with an omp auth error.

Fix: re-authenticate omp itself (`omp usage`, `omp models list` to
verify), then `abort` or `stop`/`start` the session. omp-rpc never
touches credentials; it inherits whatever `~/.omp` holds.

### A send was interrupted from the client side

The daemon keeps running the turn server-side; your terminal's stream
is gone but the turn completes and the session state records it
(`turns` increments). Reattach by reading the log:

```sh
omp-rpc logs -n 20
```

Then `status` before the next `send`: if `busy: true`, wait; a second
`send` on a busy session is refused (see `session busy` above).

### Clean slate

The nuclear option that leaves no doubt:

```sh
omp-rpc stop --force -y   # or: rm -rf "$OMP_RPC_DIR" (default ~/.omp-rpc) when nothing runs
```

(only ever removes this tool's own runtime files; presets.json and the
log live there too, so the manual removal takes presets with it.)

## What this runbook does NOT cover

- omp itself: protocol details live in this repo's
  [LEARNINGS.md](LEARNINGS.md), omp's own docs cover its UI modes.
- The RPC client as a library: `src/client.js` has the importable
  surface, with a standalone-usage snippet in
  [../skills/using-omp-rpc/references/architecture.md](../skills/using-omp-rpc/references/architecture.md).
- Running omp-rpc as a system service (launchd/systemd): unowned. The
  daemon is a user-level detached process by design.