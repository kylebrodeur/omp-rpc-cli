# pi-acp — architecture & internals

For extending the tool or debugging protocol issues.

## Processes

```
pi-acp <cmd>  (CLI, bin/pi-acp.js)
   │  unix socket (~/.pi-acp/daemon.sock), newline-delimited JSON
   ▼
daemon        (src/daemon.js, detached, one per machine)
   │  child stdio, ACP JSON-RPC 2.0, newline-delimited
   ▼
omp acp       (the Oh My Pi agent, one persistent ACP session)
```

- `bin/pi-acp.js` — CLI (commander). `start` spawns the daemon detached and
  unref'd; every other command talks to it over the socket.
- `src/daemon.js` — owns the `AcpClient`, opens one session, serves tasks over the
  socket, tracks `busy`/`turns`, writes `daemon.json` metadata.
- `src/client.js` — `AcpClient`, a reusable ACP-over-stdio client (importable).
- `src/config.js` — paths + model aliases. `src/danger.js` — command guard.

## ACP transport (client ↔ omp)

- **Framing:** newline-delimited JSON. omp does **not** use LSP `Content-Length`
  headers — split on `\n`, parse each line.
- **Handshake:** `initialize` (protocolVersion 1) → `session/new` → optional
  `session/set_mode`. `session/prompt` runs a turn; `session/close` ends it.
- **Three inbound shapes** the client must distinguish:
  1. responses to our requests (matched by `id`);
  2. server→client **requests** (`session/request_permission`, fs) — must be
     answered or the turn deadlocks;
  3. **notifications** (`session/update`) — the streaming turn:
     `agent_message_chunk`, `agent_thought_chunk`, `tool_call(_update)`, etc.
- **No `session/set_model`** — model is a launch flag (`omp acp --model …`).
  `session/set_mode` *is* supported.
- Permission options carry `kind`: `allow_once`/`allow_always`/`reject_once`/
  `reject_always`. The guard picks allow vs reject by kind.

## Socket protocol (CLI ↔ daemon)

Newline-delimited JSON, both directions.

Client → daemon:
```
{cmd:"prompt", text}
{cmd:"mode", mode:"default"|"plan"}
{cmd:"status"}
{cmd:"stop"}
```

Daemon → client:
```
{type:"thought"|"chunk", text}     // streamed during a turn
{type:"tool", title, status}
{type:"done", stopReason, usage}   // turn finished
{type:"status", pid, model, cwd, mode, sessionId, turns, busy, startedAt}
{type:"error", message}
```

## Runtime files (`~/.pi-acp/`, or `$PI_ACP_DIR`)

| File | Contents | Removed on stop |
|---|---|---|
| `daemon.sock` | Unix domain socket | yes |
| `daemon.pid` | daemon pid (liveness via `kill(pid, 0)`) | yes |
| `daemon.json` | session metadata (also read by `status`) | yes |
| `daemon.log` | append-only daemon log | **no** (kept) |

## Reusing AcpClient standalone

```js
import { AcpClient } from "pi-acp-cli/src/client.js";
const c = new AcpClient({ model: "ollama-cloud/glm-5.2", cwd: process.cwd() });
await c.start();
await c.newSession({});
const res = await c.prompt("hello", { onChunk: (t) => process.stdout.write(t) });
await c.close();
```
