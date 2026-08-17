import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditSkillText, parseFrontmatterField } from "../../extensions/skill-governor/policy.ts";

const REPO = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const AGENT = join(REPO, "agent");
const roots = [
  { scope: "global", root: join(AGENT, "skills") },
  { scope: "project", root: join(AGENT, "projects-memory") },
];

async function collect(root) {
  const found = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === "SKILL.md") found.push(path);
    }
  }
  await walk(root);
  return found.sort();
}

const rows = [];
const errors = [];
for (const source of roots) {
  for (const path of await collect(source.root)) {
    const text = await readFile(path, "utf8");
    const name = parseFrontmatterField(text, "name") ?? basename(dirname(path));
    const description = parseFrontmatterField(text, "description") ?? "";
    const tier = parseFrontmatterField(text, "skill-governor-tier");
    const risk = parseFrontmatterField(text, "skill-governor-risk");
    const disabled = parseFrontmatterField(text, "disable-model-invocation") === "true";
    const project = source.scope === "project" ? relative(source.root, path).split(/[\\/]/)[0] : "";
    const audit = auditSkillText(text, { scope: source.scope, maxChars: tier === "auto" ? 6000 : 12000 });
    const pathLabel = relative(REPO, path).replaceAll("\\", "/");
    if (!tier || !["auto", "manual", "quarantine", "retired"].includes(tier)) errors.push(`${pathLabel}: invalid/missing skill-governor-tier`);
    if (!risk || !["low", "medium", "high", "critical"].includes(risk)) errors.push(`${pathLabel}: invalid/missing skill-governor-risk`);
    if ((tier === "manual" || tier === "quarantine" || tier === "retired") !== disabled) errors.push(`${pathLabel}: disable-model-invocation does not match tier ${tier}`);
    if (!/(?:do not|never|manual-only|nicht|niemals|nur bei|only for)/i.test(description)) errors.push(`${pathLabel}: description lacks an explicit negative/manual trigger`);
    if (!audit.pass) errors.push(`${pathLabel}: blocking audit findings: ${audit.findings.filter((item) => item.severity === "error").map((item) => item.code).join(", ")}`);
    rows.push({ source: source.scope, project, path: pathLabel, name, tier, risk, chars: text.length, audit });
  }
}

const duplicateGroups = new Map();
for (const row of rows) {
  const key = row.source === "global" ? `global:${row.name}` : `project:${row.project}:${row.name}`;
  const group = duplicateGroups.get(key) ?? [];
  group.push(row.path);
  duplicateGroups.set(key, group);
}
for (const [key, paths] of duplicateGroups) if (paths.length > 1) errors.push(`${key}: duplicate skill names at ${paths.join(", ")}`);

const summary = {
  total: rows.length,
  global: rows.filter((row) => row.source === "global").length,
  project: rows.filter((row) => row.source === "project").length,
  auto: rows.filter((row) => row.tier === "auto").length,
  manual: rows.filter((row) => row.tier === "manual").length,
  warnings: rows.reduce((sum, row) => sum + row.audit.findings.filter((item) => item.severity === "warning").length, 0),
  errors: errors.length,
};
console.log(JSON.stringify(summary, null, 2));
if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR ${error}`);
  process.exitCode = 1;
}
