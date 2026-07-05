// Shared runtime paths and model aliases for pi-acp.
import { homedir } from "node:os";
import { join } from "node:path";

export const RUNTIME_DIR = process.env.PI_ACP_DIR || join(homedir(), ".pi-acp");
export const SOCK_PATH = join(RUNTIME_DIR, "daemon.sock");
export const PID_PATH = join(RUNTIME_DIR, "daemon.pid");
export const META_PATH = join(RUNTIME_DIR, "daemon.json");
export const LOG_PATH = join(RUNTIME_DIR, "daemon.log");

// Friendly aliases → fully-qualified omp model ids.
// These are the Ollama Cloud models we have available. `--model` also accepts
// any raw omp id (e.g. "ollama-cloud/glm-4.7", "anthropic/claude-opus-4-8"),
// which is passed straight through to `omp acp --model`.
export const MODEL_ALIASES = {
  gemma: "ollama-cloud/gemma4:31b",
  kimi: "ollama-cloud/kimi-k2.7-code",
  deepseek: "ollama-cloud/deepseek-v4-pro",
  glm: "ollama-cloud/glm-5.2",
};

// Default model when none is specified. GLM-5.2 has a 1M-token context window —
// best suited to a long-running session that accumulates task history across
// many `send` calls. Use `--model kimi` for the coding-tuned kimi-k2.7-code.
export const DEFAULT_MODEL = MODEL_ALIASES.glm;

export function resolveModel(input) {
  if (!input) return DEFAULT_MODEL;
  return MODEL_ALIASES[input] || input;
}
