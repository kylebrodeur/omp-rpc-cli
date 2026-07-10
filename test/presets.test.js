import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

// Point OMP_RPC_DIR at a throwaway dir BEFORE importing presets (which resolves
// PRESETS_PATH from config at load) — so use a dynamic import after the env is set.
const tmp = fs.mkdtempSync(join(os.tmpdir(), "omp-rpc-presets-"));
process.env.OMP_RPC_DIR = tmp;
const { list, get, save, remove } = await import("../src/presets.js");

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("missing file → empty list", () => {
  assert.deepEqual(list(), {});
  assert.equal(get("nope"), undefined);
});

test("save then get/list round-trips", () => {
  const scope = { models: ["ollama/glm-5.2:cloud", "ollama/kimi-k2.7-code:cloud"], active: "ollama/glm-5.2:cloud" };
  save("big", scope);
  assert.deepEqual(get("big"), scope);
  assert.deepEqual(Object.keys(list()), ["big"]);
});

test("save is persisted to disk", () => {
  const onDisk = JSON.parse(fs.readFileSync(join(tmp, "presets.json"), "utf8"));
  assert.equal(onDisk.big.active, "ollama/glm-5.2:cloud");
});

test("second preset coexists; remove deletes only it", () => {
  save("solo", { models: ["ollama-cloud/glm-5.1"], active: "ollama-cloud/glm-5.1" });
  assert.deepEqual(Object.keys(list()).sort(), ["big", "solo"]);
  remove("big");
  assert.deepEqual(Object.keys(list()), ["solo"]);
  assert.equal(get("big"), undefined);
});
