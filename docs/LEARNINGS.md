# Learnings — building omp-rpc

Findings from wiring a client to `omp` (Oh My Pi v16.3.11). This tool began on
`omp acp` (the generic Agent Client Protocol) and moved to omp's **native RPC
mode** (`omp --mode rpc`/`rpc-ui`); the ACP findings that motivated the move are
kept below. Most of this was discovered empirically by probing the live process —
including reading command payload shapes out of the compiled `omp` binary's
embedded JS when the docs were ambiguous.

## Why RPC over ACP

ACP is a generic, agent-agnostic protocol; RPC is omp's own and a strict superset
for driving it. The deciding factors:

- **Live model switching.** ACP has no `session/set_model` (calling it returns
  `Unknown ACP ext method`), so the model was pinned at launch. RPC's `set_model`
  changes it on the running session — the headline upgrade.
- **Turn control.** RPC adds `steer` (inject into a running turn), `follow_up`
  (queue after it), and `abort` — none of which ACP exposed.
- **Richer introspection.** `get_session_stats` returns sessionId, token/cost
  totals, and live context-window usage %.

Since the tool is *specifically for omp*, the omp-native protocol is the right
substrate, and "acp" no longer belonged in the name.

## omp RPC protocol

- **Newline-delimited JSON over stdio, both directions.** Launch with
  `omp --mode rpc` (headless) or `--mode rpc-ui` (adds interactive UI frames). omp
  emits `{"type":"ready"}` when it will accept commands. `--mode json` is the
  one-shot variant with *identical* event framing — ideal for probing.
- **Commands carry `type` + optional `id`; acks echo `{id, type:"response",
  command, success, data?}`** (`error` on failure). `prompt`/`steer`/`follow_up`/
  `abort_and_prompt` all take `{message, images?}`; `abort` takes none.
- **A prompt acks immediately, then the turn streams untagged.** The event stream
  is *not* correlated to the command id: `agent_start` → `message_update`
  (`assistantMessageEvent.type` ∈ `text_delta`/`thinking_delta`/`toolcall_*`) →
  `tool_execution_start/_update/_end` → `message_end` (assistant `usage` here) →
  `agent_end`. Resolve a prompt on the next `agent_end`; it has **no** stopReason,
  so synthesize one. A slash-command message can ack with `{agentInvoked:false}`
  and never start a turn — handle that or you wait forever.
- **`set_model` matches on `{provider, modelId}`**, not a combined string
  (`{model:"ollama/glm-5.2:cloud"}` fails with `Model not found: undefined/undefined`).
  It matches against `get_available_models` by `provider === h.provider &&
  id === h.modelId`. Selectors are `provider/id`; the id itself may contain slashes
  (`huggingface/zai-org/GLM-5.2`), so split on the **first** `/` only.
- **`--mode rpc` is fully headless — tools auto-run with no approval prompt.** This
  is the crux for the danger guard: plain RPC gives it no hook point. Permission
  prompts only arrive under **`--mode rpc-ui`**, as `extension_ui_request`
  `{method:"select", title:"Allow tool: bash\nCommand: …", options:["Approve","Deny"]}`.
  Answer with `{type:"extension_ui_response", id, value:"Approve"|"Deny"}` — the
  option **string**, not `confirmed`/an index (answering with `confirmed:true` +
  no `value` denies the tool). So the daemon runs `rpc-ui --approval-mode write`.
- **`rpc-ui` also emits fire-and-forget UI frames** (`setWidget`, etc.) with ids
  that need no response — the turn completes without answering them.

## omp models / Ollama Cloud

- **The same Ollama Cloud model is exposed under TWO providers.** omp lists both
  `ollama/<id>:cloud` (the local `ollama` runtime's cloud models, e.g.
  `ollama/glm-5.2:cloud`) and `ollama-cloud/<id>` (a direct provider, e.g.
  `ollama-cloud/glm-5.2`). Both work if authenticated. omp-rpc standardizes on
  `ollama/*:cloud`. **Get the exact `provider`/`id` from `get_available_models`
  (or `omp models list --json`); do not hand-construct it** — suffix placement
  differs (`gemma4:31b-cloud` vs `gemma4:31b`).
- **Context windows vary widely:** glm-5.2 = 1,000,000; deepseek-v4-pro = 524,288;
  kimi-k2.7-code and gemma4:31b = 262,144. For a session that accumulates history
  across many turns, the biggest window (glm) is the safest default.
- **Auth is inherited from `~/.omp`**, not managed by omp-rpc. `start` can succeed
  while `send` fails if the chosen model isn't authenticated.

## Design decisions that fell out of the above

- **Daemon + Unix socket, not a one-shot pipe.** A persistent session that
  accumulates context can't be a per-call process. One detached daemon holds the
  session; a thin `send` streams over the socket.
- **`busy` is the unit of safety.** A stateful daemon can't be killed mid-turn
  without losing work, so we track one `busy` flag, reject concurrent `send`s
  (offering `steer` instead), and gate `stop` on it (`--force` to override).
- **Auto-approve + pattern guard via `rpc-ui`.** Unattended delegation requires
  approving tool use, so the safety is a *deny*-list at the single approval
  chokepoint — which is why we deliberately choose `rpc-ui` over headless `rpc`.
- **Cleanup only touches our own files.** `stop` removes `daemon.sock/pid/json`
  and keeps the log; it never touches the session's `--cwd`.

## Gotchas for future work

- **macOS caps AF_UNIX socket paths at ~104 bytes.** A long `$OMP_RPC_DIR` makes
  `listen()` fail — and it surfaces as `EADDRINUSE`, not a length error, which is
  a misleading trail. The default `~/.omp-rpc/daemon.sock` is safe; keep overrides
  short.
- **macOS has no `timeout(1)`** — don't rely on it in probes/scripts; use a Node
  `Promise.race` timeout or a background-kill instead.
- **The docs site is a client-rendered SPA** (`curl` gets only the shell). When
  omp's RPC payload shapes were ambiguous, `strings` on the compiled binary +
  grepping for the command's `case` label revealed the exact destructuring.
- **`new Date()`/`Date.now()` are fine in the daemon** (plain Node process); they
  are only forbidden inside Workflow scripts.
- **Non-interactive `stop` must not prompt.** Agent callers have no TTY; `confirm`
  auto-yes when `!process.stdin.isTTY` so scripted stops never hang.
- **The guard is a net, not a sandbox.** It catches obvious catastrophes
  (`rm -rf /`, `curl|sh`, fork bombs) but a determined command can evade regexes.
  Real isolation = run `--cwd` in a container/throwaway checkout.
