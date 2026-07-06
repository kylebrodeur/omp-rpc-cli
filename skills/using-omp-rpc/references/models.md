# omp-rpc — models

## Aliases

Defined in `src/config.js`. All are Ollama Cloud models addressed via the local
`ollama` runtime's cloud models (the `ollama/<id>:cloud` form).

| Alias | omp selector | Context | Notes |
|---|---|---|---|
| `glm` *(default)* | `ollama/glm-5.2:cloud` | 1,000,000 | biggest context — best for a session that accumulates many turns |
| `kimi` | `ollama/kimi-k2.7-code:cloud` | 262,144 | coding-tuned |
| `deepseek` | `ollama/deepseek-v4-pro:cloud` | 524,288 | strong reasoning |
| `gemma` | `ollama/gemma4:31b-cloud` | 262,144 | lighter/faster |

> **Two providers, same models.** omp also exposes an `ollama-cloud/<id>`
> provider (e.g. `ollama-cloud/glm-5.2`) for these same models. Either works if
> authenticated; omp-rpc standardizes on the `ollama/*:cloud` form. Confirm an
> exact `provider`/`id` pair with the RPC `get_available_models` command (or
> `omp models list --json`) rather than hand-constructing it.

## Choosing

- **Long delegation session with lots of back-and-forth** → `glm` (1M context
  means the accumulated history is far less likely to overflow).
- **Focused coding task** → `kimi`.
- **Any provider** → pass a raw omp selector: `--model anthropic/claude-opus-4-8`,
  `--model github-copilot/gpt-5.2`, etc.

## Switching live

The model can change **while the session runs** — this is the main upgrade over
the old ACP transport (whose ACP surface had no `session/set_model`). `omp-rpc
model <x>` issues RPC `set_model`, which matches your selector against omp's
available models by `{ provider, modelId }`:

```sh
omp-rpc model kimi                        # alias
omp-rpc model anthropic/claude-opus-4-8   # raw selector
```

The accumulated session context carries across the switch — you're changing which
model answers the *next* turn, not resetting the conversation.

## Authentication

`omp-rpc` does not manage credentials — it inherits whatever `omp` has configured
under `~/.omp`. If `start` succeeds but `send` errors, the model likely isn't
authenticated. Check with `omp models list` and `omp usage`.

## Discovering selectors

```sh
omp models list            # human-readable
omp models list --json     # objects with provider/id/selector/contextWindow/...
```

The `selector` field (e.g. `ollama/glm-5.2:cloud`) is exactly what `--model` and
`omp-rpc model` expect; omp also fuzzy-matches short names.
