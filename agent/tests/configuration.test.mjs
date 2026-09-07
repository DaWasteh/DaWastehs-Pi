import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { rankSkills } from "../extensions/skill-governor/policy.ts";

const agentUrl = new URL("../", import.meta.url);

async function readAgent(path) {
  return readFile(new URL(path, agentUrl), "utf8");
}

test("compaction remains viable for the llama provider's 128k fallback window", async () => {
  const settings = JSON.parse(await readAgent("settings.json"));
  assert.deepEqual(settings.compaction, {
    enabled: true,
    reserveTokens: 32_768,
    keepRecentTokens: 32_768,
  });
  assert.ok(settings.compaction.keepRecentTokens < 128_000 - settings.compaction.reserveTokens);
  assert.deepEqual(settings.thinkingBudgets, {
    minimal: 1_024,
    low: 4_096,
    medium: 10_240,
    high: 32_768,
  });
  assert.equal(settings.modelThinkingLevels["llama-server=http://127.0.0.1:1234/Qwen3.8-27B"], "medium");
  assert.equal(settings.modelThinkingLevels["llama-server=http://127.0.0.1:1234/Qwen3.8-Flash-Next"], "medium");
});

test("custom roles keep model routing in settings as the single source of truth", async () => {
  const settings = JSON.parse(await readAgent("settings.json"));
  const expected = {
    teamleiter: ["openai-codex/gpt-6-astra", "high"],
    planner: ["openai-codex/gpt-6-astra", "high"],
    mechanic: ["openai-codex/gpt-5.6-terra", "medium"],
    bugtester: ["openai-codex/gpt-5.6-sol", "high"],
    "web-searcher": ["openai-codex/gpt-5.6-luna", "low"],
  };
  const toolsets = {
    planner: ["read", "grep", "find", "ls"],
    bugtester: ["read", "grep", "find", "ls", "bash"],
    mechanic: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    teamleiter: ["read", "grep", "find", "ls"],
    "web-searcher": ["web_search", "fetch_content", "get_search_content", "source_check", "read", "grep", "find", "ls"],
  };
  for (const [name, [model, thinking]] of Object.entries(expected)) {
    const source = await readAgent(`agents/${name}.md`);
    assert.doesNotMatch(source, /^model:|^thinking:/m, `${name} duplicates central routing`);
    assert.deepEqual(source.match(/^tools: (.+)$/m)[1].split(/,\s*/), toolsets[name]);
    assert.match(source, /^systemPromptMode: append$/m);
    assert.match(source, /^defaultContext: fresh$/m);
    assert.match(source, new RegExp(`^acceptanceRole: ${name === "mechanic" ? "writer" : "read-only"}$`, "m"));
    assert.doesNotMatch(source, /128k|Spark|müssen mit `rtk` präfixiert/);
    assert.equal(settings.subagents.agentOverrides[name].model, model);
    assert.equal(settings.subagents.agentOverrides[name].thinking, thinking);
  }

  const lead = await readAgent("agents/teamleiter.md");
  assert.match(lead, /Delegiere nicht automatisch/);
  assert.doesNotMatch(lead, /genau zwei ausführbare Subagents/);
  assert.match(lead, /bis zu zwei unabhängige Teilaufträge/);
  assert.match(lead, /Der Parent allein startet Mitarbeiter/);
  assert.match(lead, /starte keine eigenen Subagents/);
  assert.match(lead, /ohne Modelle oder Thinking pro Lauf vorzugeben/);
});

test("flat teamleiter requires completed evidence and cannot launch children or shell commands", async () => {
  const source = await readAgent("agents/teamleiter.md");
  const tools = source.match(/^tools: (.+)$/m)[1].split(/,\s*/);
  assert.deepEqual(tools, ["read", "grep", "find", "ls"]);
  assert.doesNotMatch(source, /^allowNestedSubagents: true$|^maxSubagentDepth:/m);
  assert.match(source, /Fehlende, fehlgeschlagene oder nur gestartete Mitarbeiter/);
  assert.match(source, /Keine Erfolgsaussage ohne Ergebnisse/);
  assert.match(source, /Originalquellen/);
  assert.match(source, /keine eigenen Wiederholungen/);
});

