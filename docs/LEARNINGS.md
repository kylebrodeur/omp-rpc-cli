# Learnings — building pi-acp

Findings from wiring a client to `omp acp` (Oh My Pi v16.2.7) over the Agent
Client Protocol. Most were discovered empirically by probing the live server;
each shaped a design decision.

## ACP / omp protocol

- **omp frames ACP as newline-delimited JSON, not LSP `Content-Length`.** The ACP
  spec permits both; omp uses line-delimited. A client that expects header
  framing gets nothing. → split on `\n`, parse each line (`src/client.js`).
- **The connection is bidirectional and can deadlock.** Mid-turn, omp sends
  server→client *requests* (`session/request_permission`, and fs reads if you
  advertise fs capability). If you don't reply, the turn hangs forever. We
  declare no fs capability and answer permission requests explicitly.
- **Model is fixed at launch; there is no `session/set_model`.** Calling it
  returns `{code:-32603, "Unknown ACP ext method: session/set_model"}`. Model is
  set via the process flag `omp acp --model <id>`. → `pi-acp` pins model at
  `start` and documents restart-to-switch.
- **`session/set_mode` *is* supported** and returns `{}`. So default↔plan is
  live-switchable on an open session even though model is not.
- **Permission requests carry the command and typed options.** Shape:
  `params.toolCall.kind === "execute"`, command in `toolCall.rawInput.command`;
  `params.options[]` each have a `kind` of `allow_once`/`allow_always`/
  `reject_once`/`reject_always`. This one message is the entire control point for
  both autonomy (auto-approve) and the danger guard (auto-reject).
- **`initialize` advertises real capabilities:** `loadSession`, session
  `list`/`fork`/`resume`/`close`, MCP over http+sse, image + embedded-context
  prompts. `session/new` returns `configOptions` (mode + a full model list).
- **`session/close` exists** (`sessionCapabilities.close`) — used for graceful
  shutdown before killing the child.
- **Usage/cost stream in.** `session/update` emits `usage_update` with token size
  and a USD cost estimate; the final `session/prompt` result carries
  `{stopReason, usage:{inputTokens, outputTokens, cachedWriteTokens, ...}}`.

## omp models / Ollama Cloud

- **The same Ollama Cloud model is exposed under TWO providers.** omp lists both
  `ollama/<id>:cloud` (the local `ollama` runtime's cloud models, e.g.
  `ollama/glm-5.2:cloud`) and `ollama-cloud/<id>` (a direct provider, e.g.
  `ollama-cloud/glm-5.2`). Both launch and return real completions if
  authenticated — verified by sending a prompt through each. They authenticate
  via different paths, so pick the one your `omp`/`ollama` setup is signed into.
  pi-acp standardizes on `ollama/*:cloud`. **Always get the exact id from
  `omp models list --json` (`selector` field); do not hand-construct it** — the
  suffix placement differs (`gemma4:31b-cloud` vs `gemma4:31b`).
- **Context windows vary widely:** glm-5.2 = 1,000,000; deepseek-v4-pro = 524,288;
  kimi-k2.7-code and gemma4:31b = 262,144. For a session that accumulates history
  across many turns, the biggest window (glm) is the safest default.
- **Auth is inherited from `~/.omp`**, not managed by pi-acp. `start` can succeed
  while `send` fails if the chosen model isn't authenticated.

## Design decisions that fell out of the above

- **Daemon + Unix socket, not a one-shot pipe.** A persistent session that
  accumulates context can't be a per-call process. One detached daemon holds the
  session; a thin `send` streams over the socket. This is the core of "a
  long-running session you send tasks to."
- **`busy` is the unit of safety.** A stateful daemon can't be killed mid-turn
  without losing work, so we track one `busy` flag, reject concurrent `send`s, and
  gate `stop` on it (with `--force` to override). A stateless CLI wouldn't need
  this.
- **Auto-approve + pattern guard, not prompt-per-tool.** Unattended delegation
  requires approving tool use, so the safety must be a *deny*-list at the single
  permission chokepoint rather than a human prompt.
- **Cleanup only touches our own files.** `stop` removes `daemon.sock/pid/json`
  and keeps the log; it never touches the session's `--cwd`. Deleting an agent's
  actual work would be the worst possible "cleanup".

## Gotchas for future work

- **macOS has no `timeout(1)`** — don't rely on it in probes/scripts; use a Node
  `Promise.race` timeout instead.
- **`new Date()`/`Date.now()` are fine in the daemon** (plain Node process); they
  are only forbidden inside Workflow scripts.
- **Non-interactive `stop` must not prompt.** Agent callers have no TTY; `confirm`
  auto-yes when `!process.stdin.isTTY` so scripted stops never hang.
- **The guard is a net, not a sandbox.** It catches obvious catastrophes
  (`rm -rf /`, `curl|sh`, fork bombs) but a determined command can evade regexes.
  Real isolation = run `--cwd` in a container/throwaway checkout.
