// Shared runtime paths and model aliases for pi-acp.
import { homedir } from "node:os";
import { join } from "node:path";

export const RUNTIME_DIR = process.env.PI_ACP_DIR || join(homedir(), ".pi-acp");
export const SOCK_PATH = join(RUNTIME_DIR, "daemon.sock");
export const PID_PATH = join(RUNTIME_DIR, "daemon.pid");
export const META_PATH = join(RUNTIME_DIR, "daemon.json");
export const LOG_PATH = join(RUNTIME_DIR, "daemon.log");

// Friendly aliases → fully-qualified omp model ids.
// These are the Ollama Cloud models we have available, addressed via the local
// `ollama` runtime's cloud models (the `ollama/<id>:cloud` form). `--model` also
// accepts any raw omp id (e.g. "anthropic/claude-opus-4-8"), passed straight
// through to `omp acp --model`. Source of truth for ids: `omp models list --json`
// (the `selector` field). Note omp also exposes an `ollama-cloud/<id>` provider
// for the same models — either works if authenticated; we standardize on
// `ollama/*:cloud`.
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
