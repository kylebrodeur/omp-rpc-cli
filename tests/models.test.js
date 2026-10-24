import { test } from "node:test";
import assert from "node:assert/strict";
import { findExactIn, ModelResolveError } from "../src/models.js";

// A small fixture mirroring the real catalog's shape, including the same model
// exposed under two providers (ollama/*:cloud vs ollama-cloud/*) with DISTINCT
// ids — the reason exact-id lookup stays unambiguous.
const CAT = [
  { provider: "ollama", id: "glm-5.2:cloud", selector: "ollama/glm-5.2:cloud", name: "GLM 5.2", contextWindow: 1000000 },
  { provider: "ollama-cloud", id: "glm-5.2", selector: "ollama-cloud/glm-5.2", name: "GLM 5.2", contextWindow: 1000000 },
  { provider: "ollama-cloud", id: "glm-5.1", selector: "ollama-cloud/glm-5.1", name: "GLM 5.1", contextWindow: 202752 },
  { provider: "ollama", id: "kimi-k2.7-code:cloud", selector: "ollama/kimi-k2.7-code:cloud", name: "Kimi K2.7 Code", contextWindow: 262144 },
];

test("exact selector resolves to itself", () => {
  assert.equal(findExactIn(CAT, "ollama/glm-5.2:cloud"), "ollama/glm-5.2:cloud");
});

test("exact unique id resolves to its selector", () => {
  assert.equal(findExactIn(CAT, "glm-5.2"), "ollama-cloud/glm-5.2");
  assert.equal(findExactIn(CAT, "kimi-k2.7-code:cloud"), "ollama/kimi-k2.7-code:cloud");
});

test("ambiguous substring throws with candidates sorted by context desc", () => {
  assert.throws(
    () => findExactIn(CAT, "glm"),
    (err) => {
      assert.ok(err instanceof ModelResolveError);
      // the two 1M glm-5.2 selectors precede the 202k glm-5.1
      assert.deepEqual(err.candidates.map((c) => c.selector), [
        "ollama/glm-5.2:cloud",
        "ollama-cloud/glm-5.2",
        "ollama-cloud/glm-5.1",
      ]);
      assert.match(err.message, /glm/);
      return true;
    },
  );
});

test("unknown input throws with no candidates", () => {
  assert.throws(
    () => findExactIn(CAT, "totally-unknown-model"),
    (err) => err instanceof ModelResolveError && err.candidates.length === 0,
  );
});

test("pool restricts the search to a session scope", () => {
  const scope = ["ollama/glm-5.2:cloud", "ollama/kimi-k2.7-code:cloud"];
  // in scope
  assert.equal(findExactIn(CAT, "ollama/glm-5.2:cloud", scope), "ollama/glm-5.2:cloud");
  // exact selector that exists in the catalog but is out of scope → rejected
  assert.throws(() => findExactIn(CAT, "ollama-cloud/glm-5.1", scope), ModelResolveError);
});
