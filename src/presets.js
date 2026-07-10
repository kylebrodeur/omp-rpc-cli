// Named scope presets — save a chosen set of models once, load it fast later.
//
// Stored as a single JSON object in ~/.omp-rpc/presets.json:
//   { "<name>": { models: string[], active: string } }
// where every entry is an exact omp selector.
import fs from "node:fs";
import { dirname } from "node:path";
import { PRESETS_PATH } from "./config.js";

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(PRESETS_PATH, "utf8"));
  } catch {
    return {}; // missing/corrupt file = no presets
  }
}

function writeAll(obj) {
  fs.mkdirSync(dirname(PRESETS_PATH), { recursive: true });
  // Atomic: write a temp file then rename, so a crash never leaves a half file.
  const tmp = `${PRESETS_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, PRESETS_PATH);
}

export function list() {
  return readAll();
}

export function get(name) {
  return readAll()[name];
}

export function save(name, { models, active }) {
  const all = readAll();
  all[name] = { models, active };
  writeAll(all);
  return all[name];
}

export function remove(name) {
  const all = readAll();
  if (!(name in all)) return false;
  delete all[name];
  writeAll(all);
  return true;
}
