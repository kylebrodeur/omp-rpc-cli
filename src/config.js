// Shared runtime paths and model aliases for omp-rpc.
import { homedir } from "node:os";
import { join } from "node:path";

export const RUNTIME_DIR = process.env.OMP_RPC_DIR || join(homedir(), ".omp-rpc");
export const SOCK_PATH = join(RUNTIME_DIR, "daemon.sock");
export const PID_PATH = join(RUNTIME_DIR, "daemon.pid");
export const META_PATH = join(RUNTIME_DIR, "daemon.json");
export const LOG_PATH = join(RUNTIME_DIR, "daemon.log");

// Friendly aliases → fully-qualified omp model selectors (`provider/id`).
// These are the Ollama Cloud models we have available, addressed via the local
// `ollama` runtime's cloud models (the `ollama/<id>:cloud` form). `--model` also
// accepts any raw omp selector (e.g. "anthropic/claude-opus-4-8"). Source of
// truth for the exact provider/id pairs: the RPC `get_available_models` command
// (or `omp models list --json`). omp also exposes the same models under an
// `ollama-cloud/<id>` provider; we standardize on `ollama/*:cloud`.
export const MODEL_ALIASES = {
  gemma: "ollama/gemma4:31b-cloud",
  kimi: "ollama/kimi-k2.7-code:cloud",
  deepseek: "ollama/deepseek-v4-pro:cloud",
  glm: "ollama/glm-5.2:cloud",
};

// Default model when none is specified. glm-5.2 has a 1M-token context window —
// best suited to a long-running session that accumulates task history across
// many `send` calls. Use `--model kimi` for the coding-tuned kimi-k2.7-code.
export const DEFAULT_MODEL = MODEL_ALIASES.glm;

export function resolveModel(input) {
  if (!input) return DEFAULT_MODEL;
  return MODEL_ALIASES[input] || input;
}

// omp's RPC `set_model` matches on a { provider, modelId } pair, not a combined
// string. Selectors are "provider/id" where the id itself may contain slashes
// (e.g. "huggingface/zai-org/GLM-5.2"), so we split on the FIRST slash only.
export function splitModel(selector) {
  const s = resolveModel(selector);
  const i = s.indexOf("/");
  if (i === -1) return { provider: undefined, modelId: s };
  return { provider: s.slice(0, i), modelId: s.slice(i + 1) };
}
