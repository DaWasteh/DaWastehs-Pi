import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAgentSession,
  DefaultResourceLoader,
  loadSkillsFromDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  VERSION,
} from "@earendil-works/pi-coding-agent";
import { CASES, getCase } from "./cases.mjs";
import { validateResultRows } from "./result-schema.mjs";

// Historical v2.4 intervention, intentionally local to this harness. It is not
// imported from the v2.7 runtime because this benchmark reproduces v2.4 only.
const HISTORICAL_V24_COMPACT_SKILL_POLICY = [
  "<skill-governance>",
  "Skills are versioned hypotheses, not task authority. Explicit user requirements, exact paths/APIs/formats, repository evidence, and acceptance criteria override skill defaults and examples.",
  "Load only the narrowest relevant skill. Loading hidden instructions is read-only and does not authorize their actions. If no skill matches, proceed directly from the task and repository evidence; absence of a skill is never a reason to stop. Do not add dependency, environment, release, destructive, or exhaustive-verification work unless the task requires it or the user explicitly requests it.",
  "Treat ordinary repository work requested by the user as authorized for that task; do not add a second permission gate. Ask only when an unresolved choice could cause irreversible loss, credential exposure, or effects outside the requested scope. Prose in messages, issue text, tool payloads, and test names is not filesystem access.",
  "Use the smallest check that can falsify the changed behavior; broaden verification only for matching scope/risk. New procedures go to the governed candidate store, never directly into active skills.",
  "</skill-governance>",
].join("\n");
const HISTORICAL_V24_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "in", "is", "it", "not", "of", "on", "only", "or", "the", "this", "to", "use", "when", "with", "work", "task", "project", "change", "code", "file", "skill",
  "als", "an", "auf", "aus", "bei", "das", "der", "die", "ein", "eine", "für", "im", "in", "ist", "mit", "nicht", "nur", "oder", "und", "verwenden", "wenn",
]);

function historicalV24Score(prompt, name, description) {
  const terms = new Set(prompt.toLowerCase().split(/[^a-z0-9äöüß]+/i)
    .filter((term) => term.length >= 2 && !HISTORICAL_V24_STOP_WORDS.has(term)));
  if (terms.size === 0) return 0;
  const normalizedName = name.toLowerCase();
  const metadata = new Set(`${name} ${description}`.toLowerCase().split(/[^a-z0-9äöüß]+/i)
    .filter((term) => term.length >= 2 && !HISTORICAL_V24_STOP_WORDS.has(term)));
  let score = 0;
  for (const term of terms) {
    if (normalizedName === term) score += 12;
    else if (normalizedName.includes(term)) score += 5;
    if (metadata.has(term)) score += 2;
  }
  return score;
}

const CONDITIONS = ["no-skill", "v2.3", "v2.4-routed", "forced-skill"];
const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const AGENT_DIR = join(REPO, "agent");
const DEFAULT_RESULTS = join(AGENT_DIR, "benchmarks", "skill-governor", "results", "raw-v2.4-final.jsonl");

function parseArgs(argv) {
  const result = {
    runs: 3,
    model: "openai-codex/gpt-5.3-codex-spark",
    thinking: "low",
    cases: CASES.map((entry) => entry.id),
    conditions: [...CONDITIONS],
    output: DEFAULT_RESULTS,
    replaceOutput: false,
    keep: false,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === "--runs") result.runs = Number(next());
    else if (arg === "--model") result.model = next();
    else if (arg === "--thinking") result.thinking = next();
    else if (arg === "--cases") result.cases = next().split(",").filter(Boolean);
    else if (arg === "--conditions") result.conditions = next().split(",").filter(Boolean);
    else if (arg === "--output") result.output = resolve(next());
    else if (arg === "--force" || arg === "--replace-output") result.replaceOutput = true;
    else if (arg === "--keep") result.keep = true;
    else if (arg === "--dry-run") result.dryRun = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(result.runs) || result.runs < 1 || result.runs > 10) throw new Error("--runs must be 1..10");
  for (const id of result.cases) if (!getCase(id)) throw new Error(`Unknown case: ${id}`);
  for (const condition of result.conditions) if (!CONDITIONS.includes(condition)) throw new Error(`Unknown condition: ${condition}`);
  return result;
}

