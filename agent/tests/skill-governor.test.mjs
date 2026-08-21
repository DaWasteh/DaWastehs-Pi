import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  applyDeleteOnlyRepair,
  auditSkillText,
  buildSkillMarkdown,
} from "../extensions/skill-governor/policy.ts";
import { parseCriticResult, redactForModel } from "../extensions/skill-governor/llm.ts";
import {
  hasExplicitGovernanceMutationIntent,
  parseGovernanceAuthorization,
} from "../extensions/skill-governor/index.ts";
import {
  addPairedEvidence,
  addPairedEvidenceBatch,
  attachCriticResult,
  createGovernorPaths,
  ensureGovernorLayout,
  listCandidates,
  loadCandidate,
  promoteCandidate,
  recordEvolutionObservation,
  resetEvolutionObservation,
  retireActiveSkill,
  rollbackRetirement,
  saveCandidate,
} from "../extensions/skill-governor/store.ts";

function safeSkill(overrides = {}) {
  return buildSkillMarkdown({
    name: "targeted-parser-debug",
    description: "Debug one parser failure when its deterministic fixture fails. Do not use for releases or dependency updates.",
    whenToUse: "Use only for a reproducible parser fixture failure. Do not use for unrelated repository cleanup.",
    procedureSteps: [
      "Extract the explicit task paths and expected parse result before editing.",
      "Inspect the failing parser and the directly relevant fixture.",
      "Apply the smallest complete fix; explicit task requirements override examples.",
    ],
    pitfalls: ["Do not replace repository dependencies or broaden the task."],
    verificationSteps: ["Run the directly failing parser fixture once and stop when it passes."],
    tier: "quarantine",
    risk: "low",
    ...overrides,
  });
}

test("static audit blocks durable destructive and secret-bearing policy", () => {
  const safe = auditSkillText(safeSkill(), { scope: "project" });
  assert.equal(safe.pass, true);
  assert.ok(safe.score >= 70);

  const destructive = safeSkill({
    procedureSteps: ["Run git reset --hard and git clean -fdx before every repair."],
  });
  const destructiveAudit = auditSkillText(destructive, { scope: "project" });
  assert.equal(destructiveAudit.pass, false);
  assert.ok(destructiveAudit.findings.some((finding) => finding.code === "destructive-delete"));

  const secret = safeSkill({
    pitfalls: ["Use token=abcdefghijklmnop to contact the service."],
  });
  const secretAudit = auditSkillText(secret, { scope: "project" });
  assert.equal(secretAudit.pass, false);
  assert.ok(secretAudit.findings.some((finding) => finding.code === "secret-assignment"));

  for (const instruction of [
    "Do not forget to run git reset --hard before editing.",
    "Never mind, run git reset --hard now.",
    "Do not wait, run git reset --hard now.",
    "Run rm -rf build only when requested.",
    "Run rm -fr build.",
    "Run rm -r -f build.",
  ]) {
    const bypassAudit = auditSkillText(safeSkill({ procedureSteps: [instruction] }), { scope: "project" });
    assert.equal(bypassAudit.pass, false, instruction);
    assert.ok(bypassAudit.findings.some((finding) => finding.code === "destructive-delete"));
  }
  const prohibitedAudit = auditSkillText(safeSkill({ pitfalls: ["Do not run git reset --hard."] }), { scope: "project" });
  assert.equal(prohibitedAudit.findings.some((finding) => finding.code === "destructive-delete"), false);
});

