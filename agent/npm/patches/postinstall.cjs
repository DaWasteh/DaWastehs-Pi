"use strict";

const fs = require("node:fs");
const path = require("node:path");

/** Recognize workflow IDs that are always either a UUID or absent. */
function hasFilesystemSafePiSubagentsAsyncWorkflowId(source) {
  return /\bconst\s+workflowRunId\s*=\s*(?:randomUUID\(\)|[^\r\n;?]+\?\s*randomUUID\(\)\s*:\s*undefined)\s*;/.test(source);
}

/**
 * Keep pi-subagents async workflow directories valid on Windows.
 * Pi 0.84 tool-call IDs may contain `|`, so they cannot be path components.
 * Current pi-subagents releases already use a conditional UUID assignment;
 * only the legacy `_id` implementation still needs rewriting.
 */
function patchPiSubagents(packageRoot = path.join(__dirname, "..", "node_modules", "pi-subagents")) {
  const executorPath = path.join(
    packageRoot,
    "src",
    "runs",
    "foreground",
    "subagent-executor.ts",
  );

  if (!fs.existsSync(executorPath)) {
    return { found: false, changed: false, path: executorPath };
  }

  const source = fs.readFileSync(executorPath, "utf8");
  if (hasFilesystemSafePiSubagentsAsyncWorkflowId(source)) {
    return { found: true, changed: false, path: executorPath };
  }

  const vulnerable = "const workflowRunId = _id;";
  if (!source.includes(vulnerable)) {
    // Upstream changed the implementation. Do not overwrite unknown code.
    return { found: true, changed: false, path: executorPath };
  }

  const patched = source.replace(
    vulnerable,
    "const workflowRunId = randomUUID(); // Filesystem-safe on Windows; tool-call ids may contain `|`.",
  );
  fs.writeFileSync(executorPath, patched, "utf8");
  return { found: true, changed: true, path: executorPath };
}

/**
 * Pi's registry reports a builtin override with the extension's provenance.
 * Availability is the registered canonical NAME, not source === "builtin".
 * This changes discovery only: ceilings, excludes and child runtime validation
 * remain in pi-subagents. Never synthesize absent tools or forward providers.
 * @param {string} source
 */
function patchPiSubagentsHostToolSource(source) {
  const vulnerable = [
    '\t\t\t.filter((tool) => {',
    '\t\t\t\tconst source = (tool.sourceInfo as { source?: string } | undefined)?.source;',
    '\t\t\t\treturn source === "builtin" || (source === "auto" && PI_BUILTIN_TOOL_NAMES.has(tool.name));',
    '\t\t\t})',
  ].join("\n");
  const replacement = '\t\t\t.filter((tool) => PI_BUILTIN_TOOL_NAMES.has(tool.name))';
  const normalized = source.replace(/\r\n/g, "\n");
  const signature = 'export function getHostBuiltinToolNames(pi: Pick<ExtensionAPI, "getAllTools">): string[] | undefined {';
  if (normalized.split(signature).length !== 2) return { status: "unsupported", next: source };
  const start = normalized.indexOf(signature);
  const end = normalized.indexOf("\n}", start);
  const body = normalized.slice(start, end);
  if (body.includes(replacement) && !body.includes(vulnerable)) {
    return { status: "already-patched", next: source };
  }
  if (!body.includes(vulnerable) || normalized.split(vulnerable).length !== 2) {
    return { status: "unsupported", next: source };
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  return { status: "patched", next: source.replace(vulnerable.replaceAll("\n", eol), replacement) };
}

/** Only intersect builtin names with the builtin registry, not extension tools.
 * Extension tools still need their declared provider and strict child validation.
 * @param {string} source
 */
function patchPiSubagentsBuiltinPruningSource(source) {
  const replacements = [
    ['ceilingFilteredBuiltinTools.filter((tool) => hostAvailableSet.has(tool) || NATIVE_COORDINATION_TOOL_NAMES.has(tool))',
     'ceilingFilteredBuiltinTools.filter((tool) => !PI_BUILTIN_TOOL_NAMES.has(tool) || hostAvailableSet.has(tool))'],
    ['ceilingFilteredBuiltinTools.filter((tool) => !hostAvailableSet.has(tool) && !NATIVE_COORDINATION_TOOL_NAMES.has(tool))',
     'ceilingFilteredBuiltinTools.filter((tool) => PI_BUILTIN_TOOL_NAMES.has(tool) && !hostAvailableSet.has(tool))'],
  ];
  let next = source;
  for (const [before, after] of replacements) {
    const oldCount = next.split(before).length - 1;
    const newCount = next.split(after).length - 1;
    if (oldCount === 1 && newCount === 0) next = next.replace(before, after);
    else if (oldCount !== 0 || newCount !== 1) return { status: "unsupported", next: source };
  }
  return { status: next === source ? "already-patched" : "patched", next };
}

function patchPiSubagentsHostTools(packageRoot = path.join(__dirname, "..", "node_modules", "pi-subagents")) {
  const target = path.join(packageRoot, "src", "runs", "shared", "child-tool-plan.ts");
  if (!fs.existsSync(target)) return { found: false, changed: false, path: target };
  const source = fs.readFileSync(target, "utf8");
  const result = patchPiSubagentsHostToolSource(source);
  if (result.status === "unsupported") {
    throw new Error(`Unsupported pi-subagents host tool discovery in ${target}; inspect upstream before updating the compatibility patch.`);
  }
  const pruning = patchPiSubagentsBuiltinPruningSource(result.next);
  if (pruning.status === "unsupported") {
    throw new Error(`Unsupported pi-subagents builtin tool pruning in ${target}; inspect upstream before updating the compatibility patch.`);
  }
  if (pruning.next !== source) fs.writeFileSync(target, pruning.next, "utf8");
  return { found: true, changed: pruning.next !== source, path: target };
}

if (require.main === module) {
  const result = patchPiSubagents();
  if (result.changed) {
    console.log("Patched pi-subagents async workflow IDs for Windows-safe runtime paths.");
  }
  const hostTools = patchPiSubagentsHostTools();
  if (hostTools.changed) {
    console.log("Patched pi-subagents host tool discovery: recognize builtin overrides and preserve declared extension tools.");
  }
}

module.exports = { hasFilesystemSafePiSubagentsAsyncWorkflowId, patchPiSubagents, patchPiSubagentsHostToolSource, patchPiSubagentsBuiltinPruningSource, patchPiSubagentsHostTools };