test("Astra owns critical roles; automatic routing never chooses Spark or absent fallbacks", async () => {
  const settings = JSON.parse(await readAgent("settings.json"));
  assert.equal(settings.defaultProvider, "openai-codex");
  assert.equal(settings.defaultModel, "gpt-6-astra");
  assert.equal(settings.defaultThinkingLevel, "high");
  assert.equal(settings.modelThinkingLevels["openai-codex/gpt-6-astra"], "high");
  assert.equal(settings.subagents.defaultModel, "openai-codex/gpt-5.6-terra");
  assert.equal(settings.subagents.defaultThinking, "medium");
  const overrides = settings.subagents.agentOverrides;
  for (const name of ["oracle", "planner", "reviewer", "teamleiter"]) {
    assert.equal(overrides[name].model, "openai-codex/gpt-6-astra");
    assert.equal(overrides[name].thinking, "high");
  }
  for (const name of ["worker", "mechanic", "researcher", "delegate"]) {
    assert.equal(overrides[name].model, "openai-codex/gpt-5.6-terra");
    assert.equal(overrides[name].thinking, "medium");
  }
  assert.equal(overrides.scout.model, "openai-codex/gpt-5.6-luna");
  assert.equal(overrides.scout.thinking, "low");
  for (const name of ["worker", "scout", "reviewer", "researcher", "delegate"]) {
    assert.equal(overrides[name].defaultContext, "fresh");
  }
  assert.equal(overrides.oracle.defaultContext, undefined, "preserve builtin oracle fork preference");
  assert.equal(overrides.advisor, undefined, "route advisor through canonical oracle");
  assert.equal(overrides["context-builder"], undefined, "do not configure a nonexistent role");
  const builtins = new Set(["oracle", "worker", "scout", "reviewer", "researcher", "delegate"]);
  for (const name of Object.keys(overrides)) {
    if (!builtins.has(name)) assert.match(await readAgent(`agents/${name}.md`), new RegExp(`^name: ${name}$`, "m"));
  }
  assert.doesNotMatch(JSON.stringify(settings.subagents), /spark|fallbackModels|"fast":true/i);
});

test("web search is headless, source-grounded and does not grant a shell", async () => {
  const source = await readAgent("agents/web-searcher.md");
  const tools = source.match(/^tools: (.+)$/m)[1].split(/,\s*/);
  for (const name of ["web_search", "fetch_content", "get_search_content", "source_check", "read"]) {
    assert.ok(tools.includes(name), `missing ${name}`);
  }
  for (const name of ["bash", "edit", "write", "subagent"]) assert.ok(!tools.includes(name));
  assert.match(source, /workflow: "none"/);
  assert.match(source, /findText/);
  assert.match(source, /keine Secrets oder privaten Repository-Inhalte/);
  assert.match(source, /keine Quellen erfinden/);
  assert.match(source, /Erfinde kein Veröffentlichungs- oder Abrufdatum/);
  assert.match(source, /lasse das Datum weg oder markiere es als unbekannt/);
  assert.match(source, /Archivseiten nicht als aktuellste Dokumentation/);
});

test("runtime fanout defaults are bounded and in the native config, not Pi role settings", async () => {
  const settings = JSON.parse(await readAgent("settings.json"));
  const config = JSON.parse(await readAgent("extensions/subagent/config.json"));
  assert.deepEqual(config, {
    asyncByDefault: true,
    globalConcurrencyLimit: 4,
    maxSubagentSpawnsPerRun: 12,
    maxActiveAsyncRunsPerSession: 2,
    maxSubagentDepth: 1,
  });
  for (const name of Object.keys(config)) assert.equal(settings.subagents[name], undefined);
});

test("the real catalog routes German commit/tag/push work to the manual release skill", async () => {
  const root = fileURLToPath(agentUrl);
  const catalog = [...loadSkillsFromDir({ dir: resolve(root, "skills"), source: "global" }).skills];
  const projectsRoot = resolve(root, "projects-memory");
  for (const entry of await readdir(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    catalog.push(...loadSkillsFromDir({ dir: resolve(projectsRoot, entry.name, "skills"), source: entry.name }).skills);
  }
  // v2.8 retired five completed or tool-less skills and moved unreachable project keys.
  assert.ok(catalog.length >= 80);
  const [first] = rankSkills("committen, taggen und pushen für v2.7", catalog, 2, 5);
  assert.equal(first.skill.name, "github-ausfuehrliche-versionierung");
  assert.equal(first.skill.disableModelInvocation, true);
});

test("runtime npm installs use Pi's host-peer strategy reproducibly", async () => {
  const npmrc = await readAgent("npm/.npmrc");
  const ignore = await readAgent("npm/.gitignore");
  assert.match(npmrc, /^legacy-peer-deps=true$/m);
  assert.match(ignore, /^!\.npmrc$/m);
});

test("the plan template uses PLAN.md without claiming session branches restore files", async () => {
  const template = await readAgent("prompts/plan.md");
  for (const section of ["Goal", "Constraints", "Steps", "Decisions", "Verification", "Blockers"]) {
    assert.match(template, new RegExp(`\\b${section}\\b`));
  }
  assert.match(template, /session branches change conversation context but do not restore shared files/);
  assert.match(template, /exactly one step may be `\[>\]`/);
});
