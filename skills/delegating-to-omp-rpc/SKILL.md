---
name: delegating-to-omp-rpc
description: Use when you want to hand a coding or research task to a second, persistent agent instead of doing it yourself — offloading long or independent work, running a cheaper/different model alongside your own, or keeping a separate context that accumulates across a series of related tasks.
---

# Delegating to omp-rpc

## Overview

`omp-rpc` is a **persistent second agent you can drive from the shell**. You
(the driving agent) send it scoped tasks with `omp-rpc send`, read the streamed
result, and iterate — its session **remembers earlier turns**, so a delegation is
a conversation, not a series of cold prompts. Mechanics of each command live in
the `using-omp-rpc` skill; this skill is about *when and how to delegate well*.

## When to use

- A sub-task is **self-contained** and you'd rather not spend your own context on
  it (bulk edits, a focused investigation, boilerplate, a first-draft).
- You want a **second opinion** or a different model's take in parallel.
- You want work done under a **separate accumulating context** (e.g. iterating on
  one file over several turns) without polluting yours.

**Not for:** tasks needing your live conversation context (the sub-agent can't see
it — you must put everything it needs *in the task text*), or trivial one-liners
you can just do.

## The delegation loop

```sh
omp-rpc status                                   # running? busy?
omp-rpc models --json                            # discover exact selectors (never guess them)
omp-rpc start --models "<sel>,<sel>" --model <sel> --cwd /path/to/repo  # scope + active
omp-rpc send "Task 1 — <clear, self-contained instruction>"
omp-rpc send "Task 2 — builds on task 1"         # context carries over
# ...review each streamed reply, correct course as needed...
omp-rpc stop                                     # when the whole job is done
```

## Doing it well

- **Point `--cwd` at the repo** the sub-agent should work in, so its file tools
  operate on the right tree.
- **Make each task self-contained.** The sub-agent has no access to your
  conversation — restate the goal, name the files, include constraints.
- **One task at a time.** The session is single-flight; wait for a `send` to
  return before the next. `omp-rpc status` shows `busy`.
- **Steer instead of waiting** when a running turn is going the wrong way:
  `omp-rpc steer "actually, skip the tests dir"` injects mid-turn; `omp-rpc abort`
  cancels it outright.
- **Discover models, don't recall them.** Selectors live in omp's catalog and
  change over time — run `omp-rpc models --json` and copy exact selectors; never
  invent a selector from memory.
- **Match the model to the task, live.** Scope the session to a few models at
  `start` (`--models`), then switch among them per turn — a big-context model for
  a sprawling session, a coding-tuned one for a focused turn — with
  `omp-rpc model <sel>`. No restart; the accumulated context is preserved. Switches
  are limited to the session's scope.
- **Capture cleanly** when you'll parse the output: `omp-rpc send -q "..."` sends
  the answer to stdout and thoughts/tools to stderr. `--json` gives
  `{stopReason, usage}`.
- **Review before trusting.** It runs a different (often smaller) model with
  auto-approved tools; read its diffs/output rather than assuming success.

## Safety when delegating

Destructive shell commands are auto-denied and `stop` won't discard in-flight
work — but the guard is a net, not a sandbox. For untrusted or high-risk tasks,
start the session with `--cwd` inside a throwaway checkout or container. Details
in the `using-omp-rpc` safety reference.

## Common mistakes

- **Assuming shared context.** It sees only the task text you send. Missing
  context → wrong output.
- **Firing a second task while busy.** Returns a busy error; serialize your sends
  (or `steer` into the running one).
- **Leaving a session running on the wrong repo.** Its `--cwd` is fixed at
  `start`; to work elsewhere, `stop` and `start` again there.
