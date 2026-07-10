# omp-rpc — architecture & internals

For extending the tool or debugging protocol issues.

## Processes

```
omp-rpc <cmd>  (CLI, bin/omp-rpc.js)
   │  unix socket (~/.omp-rpc/daemon.sock), newline-delimited JSON
   ▼
daemon         (src/daemon.js, detached, one per machine)
   │  child stdio, omp RPC, newline-delimited JSON
   ▼
omp --mode rpc-ui   (the Oh My Pi agent, one persistent RPC session)
```

- `bin/omp-rpc.js` — CLI (commander). `start` spawns the daemon detached and
  unref'd; every other command talks to it over the socket.
- `src/daemon.js` — owns the `RpcClient`, holds one session, serves tasks over the
  socket, tracks `busy`/`turns`, writes `daemon.json` metadata.
- `src/client.js` — `RpcClient`, a reusable omp-RPC-over-stdio client (importable).
- `src/config.js` — runtime paths + `splitModel`. `src/danger.js` — command guard.
- `src/models.js` — live catalog access + exact selector resolution (no aliases).
- `src/presets.js` — named scope presets (`~/.omp-rpc/presets.json`).
- `src/picker.js` — clack TUI multi-select for choosing a scope (human path).

## omp RPC transport (client ↔ omp)

- **Launch:** `omp --mode rpc-ui --approval-mode write [--model <selector>] --cwd <dir>`.
  omp emits `{"type":"ready"}` when it's accepting commands.
- **Framing:** newline-delimited JSON, one object per line, both directions.
- **Commands** carry a `type` and optional `id`; the matching ack echoes back as
  `{id, type:"response", command, success, data?}` (and `error` on failure). The
  ones this client uses: `prompt` `{message}`, `steer` `{message}`,
  `follow_up` `{message}`, `abort`, `set_model` `{provider, modelId}`,
  `get_session_stats`.
- **`set_model` matches on `{provider, modelId}`** against `get_available_models`
  — not a combined string. Selectors are `provider/id`; the id itself may contain
  slashes, so split on the **first** `/` only (see `splitModel`).
- **Event stream** (untagged — not correlated to a command id) is the turn:
  `agent_start` → `message_update` (with `assistantMessageEvent.type` of
  `text_delta` / `thinking_delta` / `toolcall_*`) → `tool_execution_start/_update/_end`
  → `message_end` (assistant `usage` lives here) → `agent_end`. A `prompt` resolves
  on the next `agent_end`. `agent_end` has no `stopReason`; we synthesize
  `"end_turn"`.
- **`--mode rpc` is fully headless — tools auto-run, no approval prompts.** To keep
  the danger guard we run **`rpc-ui` + `--approval-mode write`**, which surfaces
  each mutating tool as an `extension_ui_request` of `method:"select"`, e.g.
  `{title:"Allow tool: bash\nCommand: …", options:["Approve","Deny"]}`. Answer with
  `{type:"extension_ui_response", id, value:"Approve"|"Deny"}` (the option string).
  Non-`select` UI requests (`setWidget`, `open_url`, …) need no reply headless.

## Socket protocol (CLI ↔ daemon)

Newline-delimited JSON, both directions.

Client → daemon:
```
{cmd:"prompt", text}
{cmd:"steer", text} | {cmd:"abort"}
{cmd:"model", provider, modelId}
{cmd:"status"}
{cmd:"stop"}
```

Daemon → client:
```
{type:"thought"|"chunk", text}     // streamed during a turn
{type:"tool", title, status}
{type:"done", stopReason, usage}   // turn finished
{type:"status", pid, model, cwd, sessionId, turns, busy, startedAt}
{type:"error", message}
```

## Runtime files (`~/.omp-rpc/`, or `$OMP_RPC_DIR`)

| File | Contents | Removed on stop |
|---|---|---|
| `daemon.sock` | Unix domain socket | yes |
| `daemon.pid` | daemon pid (liveness via `kill(pid, 0)`) | yes |
| `daemon.json` | session metadata (also read by `status`) | yes |
| `daemon.log` | append-only daemon log | **no** (kept) |

> **Keep `OMP_RPC_DIR` short.** macOS caps AF_UNIX socket paths at ~104 bytes;
> a deep override directory makes `listen()` fail (surfaces as `EADDRINUSE`).
> The default `~/.omp-rpc/daemon.sock` is well within the limit.

## Reusing RpcClient standalone

```js
import { RpcClient } from "omp-rpc-cli/src/client.js";
const c = new RpcClient({ model: "ollama/glm-5.2:cloud", cwd: process.cwd() });
await c.start();                                  // waits for {type:"ready"}
const res = await c.prompt("hello", { onChunk: (t) => process.stdout.write(t) });
await c.setModel({ provider: "ollama", modelId: "kimi-k2.7-code:cloud" });
await c.close();
```
