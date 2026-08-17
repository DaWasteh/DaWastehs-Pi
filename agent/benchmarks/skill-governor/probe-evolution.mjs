import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { criticizeCandidate, generateCandidate } from "../../extensions/skill-governor/llm.ts";
import { auditSkillText, buildSkillMarkdown, DEFAULT_GOVERNOR_CONFIG, slugifySkillName } from "../../extensions/skill-governor/policy.ts";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const AGENT = join(REPO, "agent");
const output = process.argv[2]
  ? resolve(process.argv[2])
  : join(AGENT, "benchmarks", "skill-governor", "results", "evolution-probe.json");

const runtime = await ModelRuntime.create({
  authPath: join(AGENT, "auth.json"),
  modelsPath: join(AGENT, "models.json"),
  modelsStorePath: join(AGENT, "models-store.json"),
});
const registry = new ModelRegistry(runtime);
const generatorModel = registry.find("openai-codex", "gpt-5.6-terra");
if (!generatorModel) throw new Error("Generator model unavailable");
const ctx = { model: generatorModel, modelRegistry: registry };
const config = structuredClone(DEFAULT_GOVERNOR_CONFIG);

const source = {
  projectName: "SyntheticMigrationFixture",
  userPrompt: "Repair the project-specific scorecard migration so it changes only the diagnostics envelope, preserves every official score field and exact requested path, and proves idempotence without a full repository release.",
  assistantSummary: "Implemented raw JSON envelope mutation, canonical before/after comparison excluding only diagnostics fields, and a second-run zero-write check. No dependencies or release actions changed.",
  observation: {
    userPrompt: "synthetic fixture",
    toolCalls: 9,
    toolTypes: new Set(["read", "edit", "bash"]),
    skillReads: new Set(),
    changedFiles: new Set(["tools/migrate-scorecards.py", "tests/test_migration.py"]),
    commands: ["python -m pytest tests/test_migration.py -q"],
    toolErrors: 0,
    completed: true,
    startedAt: Date.now(),
  },
};

const generated = await generateCandidate(ctx, config, source);
if (generated.candidate.skip) throw new Error(`Generator skipped the probe: ${generated.candidate.reason ?? "no reason"}`);
const candidate = generated.candidate;
const markdown = buildSkillMarkdown({
  name: slugifySkillName(candidate.name),
  description: candidate.description,
  whenToUse: candidate.whenToUse,
  procedureSteps: candidate.procedureSteps,
  pitfalls: candidate.pitfalls ?? [],
  verificationSteps: candidate.verificationSteps,
  tier: "quarantine",
  risk: "medium",
});
const audit = auditSkillText(markdown, { scope: candidate.scope, maxChars: config.evolution.maxCandidateChars });
if (!audit.pass) throw new Error(`Generated candidate failed static audit: ${audit.findings.filter((item) => item.severity === "error").map((item) => item.code).join(", ")}`);
const critic = await criticizeCandidate(ctx, config, markdown, [], undefined);
if (!critic.model || !critic.decision) throw new Error("Critic result is incomplete");
const result = {
  generatedAt: new Date().toISOString(),
  generatorModel: generated.model,
  criticModel: critic.model,
  candidate: { name: candidate.name, description: candidate.description, scope: candidate.scope },
  staticAudit: { pass: audit.pass, score: audit.score, risk: audit.inferredRisk, findings: audit.findings.map((item) => item.code) },
  critic,
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