test("delete-only repair is exact, subtractive, and section-safe", () => {
  const original = safeSkill({
    procedureSteps: [
      "Inspect the failing fixture.",
      "Run the full test suite for every one-line change.",
      "Apply the smallest complete fix.",
    ],
  });
  const repaired = applyDeleteOnlyRepair(original, ["2. Run the full test suite for every one-line change.\n"]);
  assert.equal(repaired.error, undefined);
  assert.ok(repaired.text.length < original.length);
  assert.doesNotMatch(repaired.text, /full test suite/);
  assert.match(repaired.text, /^## Procedure/m);
  assert.match(repaired.text, /^## Verification/m);

  const ambiguous = applyDeleteOnlyRepair(`${original}\nrepeat\nrepeat\n`, ["repeat"]);
  assert.match(ambiguous.error, /ambiguous/);
  const frontmatter = applyDeleteOnlyRepair(original, ["skill-governor-risk: low\n"]);
  assert.match(frontmatter.error, /frontmatter/);
});

test("evolution redaction removes complete, unterminated, and orphan PEM material", () => {
  const body = "A".repeat(120);
  const complete = redactForModel(`before\n-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\nafter`, 1000);
  assert.equal(complete.includes(body), false);
  assert.match(complete, /REDACTED_PRIVATE_KEY/);
  const unterminated = redactForModel(`-----BEGIN OPENSSH PRIVATE KEY-----\n${body}`, 1000);
  assert.equal(unterminated.includes(body), false);
  assert.match(unterminated, /REDACTED_UNTERMINATED/);
  const orphan = redactForModel(`${body}\n-----END PRIVATE KEY-----`, 1000);
  assert.equal(orphan.includes(body), false);
  assert.equal(orphan.includes("END PRIVATE KEY"), false);
});

test("natural-language authority is direct, scope-bound, and quote/meta resistant", () => {
  assert.deepEqual(parseGovernanceAuthorization("Bitte die neue Skill/Guard Architektur verbessern."), { scopes: ["skill-files", "governor-runtime"] });
  assert.deepEqual(parseGovernanceAuthorization("Wir müssen den skill-govenor und die Schutzmechanismen ändern."), { scopes: ["skill-files", "governor-runtime"] });
  assert.deepEqual(parseGovernanceAuthorization("Bitte die Schutzmechanismen lockern."), { scopes: ["governor-runtime"] });
  assert.deepEqual(parseGovernanceAuthorization("Repariere den Soundalarm."), { scopes: ["alarm-extension"] });
  assert.deepEqual(parseGovernanceAuthorization("Please edit the alarm, not the governor."), { scopes: ["alarm-extension"] });
  assert.equal(parseGovernanceAuthorization('Dokumentiere, wie "edit skill permissions" erkannt wird.'), null);
  assert.equal(parseGovernanceAuthorization("Repeat 'edit the governor' exactly."), null);
  assert.equal(parseGovernanceAuthorization("The agent can edit the governor."), null);
  assert.equal(parseGovernanceAuthorization("I refuse to edit the governor."), null);
  assert.equal(parseGovernanceAuthorization("Erkläre, ob man den Governor verbessern sollte."), null);
  assert.equal(parseGovernanceAuthorization("Bitte den Skill nicht ändern."), null);
  assert.equal(parseGovernanceAuthorization("Repariere nur die normalen App-Berechtigungen."), null);
  assert.equal(hasExplicitGovernanceMutationIntent("Verbessere den Guard, aber lösche keine Dateien."), true);
});

test("critic schema fails closed on malformed decisions and repair spans", () => {
  const markdown = safeSkill();
  assert.throws(() => parseCriticResult({ risk: 0, confidence: 1, findings: [], deleteSpans: [] }, "test/critic", markdown), /decision/);
  assert.throws(() => parseCriticResult({ decision: "maybe", risk: 0, confidence: 1, findings: [], deleteSpans: [] }, "test/critic", markdown), /decision/);
  assert.throws(() => parseCriticResult({ decision: "repair", risk: 0.2, confidence: 0.9, findings: [], deleteSpans: [] }, "test/critic", markdown), /delete spans/);
  assert.throws(() => parseCriticResult({ decision: "pass", risk: -1, confidence: 0.9, findings: [], deleteSpans: [] }, "test/critic", markdown), /\[0,1\]/);
  assert.throws(() => parseCriticResult({ decision: "pass", risk: 0, confidence: 99, findings: [], deleteSpans: [] }, "test/critic", markdown), /\[0,1\]/);
  const valid = parseCriticResult({ decision: "pass", risk: 0.1, confidence: 0.95, findings: [], deleteSpans: [], rationale: "ok" }, "test/critic", markdown);
  assert.equal(valid.decision, "pass");
  assert.equal(valid.candidateSha256, auditSkillText(markdown).sha256);
});

test("automatic evolution requires distinct recurrent observations", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-observations-"));
  const paths = createGovernorPaths(agentDir);
  try {
    assert.deepEqual(await recordEvolutionObservation(paths, "fingerprint", "task-a", 3), { count: 1, ready: false });
    assert.deepEqual(await recordEvolutionObservation(paths, "fingerprint", "task-a", 3), { count: 1, ready: false });
    assert.deepEqual(await recordEvolutionObservation(paths, "fingerprint", "task-b", 3), { count: 2, ready: false });
    assert.deepEqual(await recordEvolutionObservation(paths, "fingerprint", "task-c", 3), { count: 3, ready: true });
    await resetEvolutionObservation(paths, "fingerprint");
    assert.deepEqual(await recordEvolutionObservation(paths, "fingerprint", "task-d", 3), { count: 1, ready: false });
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("candidate store keeps quarantine separate and supports reversible retirement", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-store-"));
  const paths = createGovernorPaths(agentDir);
  try {
    await ensureGovernorLayout(paths);
    const generated = {
      name: "targeted-parser-debug",
      description: "Debug one parser failure when its deterministic fixture fails. Do not use for releases or dependency updates.",
      scope: "global",
      whenToUse: "Use only for a reproducible parser fixture failure. Do not use for unrelated repository cleanup.",
      procedureSteps: ["Extract exact requirements.", "Apply the smallest fix."],
      pitfalls: ["Do not change dependencies."],
      verificationSteps: ["Run the directly failing fixture."],
    };
    const markdown = buildSkillMarkdown({ ...generated, tier: "quarantine", risk: "low" });
    const audit = auditSkillText(markdown, { scope: "global" });
    let manifest = await saveCandidate(paths, generated, audit, {
      automatic: false,
      skillLineage: [],
    }, { risk: "low" });

    assert.equal((await listCandidates(paths)).length, 1);
    assert.ok(await loadCandidate(paths, manifest.id));
    const candidateText = (await loadCandidate(paths, manifest.id)).markdown;
    manifest = await attachCriticResult(paths, manifest, {
      decision: "pass",
      risk: 0.05,
      confidence: 0.99,
      findings: [],
      deleteSpans: [],
      rationale: "safe fixture",
      model: "test/critic",
      candidateSha256: auditSkillText(candidateText, { scope: "global" }).sha256,
    });
    const evidence = {
      taskId: "fixture-task-1",
      runId: "run-1",
      evaluator: "test-suite",
      candidateSha256: audit.sha256,
      baselinePassed: true,
      candidatePassed: true,
      utilityDelta: 1,
      tokenRatio: 0.9,
      timeRatio: 0.9,
      recordedAt: new Date().toISOString(),
    };
    manifest = await addPairedEvidence(paths, manifest, evidence);
    await assert.rejects(addPairedEvidence(paths, manifest, evidence), /Duplicate/);
    await assert.rejects(addPairedEvidence(paths, manifest, { ...evidence, taskId: "fixture-task-2", runId: "run-2", candidateSha256: "0".repeat(64) }), /stale candidate digest/);
    await assert.rejects(addPairedEvidenceBatch(paths, manifest, [
      { ...evidence, taskId: "fixture-task-2", runId: "run-2" },
      { ...evidence, taskId: "fixture-task-3", runId: "run-3", candidateSha256: "0".repeat(64) },
    ]), /stale candidate digest/);
    assert.equal((await loadCandidate(paths, manifest.id)).manifest.evidence.length, 1);

    const canary = await promoteCandidate(paths, manifest, "canary");
    assert.equal(canary.status, "canary");
    const activeText = await readFile(canary.promotedPath, "utf8");
    assert.match(activeText, /disable-model-invocation: true/);
    assert.match(activeText, /skill-governor-tier: manual/);

    const active = await promoteCandidate(paths, canary, "active");
    assert.equal(active.status, "active");
    assert.doesNotMatch(await readFile(active.promotedPath, "utf8"), /disable-model-invocation: true/);

    const retired = await retireActiveSkill(paths, active.promotedPath, "test retirement", active);
    assert.equal((await loadCandidate(paths, active.id)).manifest.status, "retired");
    const restored = await rollbackRetirement(paths, retired.retirementId);
    assert.equal(restored, active.promotedPath);
    assert.equal((await loadCandidate(paths, active.id)).manifest.status, "active");
    assert.match(await readFile(restored, "utf8"), /targeted-parser-debug/);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("promotion and retirement roll back injected persistence failures", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-atomic-"));
  const paths = createGovernorPaths(agentDir);
  try {
    const generated = {
      name: "atomic-probe",
      description: "Exercise atomic governor storage. Do not use for real work.",
      scope: "global",
      whenToUse: "Use only in the atomic fixture. Do not use elsewhere.",
      procedureSteps: ["Return the fixture marker."],
      pitfalls: ["Do not mutate unrelated paths."],
      verificationSteps: ["Confirm rollback."],
    };
    const markdown = buildSkillMarkdown({ ...generated, tier: "quarantine", risk: "low" });
    const audit = auditSkillText(markdown, { scope: "global" });
    let manifest = await saveCandidate(paths, generated, audit, { automatic: false, skillLineage: [] }, { risk: "low" });
    manifest = await attachCriticResult(paths, manifest, {
      decision: "pass", risk: 0, confidence: 1, findings: [], deleteSpans: [], rationale: "fixture", model: "test/critic", candidateSha256: audit.sha256,
    });
    await assert.rejects(
      promoteCandidate(paths, manifest, "canary", { afterTargetWrite: async () => { throw new Error("injected promotion failure"); } }),
      /injected promotion failure/,
    );
    await assert.rejects(readFile(join(agentDir, "skills", "atomic-probe", "SKILL.md"), "utf8"), /ENOENT/);

    const activePath = join(agentDir, "skills", "retirement-probe", "SKILL.md");
    await mkdir(dirname(activePath), { recursive: true });
    await writeFile(activePath, safeSkill({ name: "retirement-probe", tier: "manual" }), "utf8");
    await assert.rejects(
      retireActiveSkill(paths, activePath, "fixture", undefined, { afterMetadata: async () => { throw new Error("injected retirement failure"); } }),
      /injected retirement failure/,
    );
    assert.match(await readFile(activePath, "utf8"), /retirement-probe/);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("candidate loading rejects markdown tampering after audit", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-tamper-"));
  const paths = createGovernorPaths(agentDir);
  try {
    const generated = {
      name: "targeted-parser-debug",
      description: "Debug one parser failure when its deterministic fixture fails. Do not use for releases or dependency updates.",
      scope: "global",
      whenToUse: "Use only for a reproducible parser fixture failure. Do not use for unrelated cleanup.",
      procedureSteps: ["Apply the smallest fix."],
      pitfalls: ["Do not change dependencies."],
      verificationSteps: ["Run the failing fixture."],
    };
    const markdown = buildSkillMarkdown({ ...generated, tier: "quarantine", risk: "low" });
    const audit = auditSkillText(markdown, { scope: "global" });
    const manifest = await saveCandidate(paths, generated, audit, { automatic: false, skillLineage: [] }, { risk: "low" });
    const loaded = await loadCandidate(paths, manifest.id);
    await writeFile(join(paths.candidates, manifest.id, "SKILL.md"), `${loaded.markdown}\nTampered.\n`, "utf8");
    assert.equal(await loadCandidate(paths, manifest.id), null);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("canonical containment rejects a governed-path junction into external storage", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-junction-agent-"));
  const outside = await mkdtemp(join(tmpdir(), "skill-governor-junction-outside-"));
  const paths = createGovernorPaths(agentDir);
  try {
    await mkdir(join(agentDir, "skills"), { recursive: true });
    await writeFile(join(outside, "SKILL.md"), safeSkill({ name: "external-skill", tier: "manual" }), "utf8");
    try {
      await symlink(outside, join(agentDir, "skills", "external-skill"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) { t.skip(`symlink unavailable: ${error.code}`); return; }
      throw error;
    }
    await assert.rejects(
      retireActiveSkill(paths, join(agentDir, "skills", "external-skill", "SKILL.md"), "must not follow junction"),
      /external\/package skill/,
    );
  } finally {
    await rm(agentDir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("promotion rejects a root-level skills junction outside agentDir", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-root-junction-agent-"));
  const outside = await mkdtemp(join(tmpdir(), "skill-governor-root-junction-outside-"));
  const paths = createGovernorPaths(agentDir);
  try {
    await mkdir(agentDir, { recursive: true });
    try {
      await symlink(outside, join(agentDir, "skills"), process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) { t.skip(`symlink unavailable: ${error.code}`); return; }
      throw error;
    }
    const generated = {
      name: "root-junction-probe",
      description: "Probe a governed root junction. Do not use for real work.",
      scope: "global",
      whenToUse: "Use only in the containment fixture. Do not use elsewhere.",
      procedureSteps: ["Return the fixture marker."],
      pitfalls: ["Do not mutate external storage."],
      verificationSteps: ["Confirm the marker."],
    };
    const markdown = buildSkillMarkdown({ ...generated, tier: "quarantine", risk: "low" });
    const audit = auditSkillText(markdown, { scope: "global" });
    let manifest = await saveCandidate(paths, generated, audit, { automatic: false, skillLineage: [] }, { risk: "low" });
    manifest = await attachCriticResult(paths, manifest, {
      decision: "pass", risk: 0, confidence: 1, findings: [], deleteSpans: [], rationale: "fixture", model: "test/critic", candidateSha256: audit.sha256,
    });
    await assert.rejects(promoteCandidate(paths, manifest, "canary"), /escapes governed root/);
  } finally {
    await rm(agentDir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("resources_discover activates a fully qualified canary before rescan", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-resource-lifecycle-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  const paths = createGovernorPaths(agentDir);
  try {
    await ensureGovernorLayout(paths);
    await writeFile(paths.config, JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      evolution: { enabled: false },
      promotion: { automaticActive: true, allowedAutomaticRisks: ["low"], maxCriticRisk: 0.2, minCriticConfidence: 0.8, minPairedRuns: 3, requirePositiveUtility: true },
    }), "utf8");
    const generated = {
      name: "qualified-canary",
      description: "Qualified canary lifecycle fixture. Do not use for real work.",
      scope: "global",
      whenToUse: "Use only for the lifecycle fixture. Do not use elsewhere.",
      procedureSteps: ["Return the fixture marker."],
      pitfalls: ["Do not mutate unrelated files."],
      verificationSteps: ["Confirm the marker."],
    };
    const markdown = buildSkillMarkdown({ ...generated, tier: "quarantine", risk: "low" });
    const audit = auditSkillText(markdown, { scope: "global" });
    let manifest = await saveCandidate(paths, generated, audit, { automatic: true, model: "test/generator", skillLineage: [] }, { risk: "low" });
    manifest = await attachCriticResult(paths, manifest, {
      decision: "pass", risk: 0.01, confidence: 0.99, findings: [], deleteSpans: [], rationale: "fixture", model: "test/critic", candidateSha256: audit.sha256,
    });
    manifest = await promoteCandidate(paths, manifest, "canary");
    for (let index = 1; index <= 3; index++) {
      manifest = await addPairedEvidence(paths, manifest, {
        taskId: `task-${index}`,
        runId: `run-${index}`,
        evaluator: "test-suite",
        candidateSha256: audit.sha256,
        baselinePassed: index !== 1,
        candidatePassed: true,
        utilityDelta: index === 1 ? 1 : 0.1,
        tokenRatio: 0.9,
        timeRatio: 0.9,
        recordedAt: new Date().toISOString(),
      });
    }

    const handlers = new Map();
    let activeTools = ["read", "skill_manage"];
    const module = await import(`../extensions/skill-governor/index.ts?lifecycle=${Date.now()}`);
    module.default({
      on(name, handler) { const list = handlers.get(name) ?? []; list.push(handler); handlers.set(name, list); },
      registerTool() {}, registerCommand() {},
      getActiveTools() { return [...activeTools]; }, setActiveTools(names) { activeTools = [...names]; },
      async exec() { return { code: 1, stdout: "", stderr: "not a git repo" }; },
    });
    const context = {
      cwd: agentDir, hasUI: false, mode: "tui", model: undefined,
      modelRegistry: { getAll: () => [] }, sessionManager: { getSessionId: () => "lifecycle" },
      ui: { notify() {}, setStatus() {}, async confirm() { return false; } },
    };
    for (const handler of handlers.get("session_start") ?? []) await handler({ type: "session_start", reason: "startup" }, context);
    const discoveries = handlers.get("resources_discover") ?? [];
    assert.equal(discoveries.length, 1);
    const discovered = await discoveries[0]({ cwd: agentDir, reason: "startup" }, context);
    assert.ok(discovered.skillPaths.some((path) => path.endsWith("skills")));
    const active = await loadCandidate(paths, manifest.id);
    assert.equal(active.manifest.status, "active");
    assert.doesNotMatch(await readFile(active.manifest.promotedPath, "utf8"), /disable-model-invocation: true/);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});

test("extension governs skill lifecycle without intercepting ordinary repository tools", async () => {
  const agentDir = await mkdtemp(join(tmpdir(), "skill-governor-extension-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await mkdir(join(agentDir, "skill-governor"), { recursive: true });
    await writeFile(join(agentDir, "skill-governor", "config.json"), JSON.stringify({
      schemaVersion: 1,
      enabled: true,
      evolution: { enabled: false },
    }), "utf8");
    const autoPath = join(agentDir, "skills", "auto-skill", "SKILL.md");
    const manualPath = join(agentDir, "skills", "manual-skill", "SKILL.md");
    await mkdir(join(agentDir, "skills", "auto-skill"), { recursive: true });
    await mkdir(join(agentDir, "skills", "manual-skill"), { recursive: true });
    await writeFile(autoPath, safeSkill({ name: "auto-skill", tier: "auto" }), "utf8");
    await writeFile(manualPath, safeSkill({ name: "manual-skill", tier: "manual" }), "utf8");

    const handlers = new Map();
    const tools = new Map();
    const commands = new Map();
    let activeTools = ["read", "write", "edit", "bash", "skill_manage"];
    const module = await import(`../extensions/skill-governor/index.ts?test=${Date.now()}`);
    module.default({
      on(name, handler) {
        const list = handlers.get(name) ?? [];
        list.push(handler);
        handlers.set(name, list);
      },
      registerTool(definition) { tools.set(definition.name, definition); },
      registerCommand(name, definition) { commands.set(name, definition); },
      getActiveTools() { return [...activeTools]; },
      setActiveTools(names) { activeTools = [...names]; },
      async exec() { return { code: 1, stdout: "", stderr: "not a git repo" }; },
    });

    const context = {
      cwd: agentDir,
      hasUI: false,
      mode: "tui",
      model: undefined,
      modelRegistry: { getAll: () => [] },
      sessionManager: { getSessionId: () => "test-session" },
      ui: { notify() {}, setStatus() {}, async confirm() { throw new Error("Low-noise governor must not show a confirmation popup"); } },
    };
    for (const handler of handlers.get("session_start") ?? []) {
      await handler({ type: "session_start", reason: "startup" }, context);
    }
    assert.equal(activeTools.includes("skill_manage"), false);
    assert.ok(tools.has("skill_route"));
    assert.ok(tools.has("skill_governor"));
    assert.ok(commands.has("skill-governor"));
    const homeDiscovery = await handlers.get("resources_discover")[0]({ cwd: homedir(), reason: "reload" }, context);
    assert.equal(homeDiscovery.skillPaths.some((path) => path.includes("projects-memory")), false);

    const beforeHandlers = handlers.get("before_agent_start") ?? [];
    assert.equal(beforeHandlers.length, 1);
    const skills = [
      { name: "auto-skill", description: "auto", filePath: autoPath, baseDir: join(agentDir, "skills", "auto-skill"), sourceInfo: { scope: "user" }, disableModelInvocation: false },
      { name: "manual-skill", description: "manual", filePath: manualPath, baseDir: join(agentDir, "skills", "manual-skill"), sourceInfo: { scope: "user" }, disableModelInvocation: true },
    ];
    const original = `base\n\nThe following skills provide specialized instructions for specific tasks.\nUse the read tool to load a skill's file when the task matches its description.\nWhen a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.\n\n<available_skills>\n  <skill><name>auto-skill</name></skill>\n  <skill><name>manual-skill</name></skill>\n</available_skills>`;
    const changed = await beforeHandlers[0]({ prompt: "work on auto skill", systemPrompt: original, systemPromptOptions: { skills } }, context);
    assert.match(changed.systemPrompt, /<name>auto-skill<\/name>/);
    assert.doesNotMatch(changed.systemPrompt, /<name>manual-skill<\/name>/);
    assert.match(changed.systemPrompt, /<skill-governance>/);
    const unrelated = await beforeHandlers[0]({ prompt: "unrelated capability", systemPrompt: original, systemPromptOptions: { skills } }, context);
    assert.doesNotMatch(unrelated.systemPrompt, /<name>(?:auto|manual)-skill<\/name>/);

    const noMatch = await tools.get("skill_route").execute("route", { action: "search", query: "zzzz-no-such-capability" }, undefined, undefined, context);
    assert.deepEqual(noMatch.details.matches, []);

    const toolCall = handlers.get("tool_call")?.[0];
    const blockedMutation = await toolCall({ toolName: "skill_manage", input: { action: "create" } }, context);
    assert.equal(blockedMutation.block, true);
    const blockedRead = await toolCall({ toolName: "read", input: { path: manualPath } }, context);
    assert.equal(blockedRead.block, true);
    const manualLoad = await tools.get("skill_route").execute("route", { action: "load", name: "manual-skill" }, undefined, undefined, context);
    assert.match(manualLoad.content[0].text, /name: "manual-skill"/);
    assert.equal(await toolCall({ toolName: "read", input: { path: manualPath } }, context), undefined);

    assert.equal(await toolCall({ toolName: "bash", input: { command: "rtk grep -n manual skills/manual-skill/SKILL.md" } }, context), undefined);
    for (const command of [
      "rtk rm -rf build",
      "rtk npm install date-fns",
      "rtk git push origin master",
      "rtk node --test tests/skill-governor.test.mjs",
      "rtk grep marker skills/manual-skill/SKILL.md > report.txt",
      "rtk cp skills/manual-skill/SKILL.md backup.md",
    ]) {
      assert.equal(await toolCall({ toolName: "bash", input: { command } }, context), undefined, command);
    }
    for (const command of [
      "echo replacement >skills/manual-skill/SKILL.md",
      "echo replacement >\"skills/manual-skill/SKILL.md\"",
      "rtk cp backup.md skills/manual-skill/SKILL.md",
      "rtk mv skills/manual-skill/SKILL.md backup.md",
      "Copy-Item backup.md skills/manual-skill/SKILL.md",
      "Move-Item skills/manual-skill/SKILL.md backup.md",
      "rtk sed --in-place s/old/new/ skills/manual-skill/SKILL.md",
      "rtk git mv skills/manual-skill/SKILL.md backup.md",
      "rtk git rm skills/manual-skill/SKILL.md",
    ]) {
      const blocked = await toolCall({ toolName: "bash", input: { command } }, context);
      assert.equal(blocked.block, true, command);
      assert.match(blocked.reason, /Shell mutation/);
    }

    const inputHandler = handlers.get("input")?.[0];
    const governorPath = join(agentDir, "extensions", "skill-governor", "index.ts");
    await inputHandler({ source: "interactive", text: "Wir müssen den skill-govenor und die Schutzmechanismen ändern." }, context);
    await inputHandler({ source: "interactive", text: "Hier sind die beobachteten Fehlermeldungen als Zusatzinfo." }, context);
    assert.equal(await toolCall({ toolName: "edit", input: { path: governorPath } }, context), undefined);

    await inputHandler({ source: "interactive", text: "Bitte die Skill/Guard Architektur verbessern." }, context);
    assert.equal(await toolCall({ toolName: "edit", input: { path: manualPath } }, context), undefined);
    const alarmPath = join(agentDir, "extensions", "alarm-sound.ts");
    const wrongScope = await toolCall({ toolName: "edit", input: { path: alarmPath } }, context);
    assert.equal(wrongScope.block, true);
    await inputHandler({ source: "interactive", text: "Bitte den Soundalarm reparieren." }, context);
    assert.equal(await toolCall({ toolName: "edit", input: { path: alarmPath } }, context), undefined);
    assert.equal((await toolCall({ toolName: "edit", input: { path: manualPath } }, context)).block, true);
    const updatePath = join(agentDir, "extensions", "pi-autoupdate.ts");
    assert.equal((await toolCall({ toolName: "edit", input: { path: updatePath } }, context)).block, true);

    await inputHandler({ source: "interactive", text: "Bitte den Skill nicht ändern." }, context);
    assert.equal((await toolCall({ toolName: "edit", input: { path: manualPath } }, context)).block, true);
    const opaqueCalls = [
      { toolName: "intercom", input: { action: "send", message: `edit/write blockiert ${manualPath}` } },
      { toolName: "todo", input: { action: "create", description: `Investigate ${manualPath}` } },
      { toolName: "web_search", input: { query: `Why is ${manualPath} blocked?` } },
      { toolName: "subagent", input: { agent: "reviewer", task: `Review ${manualPath}` } },
      { toolName: "memory_add", input: { target: "project", content: `Path seen: ${manualPath}` } },
      { toolName: "other_tool", input: { path: alarmPath } },
    ];
    for (const call of opaqueCalls) assert.equal(await toolCall(call, context), undefined, call.toolName);

    const sameDriveExternal = join(dirname(agentDir), "external", "projects-memory", "Demo", "skills", "note.txt");
    assert.equal(await toolCall({ toolName: "edit", input: { path: sameDriveExternal } }, context), undefined);
    if (process.platform === "win32") {
      const otherDrive = agentDir[0]?.toLowerCase() === "z" ? "Y" : "Z";
      const externalCwd = `${otherDrive}:\\GitHub\\Auto Tuner`;
      const externalPath = join(externalCwd, "src", "main.py");
      assert.equal(await toolCall({ toolName: "edit", input: { path: externalPath } }, { ...context, cwd: externalCwd }), undefined);
    }

    const extensionContext = { ...context, cwd: join(agentDir, "extensions") };
    assert.equal(await toolCall({ toolName: "other_tool", input: { path: "alarm-sound.ts" } }, extensionContext), undefined);
    assert.equal((await toolCall({ toolName: "bash", input: { command: "rtk sed -i s/old/new/ index.ts" } }, { ...context, cwd: join(agentDir, "extensions", "skill-governor") })).block, true);
    assert.equal((await toolCall({ toolName: "bash", input: { command: "rtk git -C extensions/skill-governor apply fix.patch" } }, context)).block, true);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(agentDir, { recursive: true, force: true });
  }
});
