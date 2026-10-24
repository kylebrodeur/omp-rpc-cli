# examples: a runnable example session

`session.sh` is the runnable example. It is a script, not prose: run it
and watch a real delegated session happen, scoped and cleaned up.

## What it does

1. Cleans up any previous example run.
2. Seeds `workspace/hello.js` (a two-line script) as the tree the
   session will work in.
3. Discovers model selectors from omp's live catalog (`omp-rpc models
   glm`), demonstrating the never-guess-a-selector rule.
4. If you exported `OMP_RPC_EXAMPLE_MODEL` with an exact selector:
   starts a session scoped to it, delegates two turns (the second builds
   on the first's context), prints the resulting file and the daemon
   log, and stops the session.
5. Without that export, it stops after discovery and tells you what to
   set. Run it both ways.

## Run it

```sh
cd omp-rpc-cli

# discovery only (no omp session):
examples/session.sh

# a full delegated session (needs an authenticated omp):
OMP_RPC_EXAMPLE_MODEL='ollama/glm-5.2:cloud' examples/session.sh
```

(The selector value above is an EXAMPLE: run `omp-rpc models --json`
yourself, copy an exact `provider/id` selector your omp is
authenticated for, and pass that.)

All state stays inside `examples/` (runtime files under
`examples/.omp-rpc/`, the delegated work in `examples/workspace/`), so
the example never touches your real `~/.omp-rpc`. The runtime dir is
removed at the start of each run; workspace edits accumulate until you
delete the directory.

## Expected output (from a verified run, 2026-10-22)

The discovery phase reads like:

```text
==> discover selectors (agent path: copy exact ones)
ollama
    ollama/glm-5.3-flash:cloud      128,000 ctx  GLM 5.3 Flash
  ◉ ollama/glm-5.2:cloud            128,000 ctx  GLM 5.2
...
```

(trimmed; the listing varies as omp's catalog changes.)

With a selector exported, the middle reads like:

```text
==> start a session scoped to: ollama/glm-5.2:cloud
✓ omp-rpc running
  pid:     43420
  model:   ollama/glm-5.2:cloud
  scope:   ollama/glm-5.2:cloud
  cwd:     .../examples/workspace
  session: 01a1652b-959e-71f6-9cd4-bbeabc5f00c2
  socket:  .../examples/.omp-rpc/daemon.sock
==> status
● running
  ...
```

then the two streamed turns, then the rewritten file and:

```text
==> stop
✓ stopped
done. The session's runtime files are gone; the workspace it edited
(examples/workspace) stays so you can inspect it.
```

(pid and session id are per-run.)