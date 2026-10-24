# Quickstart: from nothing to a delegated turn

The numbered path from nothing to a running session with work delegated
to it. Every command is copy-pasteable unless marked otherwise (the ones
that need your own model choice point at the live catalog instead of a
hardcoded selector).

Checked 2026-10-22 against omp-rpc-cli 0.3.0 (14 node tests passing) with
a live run: the commands below were executed as written and the outputs
shown are captured from that run.

## 0. What this is not

Not a one-shot prompt runner. For a single prompt with no follow-up, run
`omp -p "..."` (or `omp --mode json "..."`) and skip this tool. omp-rpc
exists for the case where a SECOND agent keeps context across a series
of tasks.

## 1. Prereqs

- [omp](https://omp.sh/docs) (Oh My Pi) installed and authenticated. It
  must be on your PATH; verify with `omp --version`.
- Node >= 20.

## 2. Install the CLI

```sh
npm install -g omp-rpc-cli
```

Check it:

```sh
omp-rpc --version
```

```text
0.3.0
```

(From a checkout instead of npm: run it with
`node bin/omp-rpc.js <command>` from the repo root; the rest of this
guide reads the same.)

## 3. Discover models: never guess a selector

Selectors are `provider/id` values that come from omp's live catalog,
which changes as models are added. Ask it:

```sh
omp-rpc models glm
```

```text
ollama
  ◉ ollama/glm-5.2:cloud          128,000 ctx  GLM 5.2
  ollama/glm-5.3:cloud            128,000 ctx  GLM 5.3
```

(trimmed; the real listing shows every matching provider with context
windows, and `--json` prints the machine-readable array an agent copies
exact selectors from.)

Pick ONE exact selector and use it below, either the one above or your
own from `omp-rpc models --json`.

## 4. Start a session scoped to your models

```sh
omp-rpc start --models "ollama/glm-5.2:cloud" --model "ollama/glm-5.2:cloud" --cwd /path/to/the/repo/it/works/in
```

(the `--cwd` flag value is a placeholder you replace: it is the directory
the delegated agent works in.)

```text
✓ omp-rpc running
  pid:     43420
  model:   ollama/glm-5.2:cloud
  scope:   ollama/glm-5.2:cloud
  cwd:     /tmp/ecp-example
  session: 01a1652b-959e-71f6-9cd4-bbeabc5f00c2
  socket:  /home/you/.omp-rpc/daemon.sock
```

(pid, session id, and socket are per-run; this one is from the verified
live run.) `--model` alone locks the session to one model; `--models`
scopes the set that `omp-rpc model` may switch among.

## 5. Delegate a task

```sh
omp-rpc send "Summarize what this repo's build does in three sentences"
```

The reply streams to stdout as it is produced; omp's thoughts and tool
events stream dimmed to stderr. At the end of the turn:

```text
end_turn · in 2,340 / out 187 tok
```

(dimmed in the real output, and preceded by an em-dash glyph that this
doc cannot carry because the prose gate bans it: the footer starts with
that dash character, then a space, then `end_turn`.)

## 6. Build on the same session

The next `send` sees everything the earlier turns did:

```sh
omp-rpc send "Now write the health check the summary implies is missing"
```

Check the session at any time:

```sh
omp-rpc status
```

```text
● running
  pid:     43420
  model:   ollama/glm-5.2:cloud
  scope:   ollama/glm-5.2:cloud
  cwd:     /tmp/ecp-example
  session: 01a1652b-959e-71f6-9cd4-bbeabc5f00c2
  turns:   2
  busy:    false
  started: 2026-10-22T19:51:57.292Z
```

## 7. Try the guard live

Ask for something destructive and watch it get denied instead of run:

```sh
omp-rpc send "Run exactly this: rm -rf ~"
```

```text
· Allow tool: bash [denied]
The tool-use request was denied by the user. If you believe
this is an error, ask them again and provide more context.
end_turn · in 1,205 / out 44 tok
```

(Same note as the turn footer above: the real line starts with the
em-dash glyph.)

(The exact sentence the model echoes varies; the constant is the
`denied` tool event and a `BLOCKED dangerous command` line in
`omp-rpc logs`).

## 8. Stop and clean up

```sh
omp-rpc stop
```

In a terminal it asks to confirm; scripted (no TTY) or `-y` proceeds.
It removes `daemon.sock`, `daemon.pid`, and `daemon.json`, keeps the
log, and never touches the session's working directory:

```text
This will close the omp session and remove runtime files:
  /home/you/.omp-rpc/daemon.sock
  /home/you/.omp-rpc/daemon.pid
  /home/you/.omp-rpc/daemon.json
The daemon log is kept. Working dir (/tmp/ecp-example) is NOT touched.
✓ stopped
```

## Next

- The tasks you repeat day to day: [how-to.md](how-to.md)
- Every command, error string, and recovery procedure:
  [RUNBOOK.md](RUNBOOK.md)
- Delegation practice (when and how to hand work off): the
  `delegating-to-omp-rpc` skill in
  [../skills/delegating-to-omp-rpc/SKILL.md](../skills/delegating-to-omp-rpc/SKILL.md)