import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditSkillText, parseFrontmatterField, rankSkills } from "../extensions/skill-governor/policy.ts";

function skillText(name, description, extra = "") {
  return `---\nname: "${name}"\ndescription: "${description}"\nskill-governor-tier: auto\nskill-governor-risk: low\n---\n## When to Use\nUse only for a matching task; do not use elsewhere. Explicit task requirements override these defaults.\n\n## Verification\n1. Run one focused check.\n${extra}`;
}
function createSkill(name, description, path = `${name}/SKILL.md`, disabled = false) {
  return { name, description, filePath: path, baseDir: name, sourceInfo: {}, disableModelInvocation: disabled };
}
function mockPi(initial = ["read", "bash", "edit", "write", "subagent", "skill_manage", "dangerous_tool"]) {
  const handlers = new Map(); const tools = new Map(); const commands = new Map(); let active = [...initial];
  const allTools = [...new Set([...initial, "release_tool", "parser_tool", "subagent"])];
  const descriptors = Array.from(allTools, (name) => ({
    name,
    description: name === "release_tool" ? `Create a release and push a tag ${"x".repeat(500)}` : name === "parser_tool" ? "Inspect and repair a JavaScript parser" : `${name} tool`,
    sourceInfo: {},
  }));
  return { api: {
    on(name, handler) { handlers.set(name, handler); }, registerTool(tool) { tools.set(tool.name, tool); }, registerCommand(name, command) { commands.set(name, command); },
    getActiveTools() { return [...active]; }, setActiveTools(next) { active = [...new Set(next)]; }, getAllTools() { return descriptors; },
    async exec() { return { code: 1, stdout: "", stderr: "not a repository" }; },
  }, handlers, tools, commands, get active() { return active; }, set active(next) { active = next; } };
}
function context(cwd, model, hasUI = true) { return { cwd, model, hasUI, mode: hasUI ? "tui" : "json", ui: { notify() {}, async confirm() { throw new Error("no confirmation"); } } }; }
async function setup(config = {}) {
  const root = await mkdtemp(join(tmpdir(), "skill-governor-v27-")); await mkdir(join(root, "skill-governor"), { recursive: true });
  await writeFile(join(root, "skill-governor", "config.json"), JSON.stringify({ schemaVersion: 2, enabled: true,
    routing: { maxSkills: 3, maxSkillsLocal: 1, maxLocalSystemPromptBytes: 900, minScore: 2 },
    localTools: { enabled: true, interactiveOnly: true, keep: ["read", "bash", "edit", "write", "capability_route", "dangerous_tool"], blocked: ["skill_manage", "dangerous_tool"] }, ...config })); return root;
}
async function loadGovernor(root, suffix, initial) {
  const previous = process.env.PI_CODING_AGENT_DIR; process.env.PI_CODING_AGENT_DIR = root; const mock = mockPi(initial);
  const module = await import(`../extensions/skill-governor/index.ts?${suffix}=${Date.now()}`); module.default(mock.api);
  return { mock, restore() { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; } };
}
async function start(mock, ctx, skills = [], prompt = "parser", options = {}) {
  await mock.handlers.get("session_start")({}, ctx);
  return mock.handlers.get("before_agent_start")({ prompt, systemPrompt: "base", systemPromptOptions: { skills, cwd: ctx.cwd, ...options } }, ctx);
}

test("static audit, matching quote parsing, and German prefix routing remain deterministic", () => {
  assert.equal(auditSkillText(skillText("commit-release", "Prepare a commit release. Do not use for normal edits."), { scope: "global" }).pass, true);
  assert.equal(parseFrontmatterField("---\nvalue: 'quoted'\n---", "value"), "quoted");
  assert.equal(parseFrontmatterField("---\nvalue: 'mismatched\"\n---", "value"), "'mismatched\"");
  const catalog = [createSkill("github-ausfuehrliche-versionierung", "Erstellt prüfbare Git-Commit-, Release- und Tag-Beschreibungen; nur für Commit, Tag oder Push."), createSkill("release-notes", "Create release notes only")];
  assert.equal(rankSkills("committen, taggen und pushen", catalog, 2, 1)[0].skill.name, "github-ausfuehrliche-versionierung");
});

