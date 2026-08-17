import assert from "node:assert/strict";
import test from "node:test";
import { validateResultRow, validateResultRows } from "../benchmarks/skill-governor/result-schema.mjs";

const manifest = {
  schemaVersion: 1,
  harnessHash: "harness",
  piVersion: "0.84.2",
  model: "provider/model",
  thinking: "low",
  runs: 1,
  cases: ["case-a"],
  conditions: ["condition-a"],
  expectedKeys: ["case-a|condition-a|1"],
  interventionHashes: { "case-a|condition-a": "corpus" },
};

const valid = {
  schemaVersion: 1,
  key: "case-a|condition-a|1",
  caseId: "case-a",
  condition: "condition-a",
  replicate: 1,
  model: "provider/model",
  thinking: "low",
  piVersion: "0.84.2",
  harnessHash: "harness",
  skillCorpusHash: "corpus",
  passed: true,
  elapsedMs: 10,
  usage: { totalTokens: 100, cost: 0.01 },
  toolCalls: 1,
  toolTypes: ["read"],
  skillReads: [],
  violations: [],
  verification: { passed: true, checks: [] },
};

test("result schema accepts one complete structurally bound row", () => {
  assert.equal(validateResultRow(valid, manifest), valid);
  assert.deepEqual([...validateResultRows([valid], manifest, { requireComplete: true })], [valid.key]);
});

test("result schema rejects key/field swaps and provenance drift", () => {
  assert.throws(() => validateResultRow({ ...valid, caseId: "other" }, manifest), /caseId|key/);
  assert.throws(() => validateResultRow({ ...valid, key: "case-a|condition-a|9" }, manifest), /key\/fields/);
  assert.throws(() => validateResultRow({ ...valid, replicate: 2 }, manifest), /replicate/);
  assert.throws(() => validateResultRow({ ...valid, skillCorpusHash: "stale" }, manifest), /provenance/);
});

test("result schema rejects duplicates, partial matrices, and malformed core metrics", () => {
  assert.throws(() => validateResultRows([valid, valid], manifest), /Duplicate/);
  assert.throws(() => validateResultRows([], manifest, { requireComplete: true }), /Expected 1/);
  assert.throws(() => validateResultRow({ ...valid, usage: { totalTokens: Number.NaN, cost: 0 } }, manifest), /usage/);
  assert.throws(() => validateResultRow({ ...valid, toolCalls: -1 }, manifest), /tool metadata/);
});
