# How-to: day-to-day operation

Task-shaped answers for the things you do repeatedly once the daemon is
installed. The one-time setup is [quickstart.md](quickstart.md); every
flag, error string, and recovery procedure is indexed in
[RUNBOOK.md](RUNBOOK.md).

## Drive a task to completion and review the result

```sh
omp-rpc send "Add input validation to src/config.js: reject an empty OMP_RPC_DIR value with a clear error"
```

The answer streams to stdout; read the streamed tool events (stderr) to
see what it did, then review the diff in the repo.

## Run the session unattended and check back later

Tasks keep running after the terminal that started them closes (the
daemon is detached). Come back and check:

```sh
omp-rpc status
```

```text
● running
  turns:   3
  busy:    true
  ...
```

`busy: true` means a turn is in flight; the reply of a `send` that you
closed mid-turn is lost to that terminal, but the session state (turns,
context, files edited in `--cwd`) persists. Read the log to see what the
session did:

```sh
omp-rpc logs -n 20
```

## Interrupt or redirect a running turn

Redirect without cancelling (the turn absorbs the message):

```sh
omp-rpc steer "skip the tests dir, just ship the src changes"
```

Cancel the turn, keep the session:

```sh
omp-rpc abort
```

Both answer `steered` / `aborted` on success. Steering when no turn runs
is an error (`no turn in progress to steer into`).

## Switch models mid-session

Within the session's scope, live, no restart, context preserved:

```sh
omp-rpc model ollama/kimi-k2.7-code:cloud
```

```text
model -> ollama/kimi-k2.7-code:cloud
```

Out of scope is rejected with the allowed list:

```text
✗ "anthropic/claude-opus-4-8" is not in this session's scope:
  ollama/glm-5.2:cloud
```

Typing a partial name gives candidates instead of a guess:

```text
✗ no exact model match for "glm". Candidates:
  huggingface/zai-org/GLM-5.3  (ctx 1,048,576)
  ollama/glm-5.2:cloud  (ctx 128,000)
  ...
```

(copy the exact selector you want out of that list)

## Save a scope as a preset and reuse it

On a TTY, pick interactively and save:

```sh
omp-rpc pick --save coding
```

Start from it next time:

```sh
omp-rpc start --preset coding
```

List, remove:

```sh
omp-rpc presets
omp-rpc presets rm coding
```

Presets live in `~/.omp-rpc/presets.json`.

## Parse the reply in a script

The reply text goes to stdout; everything else goes to stderr:

```sh
ANSWER=$(omp-rpc send -q "What version is in package.json?")
echo "$ANSWER"
```

The raw done event (stop reason, token usage) as JSON for the strictest
parsers:

```sh
omp-rpc send --json "Summarize the README in one line" 2>/dev/null
```

```json
{
  "type": "done",
  "stopReason": "end_turn",
  "usage": {
    "inputTokens": 0,
    "outputTokens": 0,
    "totalTokens": 0,
    "cacheRead": 0,
    "cacheWrite": 0,
    "cost": 0
  }
}
```

(captured live from a verified run; zero usage values occur when the
provider does not report them for the turn)

Feed a task from stdin (a file, a pipe):

```sh
echo "review the diff in the last commit" | omp-rpc send
```

## Move the session to another repo

The daemon's `--cwd` is fixed at start. To work in a different tree:

```sh
omp-rpc stop
omp-rpc start --models "<sel>,<sel>" --model <sel> --cwd /other/repo
```

(The selectors are placeholders: copy exact ones from
`omp-rpc models --json`.)

## Run with no scope at all

On a non-interactive start with no flags, the session runs unscoped on
omp's own default model. `omp-rpc model <sel>` then accepts any catalog
selector. Handy for agent-driven ad-hoc sessions; the scope lock is the
safer shape for repeated delegation, because it bounds what a typo can
switch to.

## Recover a wedged session

Symptoms: the daemon answers, but sends fail, or `stop` hangs. Do this,
in order:

1. `omp-rpc logs -n 40`: read the last entries for what omp reported.
2. `omp-rpc stop --force -y`: closes the session, kills the daemon,
   removes the runtime files (the log is kept).
3. `omp-rpc start ...` again as usual: a fresh session with a fresh
   context.

Stale files from a crashed daemon are cleared by the next `start`, so a
"already running" claim with no live pid is not a state you must fix by
hand.

## Where to go with an error

Every error string the CLI can emit is in
[RUNBOOK.md](RUNBOOK.md#error-strings-and-their-fixes) next to its fix.