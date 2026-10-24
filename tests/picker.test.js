import { test } from "node:test";
import assert from "node:assert/strict";
import { buildScope } from "../src/picker.js";

const CAT = [
  { selector: "ollama/glm-5.2:cloud", contextWindow: 1000000 },
  { selector: "ollama/kimi-k2.7-code:cloud", contextWindow: 262144 },
  { selector: "ollama-cloud/glm-5.1", contextWindow: 202752 },
];

test("valid subset with explicit active", () => {
  const s = buildScope(CAT, ["ollama/glm-5.2:cloud", "ollama/kimi-k2.7-code:cloud"], "ollama/kimi-k2.7-code:cloud");
  assert.deepEqual(s, { models: ["ollama/glm-5.2:cloud", "ollama/kimi-k2.7-code:cloud"], active: "ollama/kimi-k2.7-code:cloud" });
});

test("active defaults to first chosen when omitted", () => {
  const s = buildScope(CAT, ["ollama/kimi-k2.7-code:cloud", "ollama/glm-5.2:cloud"]);
  assert.equal(s.active, "ollama/kimi-k2.7-code:cloud");
});

test("empty selection returns null", () => {
  assert.equal(buildScope(CAT, []), null);
});

test("selector not in catalog throws", () => {
  assert.throws(() => buildScope(CAT, ["ollama/nope"]), /not in the catalog/);
});

test("active outside the chosen set throws", () => {
  assert.throws(
    () => buildScope(CAT, ["ollama/glm-5.2:cloud"], "ollama/kimi-k2.7-code:cloud"),
    /active model .* not in the chosen set/,
  );
});
