import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateResultRows } from "./result-schema.mjs";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const DEFAULT_INPUT = resolve(REPO, "agent/benchmarks/skill-governor/results/raw-v2.4-final.jsonl");
const DEFAULT_OUTPUT = resolve(REPO, "agent/benchmarks/skill-governor/reports/v2.4-benchmark.md");
const DEFAULT_EVOLUTION_PROBE = resolve(REPO, "agent/benchmarks/skill-governor/results/evolution-probe.json");

function args(argv) {
  const options = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input") options.input = resolve(argv[++i]);
    else if (argv[i] === "--output") options.output = resolve(argv[++i]);
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fmt(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return "n/a";
  return Number(value).toFixed(digits);
}

function summarize(rows) {
  return {
    runs: rows.length,
    passed: rows.filter((row) => row.passed).length,
    passRate: rows.length ? rows.filter((row) => row.passed).length / rows.length : 0,
    tokens: median(rows.map((row) => row.usage?.totalTokens ?? 0)),
    cost: median(rows.map((row) => row.usage?.cost ?? 0)),
    elapsedMs: median(rows.map((row) => row.elapsedMs ?? 0)),
    tools: median(rows.map((row) => row.toolCalls ?? 0)),
    skillReads: rows.reduce((sum, row) => sum + (row.skillReads?.length ?? 0), 0),
    runsWithSkillReads: rows.filter((row) => (row.skillReads?.length ?? 0) > 0).length,
    tests: median(rows.map((row) => row.commandMetrics?.testCommands ?? 0)),
    builds: median(rows.map((row) => row.commandMetrics?.buildCommands ?? 0)),
    violations: rows.reduce((sum, row) => sum + (row.violations?.length ?? 0), 0),
  };
}

function ratio(a, b) {
  return b > 0 ? a / b : null;
}

async function main() {
  const options = args(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(`${options.input}.manifest.json`, "utf8"));
  const rawBytes = await readFile(options.input);
  const rawSha256 = createHash("sha256").update(rawBytes).digest("hex");
  const latest = new Map();
  for (const line of rawBytes.toString("utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (latest.has(row.key)) throw new Error(`Duplicate immutable result key: ${row.key}`);
    latest.set(row.key, row);
  }
  const rows = [...latest.values()].sort((a, b) => a.key.localeCompare(b.key));
  const publicRows = rows.map((row) => ({
    key: row.key,
    caseId: row.caseId,
    condition: row.condition,
    replicate: row.replicate,
    model: row.model,
    thinking: row.thinking,
    piVersion: row.piVersion,
    harnessHash: row.harnessHash,
    skillCorpusHash: row.skillCorpusHash,
    passed: row.passed,
    verification: row.verification,
    violations: row.violations,
    elapsedMs: row.elapsedMs,
    usage: row.usage,
    toolCalls: row.toolCalls,
    toolTypes: row.toolTypes,
    skillReads: (row.skillReads ?? []).map((path) => {
      const parts = String(path).replaceAll("\\", "/").split("/");
      return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
    }),
  }));
  const publicBytes = Buffer.from(`${JSON.stringify(publicRows, null, 2)}\n`, "utf8");
  const publicSha256 = createHash("sha256").update(publicBytes).digest("hex");
  const publicOutput = options.output.replace(/\.md$/i, "-runs.json");
  const conditions = manifest.conditions;
  validateResultRows(rows, manifest, { requireComplete: true });
  const caseIds = [...new Set(rows.map((row) => row.caseId))].sort();
  const byCondition = Object.fromEntries(conditions.map((condition) => [condition, summarize(rows.filter((row) => row.condition === condition))]));

  const functional = [];
  const efficiency = [];
  for (const caseId of caseIds) {
    const replicates = [...new Set(rows.filter((row) => row.caseId === caseId).map((row) => row.replicate))];
    for (const replicate of replicates) {
      const get = (condition) => rows.find((row) => row.caseId === caseId && row.replicate === replicate && row.condition === condition);
      const baseline = get("no-skill");
      if (!baseline) continue;
      for (const condition of ["v2.3", "v2.4-routed", "forced-skill"]) {
        const target = get(condition);
        if (!target) continue;
        if (baseline.passed && !target.passed) functional.push({ caseId, replicate, condition });
        if (baseline.passed && target.passed) {
          const tokenRatio = ratio(target.usage?.totalTokens ?? 0, baseline.usage?.totalTokens ?? 0);
          const timeRatio = ratio(target.elapsedMs ?? 0, baseline.elapsedMs ?? 0);
          if (tokenRatio > 1 && timeRatio > 1 && Math.max(tokenRatio, timeRatio) > 2) {
            efficiency.push({ caseId, replicate, condition, tokenRatio, timeRatio });
          }
        }
      }
    }
  }

  const lines = [
    "# Pi skill-governor v2.4 differential benchmark",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Design",
    "",
    "Eight deterministic disposable fixtures are executed three times per condition with the same model, thinking level, three file tools (`read`, `edit`, `write`), and verifier. Condition order is deterministically rotated by case/replicate. Conditions vary only the skill metadata/policy: no skills, the v2.3 skill snapshot, the v2.4 task-routed auto metadata plus compact policy, or one forced v2.4 target body. The full governor runtime/evolution is validated separately by unit/integration tests and the evolution probe; this table is not a complete lifecycle benchmark. Fresh fixtures expose no shell or symlink-creation tool, and file-tool paths are confined to the fixture/read-only skill corpus.",
    "",
    `Raw JSONL SHA-256: \`${rawSha256}\``,
    `Published redacted run table SHA-256: \`${publicSha256}\``,
    `Harness hash: \`${[...new Set(rows.map((row) => row.harnessHash))].join(", ")}\``,
    `Pi version: \`${[...new Set(rows.map((row) => row.piVersion))].join(", ")}\``,
    `Intervention corpus hashes: \`${createHash("sha256").update(JSON.stringify(manifest.interventionHashes)).digest("hex")}\``,
    "",
    "## Aggregate results",
    "",
    "| Condition | Runs | Pass | Pass rate | Median tokens | Median cost | Median time (s) | Median tools | Skill reads (runs) | Violations |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const condition of conditions) {
    const value = byCondition[condition];
    lines.push(`| ${condition} | ${value.runs} | ${value.passed} | ${fmt(value.passRate * 100, 1)}% | ${fmt(value.tokens)} | $${fmt(value.cost, 4)} | ${fmt(value.elapsedMs / 1000, 1)} | ${fmt(value.tools, 1)} | ${value.skillReads} (${value.runsWithSkillReads}) | ${value.violations} |`);
  }

  const tokenDelta = ratio(byCondition["v2.4-routed"].tokens, byCondition["v2.3"].tokens);
  const timeDelta = ratio(byCondition["v2.4-routed"].elapsedMs, byCondition["v2.3"].elapsedMs);
  const costDelta = ratio(byCondition["v2.4-routed"].cost, byCondition["v2.3"].cost);
  lines.push(
    "",
    "## v2.4 routed metadata/policy versus v2.3 metadata",
    "",
    `- Pass rate: **${fmt(byCondition["v2.3"].passRate * 100, 1)}% → ${fmt(byCondition["v2.4-routed"].passRate * 100, 1)}%**`,
    `- Median total tokens: **${fmt(byCondition["v2.3"].tokens)} → ${fmt(byCondition["v2.4-routed"].tokens)}** (${tokenDelta === null ? "n/a" : `${fmt((tokenDelta - 1) * 100, 1)}%`})`,
    `- Median reported cost: **$${fmt(byCondition["v2.3"].cost, 4)} → $${fmt(byCondition["v2.4-routed"].cost, 4)}** (${costDelta === null ? "n/a" : `${fmt((costDelta - 1) * 100, 1)}%`})`,
    `- Median elapsed time: **${fmt(byCondition["v2.3"].elapsedMs / 1000, 1)}s → ${fmt(byCondition["v2.4-routed"].elapsedMs / 1000, 1)}s** (${timeDelta === null ? "n/a" : `${fmt((timeDelta - 1) * 100, 1)}%`}); wall time is notably stochastic`,
    `- Median token overhead versus no-skill remains **${fmt((byCondition["v2.4-routed"].tokens / byCondition["no-skill"].tokens - 1) * 100, 1)}%**`,
    "",
  );

  lines.push("## Per-case pass rates", "", "| Case | no-skill | v2.3 | v2.4-routed | forced-skill |", "|---|---:|---:|---:|---:|");
  for (const caseId of caseIds) {
    const cells = conditions.map((condition) => {
      const summary = summarize(rows.filter((row) => row.caseId === caseId && row.condition === condition));
      return summary.runs ? `${summary.passed}/${summary.runs}` : "n/a";
    });
    lines.push(`| ${caseId} | ${cells.join(" | ")} |`);
  }

  const efficiencyByCondition = Object.fromEntries(conditions.map((condition) => [condition, efficiency.filter((item) => item.condition === condition).length]));
  lines.push(
    "",
    "## Differential triage",
    "",
    `- Functional regressions versus a passing no-skill replicate: **${functional.length}**`,
    `- Paper-style 2× efficiency threshold flags (both token/time increase; one >2× versus no-skill): **${efficiency.length}**`,
    `- Flags by condition: v2.3 **${efficiencyByCondition["v2.3"]}**, v2.4-routed **${efficiencyByCondition["v2.4-routed"]}**, forced-skill **${efficiencyByCondition["forced-skill"]}**`,
    "- These are deterministic threshold flags, not confidence intervals or proof of causal safety.",
  );
  if (functional.length) {
    lines.push("", "### Functional", "");
    for (const item of functional) lines.push(`- ${item.caseId} run ${item.replicate}: ${item.condition}`);
  }
  if (efficiency.length) {
    lines.push("", "### Efficiency", "");
    for (const item of efficiency) lines.push(`- ${item.caseId} run ${item.replicate}: ${item.condition}, tokens ${fmt(item.tokenRatio, 2)}×, time ${fmt(item.timeRatio, 2)}×`);
  }

  try {
    const probe = JSON.parse(await readFile(DEFAULT_EVOLUTION_PROBE, "utf8"));
    lines.push(
      "",
      "## Evolution pipeline probe",
      "",
      `- Generator: **${probe.generatorModel}**`,
      `- Independent critic: **${probe.criticModel}**`,
      `- Quarantined proposal: **${probe.candidate?.name ?? "n/a"}** (${probe.candidate?.scope ?? "n/a"})`,
      `- Static audit: **${probe.staticAudit?.pass ? "PASS" : "BLOCK"}**, score ${probe.staticAudit?.score ?? "n/a"}, inferred risk ${probe.staticAudit?.risk ?? "n/a"}`,
      `- Critic: **${String(probe.critic?.decision ?? "n/a").toUpperCase()}**, risk ${probe.critic?.risk ?? "n/a"}, confidence ${probe.critic?.confidence ?? "n/a"}`,
    );
  } catch {
    lines.push("", "## Evolution pipeline probe", "", "Not run for this report.");
  }

  lines.push(
    "",
    "## Limitations",
    "",
    "- These fixtures are controlled regressions, not proof that every future task is safe.",
    "- Model runs remain stochastic; three repeats reduce but do not remove variance.",
    "- Verifiers cover explicit task contracts and observable commands, not every semantic quality dimension.",
    "- The paper's benchmark thresholds are reported for comparison and are not treated as universal production limits.",
    "- Primary-method references: arXiv:2608.11888 (differential skill-failure triage) and arXiv:2608.12851 (skill lifecycle governance/misevolution).",
    "",
  );
  await mkdir(dirname(options.output), { recursive: true });
  await Promise.all([
    writeFile(options.output, lines.join("\n"), "utf8"),
    writeFile(publicOutput, publicBytes),
  ]);
  console.log(`Wrote ${options.output} and ${publicOutput} from ${rows.length} unique runs.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
