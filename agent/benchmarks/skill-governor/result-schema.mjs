function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateResultRow(row, manifest) {
  if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Result row must be an object.");
  if (typeof row.caseId !== "string" || !manifest.cases.includes(row.caseId)) throw new Error("Result row has an invalid caseId.");
  if (typeof row.condition !== "string" || !manifest.conditions.includes(row.condition)) throw new Error("Result row has an invalid condition.");
  if (!Number.isInteger(row.replicate) || row.replicate < 1 || row.replicate > manifest.runs) throw new Error("Result row has an invalid replicate.");
  const structuralKey = `${row.caseId}|${row.condition}|${row.replicate}`;
  if (row.key !== structuralKey || !manifest.expectedKeys.includes(structuralKey)) throw new Error(`Result key/fields mismatch: ${row.key ?? "(missing)"}`);
  const interventionKey = `${row.caseId}|${row.condition}`;
  if (row.harnessHash !== manifest.harnessHash || row.piVersion !== manifest.piVersion || row.model !== manifest.model
    || row.thinking !== manifest.thinking || row.skillCorpusHash !== manifest.interventionHashes[interventionKey]) {
    throw new Error(`Result provenance mismatch: ${row.key}`);
  }
  if (typeof row.passed !== "boolean" || !finiteNumber(row.elapsedMs) || row.elapsedMs < 0) throw new Error(`Result outcome metrics are invalid: ${row.key}`);
  if (!row.usage || !finiteNumber(row.usage.totalTokens) || !finiteNumber(row.usage.cost)) throw new Error(`Result usage is invalid: ${row.key}`);
  if (!Number.isInteger(row.toolCalls) || row.toolCalls < 0 || !Array.isArray(row.toolTypes) || !Array.isArray(row.skillReads) || !Array.isArray(row.violations)) {
    throw new Error(`Result tool metadata is invalid: ${row.key}`);
  }
  if (!row.verification || typeof row.verification.passed !== "boolean" || !Array.isArray(row.verification.checks)) throw new Error(`Result verification is invalid: ${row.key}`);
  return row;
}

export function validateResultRows(rows, manifest, { requireComplete = false } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || !Array.isArray(manifest.expectedKeys)
    || !Array.isArray(manifest.cases) || !Array.isArray(manifest.conditions)
    || !Number.isInteger(manifest.runs) || !manifest.interventionHashes) {
    throw new Error("Run manifest is invalid.");
  }
  const seen = new Set();
  for (const row of rows) {
    validateResultRow(row, manifest);
    if (seen.has(row.key)) throw new Error(`Duplicate result key in immutable JSONL: ${row.key}`);
    seen.add(row.key);
  }
  if (requireComplete) {
    const expected = [...manifest.expectedKeys].sort();
    const actual = [...seen].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${expected.length} exact result keys; found ${actual.length}.`);
  }
  return seen;
}
