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
pi-acp stop                        # close session + clean up (see Safety)
pi-acp stop --force                # stop even mid-task; -y skips the prompt
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
- **Permissions auto-approve** so the session runs unattended (headless) —
  *except* commands the danger guard flags (see Safety).
- Runtime state lives in `~/.pi-acp/` (`daemon.sock`, `daemon.pid`,
  `daemon.json`, `daemon.log`); override with `PI_ACP_DIR`.

## Safety

Because the daemon approves tool use unattended, two guardrails apply:

- **Dangerous-command guard** (`src/danger.js`). Before approving an `execute`
  permission, the command is matched against destructive patterns —
  recursive force-`rm` of root/home/cwd, `mkfs`, `dd` to a raw disk,
  `shred`/`wipe`, fork bombs, `curl|wget … | sh`, recursive `chmod`/`chown` on
  `/`, `shutdown`/`reboot`, destructive `git clean/reset`. A match is **rejected**
  (logged as `BLOCKED …`) and the agent is told no; everything else is allowed.
  It's a blast-radius net, not a sandbox — tune the patterns to taste.
- **Safe stop / cleanup.** `pi-acp stop` refuses to tear down a session that's
  **mid-task** (use `--force` to override), lists exactly which runtime files it
  will remove, and **never touches the session's working directory** or anything
  the agent created there. It only deletes `daemon.sock`/`daemon.pid`/
  `daemon.json`; the log is kept. In a terminal it asks to confirm; when scripted
  (no TTY) or with `-y` it proceeds without prompting. Shutdown first sends ACP
  `session/close`, then removes the files.

## Files

- `src/client.js` — reusable `AcpClient` (importable ACP-over-stdio client).
- `src/daemon.js` — holds the session, serves tasks over the socket.
- `bin/pi-acp.js` — the CLI.
- `src/danger.js` — dangerous-command guard patterns.

## Skills & docs

[agentskills.io](https://agentskills.io)-format skills for agents driving this tool:

- `skills/using-pi-acp/` — operate the daemon: commands, models, safety,
  architecture (with reference files).
- `skills/delegating-to-pi-acp/` — the pattern for handing tasks to it as a
  persistent second agent.

Design/protocol findings from building it: [`docs/LEARNINGS.md`](docs/LEARNINGS.md).