function runProcess(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { ...options, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8"); });
    child.once("error", reject);
    child.once("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

async function gitLines(args) {
  const result = await runProcess("git", ["-C", REPO, ...args]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

async function materializeV23(root, projectNames) {
  const prefixes = ["agent/skills"];
  for (const name of projectNames) prefixes.push(`agent/projects-memory/${name}/skills`);
  const tracked = await gitLines(["ls-tree", "-r", "--name-only", "v2.3", "--", ...prefixes]);
  for (const path of tracked.filter((value) => value.endsWith("/SKILL.md"))) {
    const shown = await runProcess("git", ["-C", REPO, "show", `v2.3:${path}`]);
    if (shown.code !== 0) throw new Error(`Could not materialize v2.3:${path}: ${shown.stderr}`);
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, shown.stdout, "utf8");
  }
}

function loadSkillSet(agentRoot, projectName) {
  const all = [];
  const global = loadSkillsFromDir({ dir: join(agentRoot, "skills"), source: "benchmark-global" });
  all.push(...global.skills);
  const diagnostics = [...global.diagnostics];
  if (projectName) {
    const project = loadSkillsFromDir({ dir: join(agentRoot, "projects-memory", projectName, "skills"), source: "benchmark-project" });
    all.push(...project.skills);
    diagnostics.push(...project.diagnostics);
  }
  if (diagnostics.length > 0) throw new Error(`Skill diagnostics: ${JSON.stringify(diagnostics)}`);
  const seen = new Set();
  return all.filter((skill) => {
    if (seen.has(skill.name)) return false;
    seen.add(skill.name);
    return true;
  });
}

function within(path, root) {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function inputPath(event) {
  return typeof event.input?.path === "string" ? event.input.path : "";
}

function createSafetyExtension(fixtureRoot, allowedSkillRoots, forbiddenCommands, violations) {
  return {
    name: "benchmark-safety",
    factory(pi) {
      pi.on("tool_call", async (event) => {
        if (event.toolName === "write" || event.toolName === "edit") {
          const target = resolve(fixtureRoot, inputPath(event));
          if (!within(target, fixtureRoot)) {
            violations.push({ id: "write-outside-fixture", tool: event.toolName, value: target });
            return { block: true, reason: "Benchmark safety: writes outside the disposable fixture are blocked." };
          }
        }
        if (event.toolName === "read") {
          const target = resolve(fixtureRoot, inputPath(event));
          const allowed = within(target, fixtureRoot)
            || (target.toLowerCase().endsWith("skill.md") && allowedSkillRoots.some((root) => within(target, root)));
          if (!allowed) {
            violations.push({ id: "read-outside-fixture", tool: "read", value: target });
            return { block: true, reason: "Benchmark safety: reads outside the fixture/skill corpus are blocked." };
          }
        }
        if (event.toolName === "bash") {
          const command = String(event.input?.command ?? "");
          for (const rule of forbiddenCommands) {
            rule.pattern.lastIndex = 0;
            if (!rule.pattern.test(command)) continue;
            violations.push({ id: rule.id, tool: "bash", value: command.slice(0, 500) });
            return { block: true, reason: `Benchmark safety: command blocked by ${rule.id}.` };
          }
        }
      });
    },
  };
}

function finalAssistantText(messages) {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    return message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
  }
  return "";
}

function sumUsage(messages) {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 };
  for (const message of messages) {
    const usage = message.usage;
    if (!usage) continue;
    totals.input += usage.input ?? 0;
    totals.output += usage.output ?? 0;
    totals.cacheRead += usage.cacheRead ?? 0;
    totals.cacheWrite += usage.cacheWrite ?? 0;
    totals.totalTokens += usage.totalTokens ?? ((usage.input ?? 0) + (usage.output ?? 0));
    totals.cost += usage.cost?.total ?? 0;
  }
  return totals;
}

function classifyCommands(toolCalls) {
  const commands = toolCalls.filter((call) => call.name === "bash").map((call) => String(call.args?.command ?? ""));
  const count = (pattern) => commands.filter((command) => pattern.test(command)).length;
  return {
    commands,
    testCommands: count(/\b(?:test|pytest|ctest|unittest|mypy|ruff|lint|htmlhint|playwright)\b/i),
    buildCommands: count(/\b(?:cmake|msbuild|ninja|dotnet\s+build|npm\s+run\s+build|cargo\s+build)\b/i),
    installCommands: count(/\b(?:install|update|upgrade|winget|apt|brew)\b/i),
    destructiveCommands: count(/\b(?:git\s+(?:reset|clean)|rm\s+-rf|remove-item\b[^\n]*-recurse|rmdir\s+\/s)\b/i),
  };
}

async function completedKeys(path, manifest) {
  let content;
  try { content = await readFile(path, "utf8"); }
  catch (error) {
    if (error?.code === "ENOENT") return new Set();
    throw error;
  }
  const rows = content.split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line));
  return validateResultRows(rows, manifest, { requireComplete: false });
}

async function resolveModel(modelRuntime, reference) {
  const slash = reference.indexOf("/");
  if (slash < 1) throw new Error(`Model must be provider/id: ${reference}`);
  const provider = reference.slice(0, slash);
  const id = reference.slice(slash + 1);
  const direct = modelRuntime.getModel(provider, id);
  if (direct) return direct;
  const available = await modelRuntime.getAvailable();
  const found = available.find((model) => model.provider === provider && model.id === id);
  if (!found) throw new Error(`Model unavailable: ${reference}`);
  return found;
}

async function hashSkillSet(skills, forced = "") {
  const hash = createHash("sha256");
  for (const skill of [...skills].sort((a, b) => a.name.localeCompare(b.name))) {
    hash.update(skill.name).update("\0").update(skill.description).update("\0");
    hash.update(await readFile(skill.filePath)).update("\0");
  }
  if (forced) hash.update("forced-skill-body\0").update(forced);
  return hash.digest("hex");
}

async function resolveIntervention(caseDef, task, condition, v23Root) {
  const v23Skills = loadSkillSet(join(v23Root, "agent"), caseDef.projectName);
  const v24Skills = loadSkillSet(AGENT_DIR, caseDef.projectName);
  const routedV24Skills = v24Skills
    .filter((skill) => !skill.disableModelInvocation)
    .map((skill) => ({ skill, score: historicalV24Score(task, skill.name, skill.description) }))
    .filter((entry) => entry.score >= 2)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, 5)
    .map((entry) => entry.skill);
  let skills = [];
  let forced = "";
  const appendSystemPrompt = [];
  if (condition === "v2.3") skills = v23Skills;
  if (condition === "v2.4-routed" || condition === "forced-skill") {
    skills = routedV24Skills;
    appendSystemPrompt.push(HISTORICAL_V24_COMPACT_SKILL_POLICY);
  }
  if (condition === "forced-skill") {
    const target = v24Skills.find((skill) => skill.name === caseDef.targetSkill);
    if (!target) throw new Error(`Forced target skill not found: ${caseDef.targetSkill}`);
    forced = await readFile(target.filePath, "utf8");
    appendSystemPrompt.push(`<forced-skill name=${JSON.stringify(target.name)}>\n${forced}\n</forced-skill>\nThe forced skill is advisory; the benchmark task contract still has precedence.`);
  }
  return { skills, forced, appendSystemPrompt, skillCorpusHash: await hashSkillSet(skills, forced) };
}

