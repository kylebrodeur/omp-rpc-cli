// Shared runtime paths for omp-rpc.
//
// Model selectors are NOT hardcoded here — they are resolved against omp's live
// catalog in `models.js`. Friendly aliases were removed in 0.3.0; discover models
// with `omp-rpc models` (interactive) or `omp-rpc models --json` (machine).
import { homedir } from "node:os";
import { join } from "node:path";

export const RUNTIME_DIR = process.env.OMP_RPC_DIR || join(homedir(), ".omp-rpc");
export const SOCK_PATH = join(RUNTIME_DIR, "daemon.sock");
export const PID_PATH = join(RUNTIME_DIR, "daemon.pid");
export const META_PATH = join(RUNTIME_DIR, "daemon.json");
export const LOG_PATH = join(RUNTIME_DIR, "daemon.log");
export const PRESETS_PATH = join(RUNTIME_DIR, "presets.json");

// omp's RPC `set_model` matches on a { provider, modelId } pair, not a combined
// string. Selectors are "provider/id" where the id itself may contain slashes
// (e.g. "huggingface/zai-org/GLM-5.2"), so we split on the FIRST slash only.
export function splitModel(selector) {
  const i = selector.indexOf("/");
  if (i === -1) return { provider: undefined, modelId: selector };
  return { provider: selector.slice(0, i), modelId: selector.slice(i + 1) };
}
