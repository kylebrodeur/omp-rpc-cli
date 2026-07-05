# pi-acp

A **long-running [Oh My Pi](https://github.com/) (`omp`) session** you can send
tasks to from the shell — a persistent second coding agent that a driver (you, or
Claude Code) can delegate work to and check back on.

`omp acp` speaks the [Agent Client Protocol](https://agentclientprotocol.com)
(JSON-RPC 2.0 over stdio). `pi-acp` is the client: a small **daemon** keeps one
ACP session open, and a thin **`send`** command forwards tasks over a Unix socket
and streams the reply back. Because it's one session, **context accumulates across
tasks** — you can build on earlier work.

## Install

```sh
cd pi-acp-cli
pnpm install
pnpm link --global      # exposes `pi-acp` on your PATH
```

Requires `omp` on your PATH and Node ≥ 20.

## Use

```sh
pi-acp start                       # boot the daemon (default model: glm, 1M ctx)
pi-acp start --model kimi          # coding-tuned kimi-k2.7-code
pi-acp start --cwd ~/repo --mode plan

pi-acp send "Summarize what this repo does"
pi-acp send "Now add a health check to server.js"   # remembers the last turn
echo "review the diff" | pi-acp send                # reads stdin
pi-acp send --quiet "..."          # reply only (no thoughts/tools on stderr)
pi-acp send --json  "..."          # raw {stopReason, usage}

pi-acp status                      # pid, model, session id, turn count, busy?
pi-acp mode plan                   # toggle default ↔ plan live
pi-acp logs -n 60                  # daemon log
pi-acp stop                        # close session + exit
pi-acp models                      # built-in aliases
```

### Model aliases

| alias | omp id | context |
|-------|--------|---------|
| `glm` (default) | `ollama-cloud/glm-5.2` | 1,000,000 |
| `kimi` | `ollama-cloud/kimi-k2.7-code` | 262,144 |
| `deepseek` | `ollama-cloud/deepseek-v4-pro` | 524,288 |
| `gemma` | `ollama-cloud/gemma4:31b` | 262,144 |

Any raw omp id also works: `--model anthropic/claude-opus-4-8`. Full list:
`omp models list`.

## How it works

```
pi-acp send ──unix socket──▶ daemon ──stdio (ACP JSON-RPC)──▶ omp acp
  (streams chunks back)        (holds one session open)         (the agent)
```

- **Model is fixed at `start`** — omp's ACP has no `session/set_model`; pick it
  when the session boots.
- **Mode is live** — `session/set_mode` toggles default ↔ plan on the open session.
- **Permissions auto-approve** so the session runs unattended (headless).
- Runtime state lives in `~/.pi-acp/` (`daemon.sock`, `daemon.pid`,
  `daemon.json`, `daemon.log`); override with `PI_ACP_DIR`.

## Files

- `src/client.js` — reusable `AcpClient` (importable ACP-over-stdio client).
- `src/daemon.js` — holds the session, serves tasks over the socket.
- `bin/pi-acp.js` — the CLI.
