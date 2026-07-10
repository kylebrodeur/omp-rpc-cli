# omp-rpc — models

## No aliases — discover from the live catalog

There is **no hardcoded alias table** (removed in 0.3.0). Selectors come from
omp's live catalog, which changes as models are added, so **never recall a
selector from memory** — look it up:

```sh
omp-rpc models --json      # [{provider,id,selector,name,contextWindow}] — the agent path
omp-rpc models glm         # human-readable, filtered by substring
omp-rpc models --refresh   # re-fetch omp's catalog first (new models)
```

A **selector** is `provider/id`, e.g. `ollama/glm-5.2:cloud`,
`anthropic/claude-opus-4-8`, `github-copilot/gpt-5.2`. Pass exact selectors to
`--models`/`--model`. A partial name (`glm`) is **rejected** with a candidate
list sorted by context window — pick an exact one, or use `omp-rpc pick`.

> **Two providers, same models.** omp exposes some Ollama Cloud models under both
> `ollama/<id>:cloud` and `ollama-cloud/<id>`. They have distinct selectors and
> ids, so both resolve unambiguously — use whichever you're authenticated for.

## Scope

A session is scoped to the set passed to `--models` (or a preset). `--model`
picks the active one. Examples:

```sh
omp-rpc start --models "ollama/glm-5.2:cloud,ollama/kimi-k2.7-code:cloud" \
              --model ollama/glm-5.2:cloud     # scope of 2, active = glm
omp-rpc start --model ollama/glm-5.2:cloud     # scope of 1 (locked to glm)
omp-rpc start                                   # no TTY, no flags → omp default, unscoped
```

- **Long delegation session** → include a big-context model (e.g.
  `ollama/glm-5.2:cloud`, 1M) so accumulated history is less likely to overflow.
- **Focused coding** → include a coding-tuned model (e.g.
  `ollama/kimi-k2.7-code:cloud`).

## Switching live (within scope)

The model can change **while the session runs** — the main upgrade over the old
ACP transport. `omp-rpc model <sel>` issues RPC `set_model`, but only to a model
**in the session's scope**; anything else is rejected with the allowed list:

```sh
omp-rpc model ollama/kimi-k2.7-code:cloud   # exact selector, must be in scope
omp-rpc model                               # no arg on a TTY → pick from scope
```

The accumulated session context carries across the switch — you change which
model answers the *next* turn, not the conversation.

## Presets

Save a chosen scope and reload it fast:

```sh
omp-rpc pick --save coding    # pick models, save as "coding"
omp-rpc start --preset coding # reuse it
omp-rpc presets               # list; `omp-rpc presets rm coding` deletes
```

Presets live in `~/.omp-rpc/presets.json`.

## Authentication

`omp-rpc` does not manage credentials — it inherits whatever `omp` has configured
under `~/.omp`. If `start` succeeds but `send` errors, the model likely isn't
authenticated. Check with `omp models list` and `omp usage`.
