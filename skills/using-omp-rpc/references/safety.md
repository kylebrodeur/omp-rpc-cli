# omp-rpc — safety model

The daemon approves omp's tool-use requests **unattended** so tasks run without a
human in the loop. Two guardrails keep that from being reckless.

## Dangerous-command guard

Source: `src/danger.js`, enforced in `src/client.js`'s UI-request handler.

The daemon runs omp in `--mode rpc-ui --approval-mode write`, so every mutating
tool (bash, file writes) surfaces an `extension_ui_request` of `method:"select"`
whose `title` is `Allow tool: <tool>\nCommand: <cmd>`. For shell tools the command
is parsed out (`parseApproval`) and matched against destructive patterns. A match
is answered **"Deny"** (logged `BLOCKED dangerous command (<why>): <cmd>`);
everything else is answered "Approve". Reads run headless (no prompt).

Currently blocked (tune `PATTERNS` in `danger.js` to taste):

- recursive force `rm` (`rm -rf`), and `rm` targeting `/`, `~`, `.`, `$HOME`
- `mkfs`, `dd of=/dev/sd|nvme|disk|hd`, `shred`/`wipe`, redirect to a raw disk
- fork bomb `:(){ :|:& };:`
- `curl`/`wget`/`fetch … | sh` (piping the internet into a shell)
- recursive `chmod`/`chown` on `/`, `~`, `$HOME`
- `shutdown`/`reboot`/`halt`/`poweroff`, `killall -9`, `kill -9 -1`
- destructive git: `git clean -fdx`, `git reset --hard HEAD~…`

**This is a blast-radius net, not a sandbox.** It stops obvious catastrophes, not
a determined adversary. For real isolation, run `start --cwd` inside a container
or throwaway checkout.

> **Note on modes.** Plain `--mode rpc` is fully headless and runs every tool
> without asking — the guard would have no hook point there. `rpc-ui` +
> `--approval-mode write` is chosen precisely so the guard can veto commands.

## Safe stop & cleanup

`omp-rpc stop` is deliberately cautious:

1. **Refuses to tear down a busy session** (a task mid-flight) unless `--force`,
   so in-progress work isn't silently killed.
2. **Lists exactly what it deletes** — only `daemon.sock`, `daemon.pid`,
   `daemon.json`. The log is preserved for post-mortem.
3. **Never touches the session's working directory** or any file the agent
   created/edited there — omp-rpc only removes its own runtime state.
4. **Confirms interactively** in a TTY; auto-proceeds when scripted (no TTY) or
   with `-y`, so agent callers never hang.

Shutdown order: tear down the omp child → remove runtime files → exit. `SIGTERM`/
`SIGINT` follow the same graceful path.