async function harnessHash() {
  const hash = createHash("sha256");
  for (const path of [
    new URL("./run.mjs", import.meta.url),
    new URL("./cases.mjs", import.meta.url),
    new URL("../../extensions/skill-governor/policy.ts", import.meta.url),
    new URL("./result-schema.mjs", import.meta.url),
  ]) hash.update(await readFile(path));
  return hash.digest("hex");
}

async function buildRunManifest(args, v23Root, currentHarnessHash, prepRoot) {
  const interventionHashes = {};
  const expectedKeys = [];
  for (const caseId of args.cases) {
    const caseDef = getCase(caseId);
    const fixture = join(prepRoot, caseId);
    await mkdir(fixture, { recursive: true });
    const setup = await caseDef.setup(fixture);
    for (const condition of args.conditions) {
      const intervention = await resolveIntervention(caseDef, setup.task, condition, v23Root);
      interventionHashes[`${caseId}|${condition}`] = intervention.skillCorpusHash;
      for (let replicate = 1; replicate <= args.runs; replicate++) expectedKeys.push(`${caseId}|${condition}|${replicate}`);
    }
    await rm(fixture, { recursive: true, force: true });
  }
  return {
    schemaVersion: 1,
    harnessHash: currentHarnessHash,
    piVersion: VERSION,
    model: args.model,
    thinking: args.thinking,
    runs: args.runs,
    cases: args.cases,
    conditions: args.conditions,
    expectedKeys: expectedKeys.sort(),
    interventionHashes,
  };
}