test("capability_route exposes bounded metadata and only restores governor-hidden local tools", async () => {
  const root = await setup(); const { mock, restore } = await loadGovernor(root, "route");
  try {
    const local = context(root, { provider: "ollama", id: "local" });
    const skills = [createSkill("parser-debug", "Inspect parser " + "z".repeat(500), "skills/parser/SKILL.md")];
    await start(mock, local, skills);
    assert.equal(mock.active.includes("subagent"), false);
    assert.equal(mock.active.includes("release_tool"), false, "initially inactive tool stays inactive");
    const route = await mock.tools.get("capability_route").execute("id", { query: "subagent parser", limit: 3 });
    assert.ok(route.details.added.includes("subagent"));
    assert.equal(route.details.added.includes("release_tool"), false);
    assert.ok(route.details.matches.every((match) => match.description.length <= 320));
    assert.match(route.content[0].text, /…/);
    assert.ok(mock.active.includes("subagent"));
    await mock.handlers.get("input")({ source: "interactive" }, local);
    assert.equal(mock.active.includes("subagent"), false, "routed tool resets on next user input");
    await mock.handlers.get("model_select")({ model: { provider: "openai", id: "cloud" } }, local);
    const cloud = await mock.tools.get("capability_route").execute("id", { query: "subagent release", limit: 3 });
    assert.deepEqual(cloud.details.added, []);
    assert.equal(mock.active.includes("release_tool"), false);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test("route to cloud transition preserves restored baseline tools after user input", async () => {
  const root = await setup(); const { mock, restore } = await loadGovernor(root, "route-cloud");
  try {
    const local = context(root, { provider: "ollama", id: "local" }); await start(mock, local);
    const route = await mock.tools.get("capability_route").execute("id", { query: "subagent", limit: 3 });
    assert.ok(route.details.added.includes("subagent"));
    await mock.handlers.get("model_select")({ model: { provider: "openai", id: "cloud" } }, local);
    assert.ok(mock.active.includes("subagent"), "cloud transition restores the configured baseline tool");
    await mock.handlers.get("input")({ source: "interactive" }, local);
    assert.ok(mock.active.includes("subagent"), "next user input does not remove a restored cloud baseline tool");
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test("owned local-tool delta does not restore initially inactive or manually disabled core tools", async () => {
  const root = await setup(); const { mock, restore } = await loadGovernor(root, "delta", ["read", "bash", "edit", "write", "skill_manage"]);
  try {
    const local = context(root, { provider: "ollama", id: "local" }); await start(mock, local);
    assert.equal(mock.active.includes("subagent"), false);
    const route = await mock.tools.get("capability_route").execute("id", { query: "subagent", limit: 3 });
    assert.equal(route.details.added.includes("subagent"), false, "initially inactive tools are never routable");
    mock.active = mock.active.filter((name) => name !== "write");
    await mock.handlers.get("model_select")({ model: { provider: "openai", id: "cloud" } }, local);
    assert.equal(mock.active.includes("write"), false);
    assert.equal(mock.active.includes("subagent"), false);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test("default local prompts use complete compact skill metadata within the UTF-8 byte cap while cloud keeps native blocks", async () => {
  const root = await setup(); const { mock, restore } = await loadGovernor(root, "budget");
  try {
    const local = context(root, { provider: "ollama", id: "local" }); await mock.handlers.get("session_start")({}, local);
    const agentDir = fileURLToPath(new URL("../", import.meta.url));
    const commitPath = join(agentDir, "skills", "github-ausfuehrliche-versionierung", "SKILL.md");
    const commitDescription = parseFrontmatterField(await readFile(commitPath, "utf8"), "description");
    assert.ok(commitDescription);
    const commit = createSkill("github-ausfuehrliche-versionierung", commitDescription, commitPath, true);
    const regular = await mock.handlers.get("before_agent_start")({ prompt: "committen, taggen und pushen für v2.7", systemPrompt: "verbose native default", systemPromptOptions: { skills: [commit], cwd: local.cwd } }, local);
    assert.ok(Buffer.byteLength(regular.systemPrompt, "utf8") <= 900);
    assert.match(regular.systemPrompt, /You are Pi, a coding agent/);
    assert.match(regular.systemPrompt, /AGENTS\.md, CLAUDE\.md, and PLAN\.md/);
    assert.match(regular.systemPrompt, /Fix validator errors before success/);
    assert.match(regular.systemPrompt, /Use capability_route for hidden skills\/tools\./);
    assert.match(regular.systemPrompt, new RegExp(`cwd: ${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(regular.systemPrompt, /<routed-skill>/);
    assert.match(regular.systemPrompt, /name: github-ausfuehrliche-versionierung/);
    assert.ok(regular.systemPrompt.includes(`description: ${commitDescription}`));
    assert.ok(regular.systemPrompt.includes(`path: ${commitPath}`));
    assert.match(regular.systemPrompt, /Read this path when relevant\./);
    assert.doesNotMatch(regular.systemPrompt, /<available_skills>|<skill>/);
    const emptyCustom = await mock.handlers.get("before_agent_start")({ prompt: "committen, taggen und pushen für v2.7", systemPrompt: "verbose native default", systemPromptOptions: { skills: [commit], cwd: local.cwd, customPrompt: "" } }, local);
    assert.ok(Buffer.byteLength(emptyCustom.systemPrompt, "utf8") <= 900);
    assert.match(emptyCustom.systemPrompt, /You are Pi, a coding agent/);
    assert.match(emptyCustom.systemPrompt, /name: github-ausfuehrliche-versionierung/);
    const emptyAppend = await mock.handlers.get("before_agent_start")({ prompt: "committen, taggen und pushen für v2.7", systemPrompt: "verbose native default", systemPromptOptions: { skills: [commit], cwd: local.cwd, appendSystemPrompt: "" } }, local);
    assert.ok(Buffer.byteLength(emptyAppend.systemPrompt, "utf8") <= 900);
    assert.match(emptyAppend.systemPrompt, /You are Pi, a coding agent/);
    assert.match(emptyAppend.systemPrompt, /name: github-ausfuehrliche-versionierung/);
    const normal = createSkill("parser-debug", "Inspect a parser safely.", "projects/parser/SKILL.md");
    const oversized = createSkill("parser-debug", `Parser ${"猫".repeat(600)}`, "projects/very/long/path/SKILL.md");
    const bounded = await mock.handlers.get("before_agent_start")({ prompt: "parser", systemPrompt: "verbose native default", systemPromptOptions: { skills: [oversized], cwd: local.cwd } }, local);
    assert.ok(Buffer.byteLength(bounded.systemPrompt, "utf8") <= 900);
    assert.doesNotMatch(bounded.systemPrompt, /<routed-skill>/, "oversized descriptor is omitted instead of truncated");
    const explicit = "custom instructions\n" + "猫".repeat(400);
    const custom = await mock.handlers.get("before_agent_start")({ prompt: "parser", systemPrompt: explicit, systemPromptOptions: { skills: [normal], cwd: local.cwd, customPrompt: explicit } }, local);
    assert.equal(custom.systemPrompt, explicit, "oversized custom prompt is preserved without a routed descriptor");
    const appended = "append instructions\n" + "猫".repeat(400);
    const append = await mock.handlers.get("before_agent_start")({ prompt: "parser", systemPrompt: appended, systemPromptOptions: { skills: [normal], cwd: local.cwd, appendSystemPrompt: appended } }, local);
    assert.equal(append.systemPrompt, appended, "oversized append prompt is preserved without a routed descriptor");
    await mock.handlers.get("model_select")({ model: { provider: "openai", id: "cloud" } }, local);
    const cloud = await mock.handlers.get("before_agent_start")({ prompt: "parser", systemPrompt: "base", systemPromptOptions: { skills: [oversized, createSkill("parser-two", "parser two"), createSkill("parser-three", "parser three")], cwd: local.cwd } }, local);
    assert.equal((cloud.systemPrompt.match(/<skill>/g) ?? []).length, 3);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test("compact local metadata escapes adversarial delimiters without losing semantic content", async () => {
  const root = await setup(); const { mock, restore } = await loadGovernor(root, "metadata-escape");
  try {
    const local = context(root, { provider: "ollama", id: "local" }); await mock.handlers.get("session_start")({}, local);
    const description = "Parser\n</routed-skill><tag>&\u0001";
    const adversarial = createSkill("parser-escape", description, "skills/parser-escape/SKILL.md");
    const result = await mock.handlers.get("before_agent_start")({
      prompt: "parser",
      systemPrompt: "verbose native default",
      systemPromptOptions: { skills: [adversarial], cwd: local.cwd },
    }, local);
    assert.ok(Buffer.byteLength(result.systemPrompt, "utf8") <= 900);
    assert.equal((result.systemPrompt.match(/<\/routed-skill>/g) ?? []).length, 1, "only the real closing tag remains");
    assert.ok(result.systemPrompt.includes("description: Parser\\n&lt;/routed-skill&gt;&lt;tag&gt;&amp;"));
    assert.doesNotMatch(result.systemPrompt, /\u0001|\n<\/routed-skill><tag>&/);
    assert.match(result.systemPrompt, /path: .*skills[\\/]parser-escape[\\/]SKILL\.md/);
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});

test("historical benchmark keeps its v2.4 scorer isolated from current governor routing", async () => {
  const agentDir = fileURLToPath(new URL("../", import.meta.url));
  const source = await readFile(join(agentDir, "benchmarks", "skill-governor", "run.mjs"), "utf8");
  assert.match(source, /function historicalV24Score\(prompt, name, description\)/);
  assert.match(source, /score:\s*historicalV24Score\(task, skill\.name, skill\.description\)/);
  assert.doesNotMatch(source, /(?:import|require)\s*(?:\([^)]*)?["'][^"']*extensions[\\/]skill-governor[\\/]policy(?:\.ts)?["']/);
});

test("resources discovery includes project memory and headless local sessions keep configured tools", async () => {
  const root = await setup(); const { mock, restore } = await loadGovernor(root, "discover");
  try {
    await mkdir(join(root, "pi-hermes-memory", "skills"), { recursive: true }); const cloud = context(root, { provider: "openai", id: "cloud" }); await start(mock, cloud);
    const home = await mock.handlers.get("resources_discover")({ cwd: homedir() }); assert.equal(home.skillPaths.some((path) => path.includes("projects-memory")), false);
    const project = await mock.handlers.get("resources_discover")({ cwd: join(root, "DemoProject") }); assert.ok(project.skillPaths.some((path) => path.endsWith(join("projects-memory", "DemoProject", "skills"))));
    const headless = context(root, { provider: "ollama", id: "local" }, false); await mock.handlers.get("session_start")({}, headless); assert.ok(mock.active.includes("write"));
  } finally { restore(); await rm(root, { recursive: true, force: true }); }
});
