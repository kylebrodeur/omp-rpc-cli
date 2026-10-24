// The docs contract test: the tracked markdown carries no em or en
// dashes, none of the four banned AI-slop words, and no personal
// identifiers. This is the in-repo twin of the family prose gates
// (the family harness), fail-closed like them: a
// banned character or word in any markdown is a failing test.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Skips runtime + dependency blobs; everything tracked markdown-wise is
// walked, including docs/, skills/, examples/, and the README files.
function markdownFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    if (entry.name.startsWith(".omp-rpc")) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(p));
    else if (entry.name.endsWith(".md")) out.push(p);
  }
  return out;
}

const DASH_RE = /[\u2014\u2013]/;
const SLOP_RE = /\b(robust|leverage|seamlessly|utilize)\b/i;
const PERSONAL_RE =
  /\b(Kyle Brodeur|kylebrodeur\.xyz|brodeur\.me|kyle@uof\.digital|kyle@brodeur\.me)\b/i;

const files = markdownFiles(REPO_ROOT);

test("the repo ships markdown docs to check", () => {
  assert.ok(files.length >= 3, `expected a real doc set, got ${files.length} files`);
});

for (const file of files) {
  const rel = path.relative(REPO_ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  test(`${rel}: no em/en dashes`, () => {
    const bad = lines
      .map((line, i) => [line, i + 1])
      .filter(([line]) => DASH_RE.test(line))
      .map(([, n]) => n);
    assert.deepEqual(bad, [], `em/en dash at lines ${bad.join(", ")}`);
  });
  test(`${rel}: no banned AI-slop words`, () => {
    const bad = lines
      .map((line, i) => [line, i + 1])
      .filter(([line]) => SLOP_RE.test(line))
      .map(([, n]) => n);
    assert.deepEqual(bad, [], `banned word at lines ${bad.join(", ")}`);
  });
  test(`${rel}: no personal identifiers`, () => {
    const bad = lines
      .map((line, i) => [line, i + 1])
      .filter(([line]) => PERSONAL_RE.test(line))
      .map(([, n]) => n);
    assert.deepEqual(bad, [], `identifier at lines ${bad.join(", ")}`);
  });
}