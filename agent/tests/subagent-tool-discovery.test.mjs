import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const patches = require("../npm/patches/postinstall.cjs");

// Exact discovery implementation in pi-subagents 0.67.0. No installed package
// dependency: a clean checkout can reproduce the provenance regression.
const upstream = `const PI_BUILTIN_TOOL_NAMES = new Set(["read", "bash", "powershell", "edit", "write", "grep", "find", "ls"]);
export function getHostBuiltinToolNames(pi: Pick<ExtensionAPI, "getAllTools">): string[] | undefined {
	try {
		const builtins = pi
			.getAllTools()
			.filter((tool) => {
				const source = (tool.sourceInfo as { source?: string } | undefined)?.source;
				return source === "builtin" || (source === "auto" && PI_BUILTIN_TOOL_NAMES.has(tool.name));
			})
			.map((tool) => tool.name);
		return builtins.length > 0 ? builtins : undefined;
	} catch {
		return undefined;
	}
}
`;

const pruningSource = `
const NATIVE_COORDINATION_TOOL_NAMES = new Set(["subagent", "contact_supervisor", "subagent_supervisor"]);
export function prune(ceilingFilteredBuiltinTools, hostAvailableSet) {
 const declaredBuiltinTools = hostAvailableSet
  ? ceilingFilteredBuiltinTools.filter((tool) => hostAvailableSet.has(tool) || NATIVE_COORDINATION_TOOL_NAMES.has(tool))
  : ceilingFilteredBuiltinTools;
 const unavailableHostBuiltins = hostAvailableSet
  ? ceilingFilteredBuiltinTools.filter((tool) => !hostAvailableSet.has(tool) && !NATIVE_COORDINATION_TOOL_NAMES.has(tool))
  : [];
 return { declaredBuiltinTools, unavailableHostBuiltins };
}
`;

async function loadModule(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

async function loadDiscovery(source) {
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
  return (await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`)).getHostBuiltinToolNames;
}

const registry = [
  { name: "read", sourceInfo: { source: "builtin" } },
  { name: "bash", sourceInfo: { source: "npm:@casualjim/pi-heimdall" } },
  { name: "grep", sourceInfo: { source: "auto" } },
  { name: "powershell", sourceInfo: { source: "sdk" } },
  { name: "web_search", sourceInfo: { source: "npm:pi-web-access" } },
];

test("reproduces upstream omission of registered shell overrides", async () => {
  assert.deepEqual((await loadDiscovery(upstream))({ getAllTools: () => registry }), ["read", "grep"]);
});

test("discovers registered builtin names regardless of wrapper provenance, without inventing tools", async () => {
  const result = patches.patchPiSubagentsHostToolSource(upstream);
  assert.equal(result.status, "patched");
  const discover = await loadDiscovery(result.next);
  assert.deepEqual(discover({ getAllTools: () => registry }), ["read", "bash", "grep", "powershell"]);
  assert.deepEqual(discover({ getAllTools: () => registry.filter((tool) => tool.name !== "bash") }), ["read", "grep", "powershell"]);
  assert.deepEqual(discover({ getAllTools: () => [{ name: "write" }] }), ["write"]);
  assert.equal(discover({ getAllTools: () => [] }), undefined);
  assert.equal(discover({ getAllTools: () => { throw new Error("not initialized"); } }), undefined);
  assert.deepEqual(patches.patchPiSubagentsHostToolSource(result.next), { status: "already-patched", next: result.next });
});

test("patch fails visibly on unknown or duplicate source instead of modifying unrelated code", () => {
  for (const source of ["export const changedUpstream = true;", upstream + upstream]) {
    assert.deepEqual(patches.patchPiSubagentsHostToolSource(source), { status: "unsupported", next: source });
  }
});

test("tracked postinstall repair is idempotent, preserves CRLF, and reports unsupported installs", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-tool-discovery-"));
  try {
    const target = join(root, "src", "runs", "shared", "child-tool-plan.ts");
    assert.equal(patches.patchPiSubagentsHostTools(root).found, false);
    await mkdir(join(root, "src", "runs", "shared"), { recursive: true });
    await writeFile(target, (upstream + pruningSource).replaceAll("\n", "\r\n"));
    assert.equal(patches.patchPiSubagentsHostTools(root).changed, true);
    const repaired = await readFile(target, "utf8");
    assert.equal(repaired.replaceAll("\r\n", "").includes("\n"), false);
    assert.equal(patches.patchPiSubagentsHostTools(root).changed, false);
    await writeFile(target, "unknown upstream");
    assert.throws(() => patches.patchPiSubagentsHostTools(root), /Unsupported.*tool discovery/);
    assert.equal(await readFile(target, "utf8"), "unknown upstream");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("builtin host pruning preserves extension and coordination tools but still removes missing builtins", async () => {
  const tools = ["read", "bash", "fetch_content", "web_search", "source_check", "get_search_content", "contact_supervisor"];
  const host = new Set(["read"]);
  const original = await loadModule(upstream + pruningSource);
  assert.deepEqual(original.prune(tools, host).declaredBuiltinTools, ["read", "contact_supervisor"]);
  const repaired = patches.patchPiSubagentsBuiltinPruningSource(upstream + pruningSource);
  assert.equal(repaired.status, "patched");
  const { prune } = await loadModule(repaired.next);
  assert.deepEqual(prune(tools, host), { declaredBuiltinTools: tools.filter((tool) => tool !== "bash"), unavailableHostBuiltins: ["bash"] });
  assert.deepEqual(prune(tools, undefined), { declaredBuiltinTools: tools, unavailableHostBuiltins: [] });
  assert.deepEqual(patches.patchPiSubagentsBuiltinPruningSource(repaired.next), { status: "already-patched", next: repaired.next });
  assert.equal(patches.patchPiSubagentsBuiltinPruningSource(pruningSource + pruningSource).status, "unsupported");
  assert.equal(patches.patchPiSubagentsBuiltinPruningSource("unknown").status, "unsupported");
});

test("both repairs are validated before modifying package source", async () => {
  const root = await mkdtemp(join(tmpdir(), "pi-tool-atomic-"));
  try {
    const dir = join(root, "src", "runs", "shared");
    const target = join(dir, "child-tool-plan.ts");
    await mkdir(dir, { recursive: true });
    await writeFile(target, upstream);
    assert.throws(() => patches.patchPiSubagentsHostTools(root), /Unsupported.*pruning/);
    assert.equal(await readFile(target, "utf8"), upstream);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("updater and postinstall share the same repair and include its failure in update status", async () => {
  const source = await readFile(new URL("../extensions/pi-autoupdate.ts", import.meta.url), "utf8");
  assert.match(source, /import \{ patchPiSubagentsHostTools \} from "\.\.\/npm\/patches\/postinstall\.cjs"/);
  assert.match(source, /patchPiSubagentsHostTools\(root\)/);
  assert.match(source, /Unsupported|err instanceof Error/);
});
