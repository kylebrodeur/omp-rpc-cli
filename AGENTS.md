# AGENTS.md: the boundary of this repo, stated as rules

An agent operating `omp-rpc` obeys these rules. They are the contract;
the command detail lives in [docs/RUNBOOK.md](docs/RUNBOOK.md), and the
walkthrough lives in [docs/quickstart.md](docs/quickstart.md).

## What this tool is

A daemon that holds ONE long-running `omp --mode rpc-ui` session open (Oh
My Pi's native RPC protocol, newline-delimited JSON over stdio) and a thin
CLI that sends tasks to it over a Unix socket. The driving agent (you, or
Claude Code) delegates work to the session with `omp-rpc send` and the
session's context accumulates across turns.

## Rules an agent keeps here

1. **Never invent a model selector.** Selectors come from omp's live
   catalog (`omp-rpc models --json`), not from memory. A partial name
   (`glm`) is rejected with a candidate list; copy an exact
   `provider/id` selector out of that output.
2. **The session is single-flight.** One task at a time; a `send` while
   busy returns a busy error, so wait, or `steer` into the running turn
   and `abort` to cancel it. Never queue two tasks.
3. **Read the status before acting on the session.** `omp-rpc status`
   shows pid, model, scope, cwd, turns, and `busy`. A stateful decision
   (switching models, steering, stopping) starts from that reply, not
   from an assumption.
4. **`stop` is deliberate.** It refuses to tear down a busy session
   unless `--force`, and it removes only this tool's runtime files. Do
   not wrap `stop` in retry-until-dead logic; use `--force` when the
   in-flight task is deliberately abandoned.
5. **The danger guard is a net, not a sandbox.** Destructive shell
   commands are denied at the approval chokepoint, but a determined
   command can evade the regexes. Point `--cwd` at a throwaway checkout
   or a container for untrusted or high-risk work.
6. **One session per machine** (the runtime files live in
   `~/.omp-rpc/`). To work in another repo, `stop` and `start` again with
   the new `--cwd`; the daemon's cwd is fixed at start.
7. **Capture output deliberately.** Thoughts and tool events stream to
   stderr, the answer to stdout: `omp-rpc send -q "..." > out.txt` for a
   clean parse, `--json` for the raw done event.
8. **Keep the docs honest per the family standard**: real commands with
   expected output, errors carrying their fix, no em or en dashes, no
   AI-slop words, no personal identifiers, and a check date on factual
   claims. Run the suite:
   `npm test` from
   this repo, and require it to pass. The test also holds the tracked
   markdown to the same prose rules, so a banned character or word in
   any tracked file is a failing test.

## What this tool is NOT

- NOT a wrapper around arbitrary agents: it drives `omp` specifically,
  over omp's own RPC protocol. For generic agent protocols there was
  `pi-acp` (retired in this tool's history).
- NOT a credential manager: auth is omp's (`~/.omp`), inherited.
- NOT a sandbox, a firewall, or a permission gate for a human: the guard
  denies obviously destructive commands; it does not police content.
- NOT a team harness: one session, one task at a time. The multiplexed
  team shape is a different member of the family.

## Installing the skill instead of reading this file

The skill `skills/using-omp-rpc/SKILL.md` teaches the command mechanics;
`skills/delegating-to-omp-rpc/SKILL.md` teaches when and how to delegate.
Both install with `npx skills add kylebrodeur/omp-rpc-cli -g`.