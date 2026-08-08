"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Keep pi-subagents async workflow directories valid on Windows.
 * Pi 0.84 tool-call IDs may contain `|`, so they cannot be path components.
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
  if (/const workflowRunId\s*=\s*randomUUID\(\);/.test(source)) {
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

if (require.main === module) {
  const result = patchPiSubagents();
  if (result.changed) {
    console.log("Patched pi-subagents async workflow IDs for Windows-safe runtime paths.");
  }
}

module.exports = { patchPiSubagents };