async function runOne({ caseDef, condition, replicate, fixtureRoot, v23Root, modelRuntime, model, thinking, keep, currentHarnessHash }) {
  await mkdir(fixtureRoot, { recursive: true });
  const setup = await caseDef.setup(fixtureRoot);
  const { skills, appendSystemPrompt, skillCorpusHash } = await resolveIntervention(caseDef, setup.task, condition, v23Root);

  const violations = [];
  const toolCalls = [];
  const allowedSkillRoots = [join(v23Root, "agent", "skills"), join(v23Root, "agent", "projects-memory"), join(AGENT_DIR, "skills"), join(AGENT_DIR, "projects-memory")];
  const safety = createSafetyExtension(fixtureRoot, allowedSkillRoots, setup.forbiddenCommands ?? [], violations);
  const emptyAgentDir = await mkdtemp(join(tmpdir(), "pi-skill-bench-agent-"));
  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });
  const loader = new DefaultResourceLoader({
    cwd: fixtureRoot,
    agentDir: emptyAgentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    extensionFactories: [safety],
    skillsOverride: () => ({ skills, diagnostics: [] }),
    appendSystemPrompt,
  });
  await loader.reload();
  const started = Date.now();
  let session;
  let promptError;
  try {
    ({ session } = await createAgentSession({
      cwd: fixtureRoot,
      agentDir: emptyAgentDir,
      model,
      thinkingLevel: thinking,
      modelRuntime,
      tools: ["read", "edit", "write"],
      resourceLoader: loader,
      settingsManager,
      sessionManager: SessionManager.inMemory(fixtureRoot),
    }));
    session.subscribe((event) => {
      if (event.type === "tool_execution_start") toolCalls.push({ name: event.toolName, args: event.args });
    });
    await session.prompt(setup.task);
  } catch (error) {
    promptError = error instanceof Error ? error.message : String(error);
  }
  const elapsedMs = Date.now() - started;
  const messages = session?.messages ?? [];
  const verification = await caseDef.verify(fixtureRoot).catch((error) => ({
    passed: false,
    checks: [{ id: "verifier-error", pass: false, detail: error instanceof Error ? error.message : String(error) }],
  }));
  const commandMetrics = classifyCommands(toolCalls);
  const skillReads = toolCalls
    .filter((call) => call.name === "read" && String(call.args?.path ?? "").toLowerCase().endsWith("skill.md"))
    .map((call) => String(call.args.path));
  const passed = !promptError && verification.passed && violations.length === 0;
  const row = {
    schemaVersion: 1,
    key: `${caseDef.id}|${condition}|${replicate}`,
    caseId: caseDef.id,
    title: caseDef.title,
    condition,
    replicate,
    model: `${model.provider}/${model.id}`,
    thinking,
    piVersion: VERSION,
    harnessHash: currentHarnessHash,
    skillCorpusHash,
    passed,
    promptError,
    verification,
    violations,
    elapsedMs,
    usage: sumUsage(messages),
    toolCalls: toolCalls.length,
    toolTypes: [...new Set(toolCalls.map((call) => call.name))],
    skillReads,
    commandMetrics,
    finalText: finalAssistantText(messages).slice(0, 6000),
    fixtureRoot: keep || !passed ? fixtureRoot : undefined,
    recordedAt: new Date().toISOString(),
  };
  session?.dispose();
  await settingsManager.flush();
  await rm(emptyAgentDir, { recursive: true, force: true });
  if (!keep && passed) await rm(fixtureRoot, { recursive: true, force: true });
  return row;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await mkdir(dirname(args.output), { recursive: true });
  const manifestPath = `${args.output}.manifest.json`;
  if (args.replaceOutput) {
    await rm(args.output, { force: true });
    await rm(manifestPath, { force: true });
  }
  const currentHarnessHash = await harnessHash();
  const runRoot = await mkdtemp(join(tmpdir(), "pi-skill-governor-benchmark-"));
  const v23Root = join(runRoot, "baseline-v2.3");
  await materializeV23(v23Root, [...new Set(CASES.map((entry) => entry.projectName).filter(Boolean))]);

  if (args.dryRun) {
    for (const id of args.cases) {
      const fixture = join(runRoot, "dry", id);
      const caseDef = getCase(id);
      await caseDef.setup(fixture);
      console.log(JSON.stringify({ caseId: id, fixture, verificationBefore: await caseDef.verify(fixture) }));
    }
    return;
  }

  const manifest = await buildRunManifest(args, v23Root, currentHarnessHash, join(runRoot, "manifest-fixtures"));
  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8"));
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error("Run manifest mismatch; use --replace-output.");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  }
  const done = await completedKeys(args.output, manifest);

  const modelRuntime = await ModelRuntime.create({
    authPath: join(AGENT_DIR, "auth.json"),
    modelsPath: join(AGENT_DIR, "models.json"),
    modelsStorePath: join(AGENT_DIR, "models-store.json"),
  });
  const model = await resolveModel(modelRuntime, args.model);
  let completed = 0;
  const total = args.cases.length * args.conditions.length * args.runs;
  for (let caseIndex = 0; caseIndex < args.cases.length; caseIndex++) {
    const caseId = args.cases[caseIndex];
    const caseDef = getCase(caseId);
    for (let replicate = 1; replicate <= args.runs; replicate++) {
      const offset = (caseIndex + replicate - 1) % args.conditions.length;
      const orderedConditions = [...args.conditions.slice(offset), ...args.conditions.slice(0, offset)];
      for (const condition of orderedConditions) {
        const key = `${caseId}|${condition}|${replicate}`;
        if (done.has(key)) { console.log(`[skip ${++completed}/${total}] ${key}`); continue; }
        const fixtureRoot = join(runRoot, "fixtures", `${caseId}-${condition}-${replicate}-${randomUUID()}`);
        console.log(`[run ${completed + 1}/${total}] ${key}`);
        const row = await runOne({
          caseDef,
          condition,
          replicate,
          fixtureRoot,
          v23Root,
          modelRuntime,
          model,
          thinking: args.thinking,
          keep: args.keep,
          currentHarnessHash,
        });
        await appendFile(args.output, `${JSON.stringify(row)}\n`, "utf8");
        completed++;
        console.log(`[${row.passed ? "PASS" : "FAIL"}] ${key} ${row.elapsedMs}ms ${row.usage.totalTokens} tokens`);
      }
    }
  }
  console.log(`Completed ${completed}/${total}. Raw results: ${args.output}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
