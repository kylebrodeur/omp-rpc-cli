// Live model catalog access for omp-rpc.
//
// The single source of truth for model selectors is omp's own catalog
// (`omp models list --json`), NOT a hardcoded alias table — so newly-added
// models are visible and nothing rots. Selection is exact: we resolve an input
// to one concrete selector or throw with candidates. We never fuzzy-guess.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

// Error thrown when an input can't be resolved to exactly one model. `candidates`
// are the substring matches (sorted by context window desc) to guide the user
// toward an exact selector — or toward the interactive picker.
export class ModelResolveError extends Error {
  constructor(input, candidates) {
    const list = candidates.length
      ? candidates.map((c) => `  ${c.selector}  (ctx ${c.contextWindow.toLocaleString()})`).join("\n")
      : "  (no models matched — try `omp-rpc models` to browse)";
    super(`no exact model match for "${input}". Candidates:\n${list}`);
    this.name = "ModelResolveError";
    this.input = input;
    this.candidates = candidates;
  }
}

let _cache = null; // memoized catalog for this process

// Load and parse omp's catalog. `refresh` forces omp to re-fetch it first.
export async function loadCatalog({ refresh = false } = {}) {
  if (_cache && !refresh) return _cache;
  if (refresh) {
    try {
      await execFileP("omp", ["models", "refresh"]);
    } catch {
      /* refresh is best-effort; fall through to whatever catalog exists */
    }
  }
  const { stdout } = await execFileP("omp", ["models", "list", "--json"], { maxBuffer: 32 * 1024 * 1024 });
  const parsed = JSON.parse(stdout);
  const models = (parsed.models || []).map((m) => ({
    provider: m.provider,
    id: m.id,
    selector: m.selector,
    name: m.name,
    contextWindow: m.contextWindow ?? 0,
  }));
  _cache = models;
  return models;
}

// Pure resolver. Returns an exact selector or throws ModelResolveError.
//   1. exact selector match
//   2. exact, unique id match
//   3. otherwise: throw, listing substring candidates (ctx desc)
// `pool` (array of selectors) restricts the search to a session scope.
export function findExactIn(models, input, pool) {
  const inScope = pool ? models.filter((m) => pool.includes(m.selector)) : models;

  if (inScope.some((m) => m.selector === input)) return input;

  const byId = inScope.filter((m) => m.id === input);
  if (byId.length === 1) return byId[0].selector;

  const q = String(input).toLowerCase();
  const pickFrom = byId.length > 1 ? byId : inScope;
  const candidates = pickFrom
    .filter((m) => [m.selector, m.id, m.name].some((f) => String(f).toLowerCase().includes(q)))
    .sort((a, b) => b.contextWindow - a.contextWindow);
  throw new ModelResolveError(input, candidates);
}

// Async convenience: resolve against the live catalog.
export async function findExact(input, { pool, refresh } = {}) {
  return findExactIn(await loadCatalog({ refresh }), input, pool);
}

// Resolve a comma/space-separated list of patterns to a deduped selector list
// (for `--models`). Each pattern must resolve exactly; the first is the default
// active model unless one is named separately.
export async function resolveScope(patterns, { refresh } = {}) {
  const models = await loadCatalog({ refresh });
  const list = (Array.isArray(patterns) ? patterns : String(patterns).split(","))
    .map((s) => s.trim())
    .filter(Boolean);
  const selectors = list.map((p) => findExactIn(models, p));
  return [...new Set(selectors)];
}
