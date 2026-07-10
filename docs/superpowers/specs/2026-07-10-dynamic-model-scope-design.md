# Dynamic model scope, presets, and a catalog-driven picker

**Status:** approved (design) · **Target version:** 0.3.0 · **Date:** 2026-07-10

## Problem

Models are selected today via a hardcoded `MODEL_ALIASES` map in `src/config.js`
(`glm → ollama/glm-5.2:cloud`, etc.). That map rots the moment Ollama's catalog
changes, can only ever name a handful of the 280+ models omp knows, and forces a
driving agent to *remember* selectors it was never told about. New models added
after the agent's training are invisible.

The tool is driven by both a human and an agent (Claude Code). Neither should
have to know or guess selectors. Selection must come from the **live catalog**,
and must be **unambiguous** — no fuzzy string that silently resolves to the wrong
model version.

## Goals

1. Remove all hardcoded model aliases; resolve everything against omp's live
   catalog (`omp models list --json`).
2. Selection like a real model switcher (Claude `/model`, omp Ctrl+P): pick
   concrete models from the loaded catalog, ending with **exact selectors**.
3. A session runs with a **scoped set** of allowed models; live switching
   (`omp-rpc model`) is allowed **only within that scope**, by human or agent.
4. **No ambiguity:** flags accept only an exact selector or a uniquely-matching
   id; anything ambiguous is rejected with a candidate list, never auto-picked.
5. **Presets:** save a chosen scope by name and load it quickly on later starts.
6. The agent path is fully non-interactive; the human path is a TUI picker.

## Non-goals

- No re-implementation of omp's fuzzy matcher. We validate exact, we do not guess.
- No broad redesign of the CLI↔daemon socket protocol. The only change is the
  `model` command payload (`{provider, modelId}` → `{selector}`, so the daemon can
  scope-check before splitting) plus a `scope` field in `status`.
- Persisting per-model settings (thinking level, etc.) — out of scope.

## Architecture

New/changed modules, each with one job:

| Module | Responsibility |
|---|---|
| `src/models.js` (new) | Load the live catalog and validate/look up selectors. |
| `src/presets.js` (new) | CRUD for named scope presets in `~/.omp-rpc/presets.json`. |
| `src/picker.js` (new) | clack TUI: multiselect scope → pick active → offer save. TTY only. |
| `src/config.js` (edit) | Drop `MODEL_ALIASES`/`DEFAULT_MODEL`/`resolveModel`; keep paths + `splitModel`; add `PRESETS_PATH`. |
| `src/daemon.js` (edit) | Store the resolved scope; expose it in status/meta; **enforce** it on `model`. |
| `bin/omp-rpc.js` (edit) | New `models`/`pick`/`presets` commands; scope precedence in `start`; scoped `model`. |

New dependencies: `@clack/prompts` (picker), `chalk` (catalog formatting).
`commander` stays. The **agent path uses none of these** — it is plain JSON in/out.

### `src/models.js`

- `loadCatalog({ refresh = false } = {})` → `Promise<Model[]>`. Shells
  `omp models refresh` first when `refresh`, then `omp models list --json`;
  parses `{ models: [...] }`. Each `Model` = `{ provider, id, selector, name,
  contextWindow }` (extra fields ignored). Memoized per process.
- `findExact(input, pool?)` → `selector`. Resolution order:
  1. `input` equals a `selector` exactly → return it.
  2. `input` equals exactly one model's `id` → return that selector.
  3. Otherwise **throw** `ModelResolveError` whose message lists candidates
     (substring matches on selector/id/name), sorted by `contextWindow` desc,
     e.g. `ambiguous "glm" — did you mean: ollama/glm-5.2:cloud (1,000,000), …`.
  `pool` (array of selectors) restricts steps 1–3 to that subset (used to
  resolve within a session scope).
- `formatTable(models)` → chalk-colored `name · selector · ctx` lines for the
  human `models` listing.

### `src/presets.js`

- File: `PRESETS_PATH = ~/.omp-rpc/presets.json`, shape
  `{ "<name>": { models: string[], active: string } }`.
- `list()`, `get(name)`, `save(name, { models, active })`, `remove(name)`.
  Missing file = empty object. Writes are atomic (write tmp + rename).

### `src/picker.js`

