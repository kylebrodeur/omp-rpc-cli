# pi-acp — models

## Aliases

Defined in `src/config.js`. All are Ollama Cloud models addressed via the local
`ollama` runtime's cloud models (the `ollama/<id>:cloud` form).

| Alias | omp id | Context | Notes |
|---|---|---|---|
| `glm` *(default)* | `ollama/glm-5.2:cloud` | 1,000,000 | biggest context — best for a session that accumulates many turns |
| `kimi` | `ollama/kimi-k2.7-code:cloud` | 262,144 | coding-tuned |
| `deepseek` | `ollama/deepseek-v4-pro:cloud` | 524,288 | strong reasoning |
| `gemma` | `ollama/gemma4:31b-cloud` | 262,144 | lighter/faster |

> **Two providers, same models.** omp also exposes an `ollama-cloud/<id>`
> provider (e.g. `ollama-cloud/glm-5.2`) for these same models. Either works if
> authenticated; pi-acp standardizes on the `ollama/*:cloud` form. Always confirm
> an exact id with `omp models list --json` (the `selector` field) rather than
> hand-constructing it.

## Choosing

- **Long delegation session with lots of back-and-forth** → `glm` (1M context
  means the accumulated history is far less likely to overflow).
- **Focused coding task** → `kimi`.
- **Any provider** → pass a raw omp id: `--model anthropic/claude-opus-4-8`,
  `--model github-copilot/gpt-5.2`, etc.

## Fixed at start

The model is chosen when the session boots and **cannot be changed while it
runs** — omp's ACP surface has no `session/set_model` (it returns
`Unknown ACP ext method`). To switch models, `pi-acp stop` then `pi-acp start
--model <other>`. **Re-pass `--cwd` (and `--mode` if non-default) on the new
`start`** — they are not remembered from the previous session. Each model also
gets a fresh context; switching models does not carry the prior session's history.

```sh
# e.g. switch a running glm session to kimi, same repo:
pi-acp stop
pi-acp start --model kimi --cwd ~/repo
```

## Authentication

`pi-acp` does not manage credentials — it inherits whatever `omp` has configured
under `~/.omp`. If `start` succeeds but `send` errors, the model likely isn't
authenticated. Check with `omp models list` and `omp usage`.

## Discovering ids

```sh
omp models list            # human-readable
omp models list --json     # objects with provider/id/selector/contextWindow/...
```

The `selector` field (e.g. `ollama/glm-5.2:cloud`) is exactly what `--model`
expects; omp also fuzzy-matches short names.
