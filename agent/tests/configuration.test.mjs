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
    teamleiter: ["openai-codex/gpt-5.6-sol", "high"],
    mechanic: ["openai-codex/gpt-5.3-codex-spark", "low"],
    bugtester: ["openai-codex/gpt-5.3-codex-spark", "low"],
    "web-searcher": ["openai-codex/gpt-5.6-luna", "low"],
  };
  for (const [name, [model, thinking]] of Object.entries(expected)) {
    const source = await readAgent(`agents/${name}.md`);
    assert.doesNotMatch(source, /^model:|^thinking:/m, `${name} duplicates central routing`);
    assert.equal(settings.subagents.agentOverrides[name].model, model);
    assert.equal(settings.subagents.agentOverrides[name].thinking, thinking);
  }

  const lead = await readAgent("agents/teamleiter.md");
  assert.match(lead, /Delegiere nicht automatisch/);
  assert.doesNotMatch(lead, /genau zwei ausführbare Subagents/);
});

test("the real catalog routes German commit/tag/push work to the manual release skill", async () => {
  const root = fileURLToPath(agentUrl);
  const catalog = [...loadSkillsFromDir({ dir: resolve(root, "skills"), source: "global" }).skills];
  const projectsRoot = resolve(root, "projects-memory");
  for (const entry of await readdir(projectsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    catalog.push(...loadSkillsFromDir({ dir: resolve(projectsRoot, entry.name, "skills"), source: entry.name }).skills);
  }
  assert.ok(catalog.length >= 85);
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
