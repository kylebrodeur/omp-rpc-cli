// Interactive model picker (human path) — a clack TUI to choose a session's
// scoped set of models from the live catalog, like omp's Ctrl+P / Claude's
// /model switcher. The agent path never touches this file; it reads
// `omp-rpc models --json` and passes exact selectors instead.
import * as p from "@clack/prompts";

// Pure core: validate a chosen set + active model against the catalog.
// Returns { models, active } or null when nothing was chosen. Kept separate
// from the TTY so it can be unit-tested without a terminal.
export function buildScope(catalog, chosenSelectors, activeSelector) {
  if (!chosenSelectors || chosenSelectors.length === 0) return null;
  const known = new Set(catalog.map((m) => m.selector));
  for (const sel of chosenSelectors) {
    if (!known.has(sel)) throw new Error(`"${sel}" is not in the catalog`);
  }
  const active = activeSelector ?? chosenSelectors[0];
  if (!chosenSelectors.includes(active)) {
    throw new Error(`active model "${active}" is not in the chosen set`);
  }
  return { models: chosenSelectors, active };
}

const label = (m) => `${m.name}  ·  ${m.selector}  ·  ${m.contextWindow.toLocaleString()} ctx`;

// Interactive flow. Returns { models, active, saveAs } or null on cancel.
// `preselect` is a set of selectors to check by default (e.g. from a preset).
export async function runPicker(catalog, { preselect = [], title = "Select models for this session" } = {}) {
  p.intro("omp-rpc · model scope");

  const chosen = await p.multiselect({
    message: title,
    options: catalog.map((m) => ({ value: m.selector, label: label(m) })),
    initialValues: preselect,
    required: true,
  });
  if (p.isCancel(chosen)) return _cancel();

  let active = chosen[0];
  if (chosen.length > 1) {
    active = await p.select({
      message: "Which one is active to start?",
      options: chosen.map((sel) => ({ value: sel, label: sel })),
      initialValue: preselect.find((s) => chosen.includes(s)) ?? chosen[0],
    });
    if (p.isCancel(active)) return _cancel();
  }

  const scope = buildScope(catalog, chosen, active);

  const saveAns = await p.text({
    message: "Save this scope as a preset? (name, or empty to skip)",
    placeholder: "",
    defaultValue: "",
  });
  const saveAs = p.isCancel(saveAns) ? "" : String(saveAns).trim();

  p.outro("scope ready");
  return { ...scope, saveAs: saveAs || undefined };
}

function _cancel() {
  p.cancel("cancelled");
  return null;
}