- `runPicker(catalog)` → `{ models: string[], active: string } | null` (null on
  cancel). clack `multiselect` (grouped by provider, label `name · selector ·
  ctx`), then `select` for the active model from the chosen subset, then an
  optional `text` "save as preset?" name.
- The **pure** part — turning a catalog + a set of chosen selectors into a
  validated `{ models, active }` — lives in a testable helper
  `buildScope(catalog, chosenSelectors, activeSelector)`; the TTY wrapper only
  gathers input and calls it.

### `src/daemon.js`

- Reads `OMP_RPC_MODELS` (comma-separated exact selectors) at boot → `scope: string[]`.
- `writeMeta`/`status` include `scope`.
- `model` dispatch receives `{ cmd: "model", selector }` where `selector` is
  already an **exact** selector (the CLI resolved it against the catalog before
  sending). The daemon does pure enforcement only: if `scope` is non-empty and
  `selector ∉ scope` → `{ type: "error", message: "not in this session's scope: …" }`;
  otherwise `splitModel(selector)` → `set_model`. The daemon never fetches the
  catalog — it holds no catalog, only the exact `scope` list. Empty scope =
  unscoped (any catalog selector allowed).

### `bin/omp-rpc.js`

Commands:

```
omp-rpc models [pattern] [--json] [--refresh]   # list catalog; --json = agent path
omp-rpc pick [--save <name>] [--print]          # TUI picker → start | print cmd | save preset
omp-rpc presets                                 # list saved presets
omp-rpc presets rm <name>                        # delete a preset
omp-rpc start [--models "s1,s2"] [--model s1] [--preset <name>]
omp-rpc model [selector]                         # live switch within scope; no arg + TTY = scope picker
```

**`start` scope precedence** (first that applies wins):
1. `--models` / `--model` explicit flags — each validated via `findExact`.
2. `--preset <name>` — load `{ models, active }` from presets.
3. TTY and no flags — run the picker.
4. No TTY and no flags — start on omp's own default, **unscoped** (agents never hang).

The resolved scope is passed to the daemon via `OMP_RPC_MODELS`; the active model
via the existing `OMP_RPC_MODEL`. `--models` is also passed through to omp, but
**the daemon is the enforcement gate** — omp's `--models` only scopes TUI Ctrl+P
cycling and does not constrain RPC `set_model`.

**`model` command:** with an argument, the CLI resolves it to an exact selector
via `findExact` (against the full catalog) and sends that exact selector to the
daemon, which enforces scope membership (see above). With no argument on a TTY,
the CLI opens a picker limited to the scope (read from `status`) and switches to
the chosen one.

## Ambiguity handling

Ambiguity is eliminated by construction on the primary paths: the picker and
`--json` both yield exact selectors copied from the catalog. The only place a
loose string enters is a hand-typed `--models`/`--model`/`model` flag, and there
`findExact` accepts only an exact selector or a unique id and otherwise throws
with a sorted candidate list. Nothing is ever silently auto-selected.

## Skills (the agent-awareness fix)

Both skills gain an explicit rule: **discover models with `omp-rpc models --json`
and copy exact selectors from it; never invent or recall selectors from memory.**
This is the mechanism that keeps a driving agent correct as the catalog changes.

- `using-omp-rpc`: replace the fixed alias table with the discover-then-select
  flow and the scope/preset commands.
- `delegating-to-omp-rpc`: note that model choice for a delegation starts from
  `omp-rpc models --json`.

## Testing

- `models.js`: exact selector ✓, unique id ✓, ambiguous → throws with candidates,
  unknown → throws; `pool` restriction. Run against the real live catalog.
- `presets.js`: save/get/list/remove round-trip under a temp `OMP_RPC_DIR`.
- `buildScope` (picker pure part): valid subset ✓, active-not-in-subset → error,
  empty selection → null.
- Daemon scope membership: in-scope selector resolves, out-of-scope rejected
  (exercised via the pure `findExact(input, scope)` path).
- Existing guard-probe style: standalone `node` scripts, no test framework added
  unless one proves warranted.

## Rollout

Minor bump to **0.3.0** (new features; removes the alias surface — a breaking
change for anyone who passed `--model glm`, now `--model glm-5.2` or the picker).
Commit, push to `main`, `pnpm publish`, refresh the global install and skills.
Note the alias removal in the commit + README.
