import { randomUUID } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  CandidateManifest,
  CriticResult,
  GeneratedCandidate,
  GovernorConfig,
  PairedEvidence,
  SkillRisk,
  SkillTier,
  StaticAudit,
} from "./types.ts";
import { auditSkillText, buildSkillMarkdown, DEFAULT_GOVERNOR_CONFIG, parseFrontmatterField, sha256, slugifySkillName } from "./policy.ts";

export interface GovernorPaths {
  agentDir: string;
  root: string;
  config: string;
  candidates: string;
  retired: string;
  evidence: string;
  registry: string;
  observations: string;
}

export function createGovernorPaths(agentDir: string): GovernorPaths {
  const root = join(agentDir, "skill-governor");
  return {
    agentDir,
    root,
    config: join(root, "config.json"),
    candidates: join(root, "candidates"),
    retired: join(root, "retired"),
    evidence: join(root, "evidence.jsonl"),
    registry: join(root, "registry.json"),
    observations: join(root, "observations.json"),
  };
}

function mergeConfig(input: unknown): GovernorConfig {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input as Partial<GovernorConfig>
    : {};
  return {
    ...DEFAULT_GOVERNOR_CONFIG,
    ...raw,
    routing: { ...DEFAULT_GOVERNOR_CONFIG.routing, ...(raw.routing ?? {}) },
    evolution: { ...DEFAULT_GOVERNOR_CONFIG.evolution, ...(raw.evolution ?? {}) },
    promotion: { ...DEFAULT_GOVERNOR_CONFIG.promotion, ...(raw.promotion ?? {}) },
    overrides: { ...DEFAULT_GOVERNOR_CONFIG.overrides, ...(raw.overrides ?? {}) },
    schemaVersion: 1,
  };
}

export async function loadGovernorConfig(paths: GovernorPaths): Promise<GovernorConfig> {
  try {
    return mergeConfig(JSON.parse(await readFile(paths.config, "utf8")));
  } catch {
    return structuredClone(DEFAULT_GOVERNOR_CONFIG);
  }
}

export async function ensureGovernorLayout(paths: GovernorPaths): Promise<void> {
  await assertCanonicalContained(paths.root, paths.agentDir);
  await Promise.all([
    mkdir(paths.root, { recursive: true }),
    mkdir(paths.candidates, { recursive: true }),
    mkdir(paths.retired, { recursive: true }),
  ]);
}

export async function atomicWrite(filePath: string, content: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temp = join(dirname(filePath), `.${basename(filePath)}.tmp-${process.pid}-${randomUUID()}`);
  await writeFile(temp, content, "utf8");
  await rename(temp, filePath);
}

export function assertContained(target: string, root: string): string {
  const normalizedTarget = resolve(target);
  const normalizedRoot = resolve(root);
  const rel = relative(normalizedRoot, normalizedTarget);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return normalizedTarget;
  throw new Error(`Path escapes governed root: ${target}`);
}

async function canonicalTarget(target: string): Promise<string> {
  let cursor = resolve(target);
  const suffix: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(cursor), ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return resolve(target);
      const parent = dirname(cursor);
      if (parent === cursor) return resolve(target);
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

async function assertCanonicalContained(target: string, root: string): Promise<string> {
  const lexical = assertContained(target, root);
  const canonicalRoot = await canonicalTarget(root);
  const canonical = await canonicalTarget(lexical);
  assertContained(canonical, canonicalRoot);
  return lexical;
}

export async function recordEvolutionObservation(
  paths: GovernorPaths,
  fingerprint: string,
  taskHash: string,
  minimum: number,
): Promise<{ count: number; ready: boolean }> {
  await ensureGovernorLayout(paths);
  let state: Record<string, { taskHashes: string[]; lastSeen: string }> = {};
  try {
    const parsed = JSON.parse(await readFile(paths.observations, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) state = parsed;
  } catch { /* first observation */ }
  const current = state[fingerprint] ?? { taskHashes: [], lastSeen: new Date().toISOString() };
  if (!current.taskHashes.includes(taskHash)) current.taskHashes.push(taskHash);
  current.taskHashes = current.taskHashes.slice(-Math.max(minimum * 2, 12));
  current.lastSeen = new Date().toISOString();
  state[fingerprint] = current;
  await atomicWrite(paths.observations, `${JSON.stringify(state, null, 2)}\n`);
  return { count: current.taskHashes.length, ready: current.taskHashes.length >= minimum };
}

export async function resetEvolutionObservation(paths: GovernorPaths, fingerprint: string): Promise<void> {
  let state: Record<string, { taskHashes: string[]; lastSeen: string }> = {};
  try {
    const parsed = JSON.parse(await readFile(paths.observations, "utf8"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) state = parsed;
  } catch { return; }
  delete state[fingerprint];
  await atomicWrite(paths.observations, `${JSON.stringify(state, null, 2)}\n`);
}

export async function appendEvidence(paths: GovernorPaths, event: Record<string, unknown>): Promise<void> {
  await ensureGovernorLayout(paths);
  const record = JSON.stringify({ schemaVersion: 1, at: new Date().toISOString(), ...event });
  await appendFile(paths.evidence, `${record}\n`, { encoding: "utf8" });
}

function isFiniteOptional(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function validateEvidence(value: unknown, candidateSha256: string): value is PairedEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<PairedEvidence>;
  return typeof row.taskId === "string" && row.taskId.length > 0
    && typeof row.runId === "string" && row.runId.length > 0
    && typeof row.evaluator === "string" && row.evaluator.length > 0
    && row.candidateSha256 === candidateSha256
    && typeof row.baselinePassed === "boolean"
    && typeof row.candidatePassed === "boolean"
    && typeof row.recordedAt === "string"
    && isFiniteOptional(row.utilityDelta)
    && isFiniteOptional(row.tokenRatio)
    && isFiniteOptional(row.timeRatio)
    && (row.hardSafetyViolation === undefined || typeof row.hardSafetyViolation === "boolean");
}

function validateManifest(value: unknown, markdown: string): CandidateManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Candidate manifest must be an object.");
  const row = value as CandidateManifest;
  const statuses = new Set(["candidate", "repaired", "rejected", "canary", "active", "retired"]);
  const risks = new Set(["low", "medium", "high", "critical"]);
  if (row.schemaVersion !== 1 || typeof row.id !== "string" || !/^[a-f0-9-]{36}$/i.test(row.id)) throw new Error("Candidate manifest id/schema is invalid.");
  if (!statuses.has(row.status) || !risks.has(row.risk)) throw new Error("Candidate manifest status/risk is invalid.");
  if (typeof row.name !== "string" || typeof row.description !== "string" || (row.scope !== "global" && row.scope !== "project")) throw new Error("Candidate manifest identity is invalid.");
  if (!row.source || typeof row.source !== "object" || !Array.isArray(row.source.skillLineage) || typeof row.source.automatic !== "boolean") throw new Error("Candidate manifest source is invalid.");
  if (!row.staticAudit || row.staticAudit.sha256 !== sha256(markdown)) throw new Error("Candidate markdown no longer matches its static-audit digest.");
  if (row.critic) {
    if (!new Set(["pass", "repair", "reject"]).has(row.critic.decision)
      || typeof row.critic.risk !== "number" || !Number.isFinite(row.critic.risk)
      || typeof row.critic.confidence !== "number" || !Number.isFinite(row.critic.confidence)
      || row.critic.candidateSha256 !== sha256(markdown)) {
      throw new Error("Candidate critic result is invalid or stale.");
    }
  }
  if (!Array.isArray(row.evidence) || !row.evidence.every((item) => validateEvidence(item, sha256(markdown)))) throw new Error("Candidate evidence is invalid or stale.");
  const evidenceKeys = row.evidence.map((item) => `${item.taskId}|${item.runId}`);
  if (new Set(evidenceKeys).size !== evidenceKeys.length) throw new Error("Candidate evidence contains duplicate task/run ids.");
  return row;
}

function rewriteGovernanceFrontmatter(markdown: string, tier: SkillTier, risk: SkillRisk): string {
  if (!markdown.startsWith("---\n")) throw new Error("Candidate is missing frontmatter.");
  const end = markdown.indexOf("\n---", 4);
  if (end < 0) throw new Error("Candidate frontmatter is not closed.");
  const drop = new Set(["skill-governor-tier", "skill-governor-risk", "disable-model-invocation"]);
  const header = markdown.slice(4, end).split(/\r?\n/).filter((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):/);
    return !match || !drop.has(match[1]);
  });
  header.push(`skill-governor-tier: ${tier}`, `skill-governor-risk: ${risk}`);
  if (tier !== "auto") header.push("disable-model-invocation: true");
  return `---\n${header.join("\n")}\n---${markdown.slice(end + 4)}`;
}

function candidateDir(paths: GovernorPaths, id: string): string {
  if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error(`Invalid candidate id: ${id}`);
  return assertContained(join(paths.candidates, id), paths.candidates);
}

export async function saveCandidate(
  paths: GovernorPaths,
  generated: Required<Pick<GeneratedCandidate, "name" | "description" | "scope" | "whenToUse" | "procedureSteps" | "pitfalls" | "verificationSteps">>,
  staticAudit: StaticAudit,
  source: CandidateManifest["source"],
  options: { projectName?: string; tier?: SkillTier; risk?: SkillRisk } = {},
): Promise<CandidateManifest> {
  await ensureGovernorLayout(paths);
  const id = randomUUID();
  const now = new Date().toISOString();
  const name = slugifySkillName(generated.name);
  if (!name) throw new Error("Generated skill name is empty after normalization.");
  const risk = options.risk ?? staticAudit.inferredRisk;
  const markdown = buildSkillMarkdown({
    name,
    description: generated.description,
    whenToUse: generated.whenToUse,
    procedureSteps: generated.procedureSteps,
    pitfalls: generated.pitfalls,
    verificationSteps: generated.verificationSteps,
    tier: options.tier ?? "quarantine",
    risk,
  });
  if (staticAudit.sha256 !== sha256(markdown)) throw new Error("Static audit digest does not match the candidate being saved.");
  const dir = candidateDir(paths, id);
  await assertCanonicalContained(dir, paths.candidates);
  const manifest: CandidateManifest = {
    schemaVersion: 1,
    id,
    name,
    description: generated.description,
    scope: generated.scope,
    projectName: options.projectName,
    status: "candidate",
    risk,
    createdAt: now,
    updatedAt: now,
    source,
    staticAudit,
    repairRounds: 0,
    evidence: [],
  };
  await mkdir(dir, { recursive: false });
  await Promise.all([
    atomicWrite(join(dir, "SKILL.md"), markdown),
    atomicWrite(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`),
  ]);
  await appendEvidence(paths, { type: "candidate_created", candidateId: id, name, automatic: source.automatic });
  return manifest;
}

export async function loadCandidate(paths: GovernorPaths, id: string): Promise<{ manifest: CandidateManifest; markdown: string } | null> {
  try {
    const dir = candidateDir(paths, id);
    await assertCanonicalContained(dir, paths.candidates);
    const [manifestRaw, markdown] = await Promise.all([
      readFile(join(dir, "manifest.json"), "utf8"),
      readFile(join(dir, "SKILL.md"), "utf8"),
    ]);
    return { manifest: validateManifest(JSON.parse(manifestRaw), markdown), markdown };
  } catch {
    return null;
  }
}

export async function updateCandidate(
  paths: GovernorPaths,
  manifest: CandidateManifest,
  updates: Partial<CandidateManifest>,
  markdown?: string,
): Promise<CandidateManifest> {
  const current = await loadCandidate(paths, manifest.id);
  if (!current) throw new Error(`Candidate not found: ${manifest.id}`);
  const next: CandidateManifest = {
    ...current.manifest,
    ...updates,
    id: current.manifest.id,
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
  };
  validateManifest(next, markdown ?? current.markdown);
  const dir = candidateDir(paths, manifest.id);
  await assertCanonicalContained(dir, paths.candidates);
  const writes = [atomicWrite(join(dir, "manifest.json"), `${JSON.stringify(next, null, 2)}\n`)];
  if (markdown !== undefined) writes.push(atomicWrite(join(dir, "SKILL.md"), markdown));
  await Promise.all(writes);
  return next;
}

export async function attachCriticResult(
  paths: GovernorPaths,
  manifest: CandidateManifest,
  critic: CriticResult,
): Promise<CandidateManifest> {
  const status = critic.decision === "reject" ? "rejected" : manifest.status;
  const next = await updateCandidate(paths, manifest, { critic, status });
  await appendEvidence(paths, {
    type: "candidate_critic",
    candidateId: manifest.id,
    decision: critic.decision,
    risk: critic.risk,
    model: critic.model,
  });
  return next;
}

export async function addPairedEvidenceBatch(
  paths: GovernorPaths,
  manifest: CandidateManifest,
  evidence: PairedEvidence[],
): Promise<CandidateManifest> {
  const loaded = await loadCandidate(paths, manifest.id);
  if (!loaded) throw new Error(`Candidate not found: ${manifest.id}`);
  const digest = sha256(loaded.markdown);
  if (evidence.length === 0 || !evidence.every((item) => validateEvidence(item, digest))) {
    throw new Error("Paired evidence is invalid or targets a stale candidate digest.");
  }
  const existingKeys = new Set(loaded.manifest.evidence.map((item) => `${item.taskId}|${item.runId}`));
  const batchKeys = evidence.map((item) => `${item.taskId}|${item.runId}`);
  if (new Set(batchKeys).size !== batchKeys.length || batchKeys.some((key) => existingKeys.has(key))) {
    throw new Error("Duplicate paired evidence task/run id.");
  }
  const next = await updateCandidate(paths, loaded.manifest, { evidence: [...loaded.manifest.evidence, ...evidence] });
  for (const item of evidence) {
    await appendEvidence(paths, { type: "paired_evidence", candidateId: manifest.id, ...item }).catch(() => undefined);
  }
  return next;
}

export async function addPairedEvidence(
  paths: GovernorPaths,
  manifest: CandidateManifest,
  evidence: PairedEvidence,
): Promise<CandidateManifest> {
  return addPairedEvidenceBatch(paths, manifest, [evidence]);
}

export async function listCandidates(paths: GovernorPaths): Promise<CandidateManifest[]> {
  await ensureGovernorLayout(paths);
  const entries = await readdir(paths.candidates, { withFileTypes: true });
  const manifests: CandidateManifest[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const loaded = await loadCandidate(paths, entry.name);
    if (loaded) manifests.push(loaded.manifest);
  }
  return manifests.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function activeSkillPath(paths: GovernorPaths, manifest: CandidateManifest, tier: "canary" | "active"): string {
  const slug = slugifySkillName(manifest.name);
  if (!slug) throw new Error("Candidate has no valid slug.");
  if (manifest.scope === "global") return join(paths.agentDir, "skills", slug, "SKILL.md");
  if (!manifest.projectName) throw new Error("Project candidate is missing projectName.");
  return join(paths.agentDir, "projects-memory", manifest.projectName, "skills", slug, "SKILL.md");
}

export async function promoteCandidate(
  paths: GovernorPaths,
  manifest: CandidateManifest,
  tier: "canary" | "active",
  deps: { afterTargetWrite?: () => Promise<void> } = {},
): Promise<CandidateManifest> {
  const loaded = await loadCandidate(paths, manifest.id);
  if (!loaded) throw new Error(`Candidate not found: ${manifest.id}`);
  const target = activeSkillPath(paths, manifest, tier);
  const activeRoot = manifest.scope === "global"
    ? join(paths.agentDir, "skills")
    : join(paths.agentDir, "projects-memory", manifest.projectName!, "skills");
  await assertCanonicalContained(activeRoot, paths.agentDir);
  await assertCanonicalContained(target, activeRoot);
  let targetExists = false;
  try {
    await stat(target);
    targetExists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const canUpgradeOwnCanary = targetExists
    && tier === "active"
    && manifest.status === "canary"
    && manifest.promotedPath !== undefined
    && resolve(manifest.promotedPath) === resolve(target);
  if (targetExists && !canUpgradeOwnCanary) throw new Error(`Active target already exists: ${target}`);
  const currentAudit = auditSkillText(loaded.markdown, { scope: manifest.scope, maxChars: 12_000 });
  if (!currentAudit.pass || currentAudit.sha256 !== loaded.manifest.staticAudit.sha256) throw new Error("Candidate failed promotion-time audit/digest validation.");
  if (!loaded.manifest.critic || loaded.manifest.critic.decision !== "pass" || loaded.manifest.critic.candidateSha256 !== currentAudit.sha256) throw new Error("Candidate lacks a current passing critic result.");
  const promotedText = rewriteGovernanceFrontmatter(loaded.markdown, tier === "active" ? "auto" : "manual", manifest.risk);
  let previousTarget: string | undefined;
  if (targetExists) previousTarget = await readFile(target, "utf8");
  await atomicWrite(target, promotedText);
  let next: CandidateManifest;
  try {
    await deps.afterTargetWrite?.();
    next = await updateCandidate(paths, loaded.manifest, {
      status: tier,
      promotedPath: target,
    });
  } catch (error) {
    if (previousTarget === undefined) await rm(target, { force: true });
    else await atomicWrite(target, previousTarget);
    throw error;
  }
  await appendEvidence(paths, { type: "candidate_promoted", candidateId: manifest.id, tier, target }).catch(() => undefined);
  return next;
}

export async function retireActiveSkill(
  paths: GovernorPaths,
  skillPath: string,
  reason: string,
  linkedManifest?: CandidateManifest,
  deps: { afterRename?: () => Promise<void>; afterMetadata?: () => Promise<void> } = {},
): Promise<{ retirementId: string; retiredPath: string }> {
  const absolute = assertContained(skillPath, paths.agentDir);
  if (basename(absolute).toLowerCase() !== "skill.md") throw new Error("Only SKILL.md roots can be retired.");
  const canonical = await canonicalTarget(absolute);
  const normalized = canonical.replace(/\\/g, "/").toLowerCase();
  const agentRoot = (await canonicalTarget(paths.agentDir)).replace(/\\/g, "/").toLowerCase();
  const isPiGlobal = normalized.startsWith(`${agentRoot}/skills/`);
  const isHermesGlobal = normalized.startsWith(`${agentRoot}/pi-hermes-memory/skills/`);
  const isProjectSkill = normalized.startsWith(`${agentRoot}/projects-memory/`) && normalized.includes("/skills/");
  if (!isPiGlobal && !isHermesGlobal && !isProjectSkill) {
    throw new Error("Refusing to move an external/package skill. Disable its package resource or add a governor override instead.");
  }
  const sourceDir = dirname(absolute);
  const retirementId = randomUUID();
  const targetDir = assertContained(join(paths.retired, retirementId), paths.retired);
  await mkdir(dirname(targetDir), { recursive: true });
  await assertCanonicalContained(paths.retired, paths.agentDir);
  await assertCanonicalContained(targetDir, paths.retired);
  await rename(sourceDir, targetDir);
  const retiredPath = join(targetDir, "SKILL.md");
  const retirementPath = join(targetDir, "retirement.json");
  try {
    await deps.afterRename?.();
    await atomicWrite(retirementPath, `${JSON.stringify({
      schemaVersion: 1,
      retirementId,
      sourcePath: absolute,
      retiredPath,
      reason,
      retiredAt: new Date().toISOString(),
      candidateId: linkedManifest?.id,
      previousStatus: linkedManifest?.status,
      previousPromotedPath: linkedManifest?.promotedPath,
    }, null, 2)}\n`);
    await deps.afterMetadata?.();
    if (linkedManifest) {
      await updateCandidate(paths, linkedManifest, {
        status: "retired",
        previousPath: absolute,
      });
    }
  } catch (error) {
    await rm(retirementPath, { force: true }).catch(() => undefined);
    await rename(targetDir, sourceDir).catch(() => undefined);
    throw error;
  }
  await appendEvidence(paths, { type: "skill_retired", retirementId, sourcePath: absolute, retiredPath, reason, candidateId: linkedManifest?.id }).catch(() => undefined);
  return { retirementId, retiredPath };
}

export async function rollbackRetirement(paths: GovernorPaths, retirementId: string): Promise<string> {
  if (!/^[a-f0-9-]{36}$/i.test(retirementId)) throw new Error("Invalid retirement id.");
  const dir = assertContained(join(paths.retired, retirementId), paths.retired);
  const retirementPath = join(dir, "retirement.json");
  const record = JSON.parse(await readFile(retirementPath, "utf8")) as {
    sourcePath: string;
    candidateId?: string;
    previousStatus?: CandidateManifest["status"];
    previousPromotedPath?: string;
  };
  const target = await assertCanonicalContained(record.sourcePath, paths.agentDir);
  try {
    await stat(target);
    throw new Error(`Rollback target already exists: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await mkdir(dirname(dirname(target)), { recursive: true });
  await rename(dir, dirname(target));
  try {
    if (record.candidateId) {
      const candidate = await loadCandidate(paths, record.candidateId);
      if (!candidate) throw new Error(`Linked candidate not found: ${record.candidateId}`);
      await updateCandidate(paths, candidate.manifest, {
        status: record.previousStatus ?? "canary",
        promotedPath: record.previousPromotedPath ?? target,
        previousPath: undefined,
      });
    }
  } catch (error) {
    await rename(dirname(target), dir).catch(() => undefined);
    throw error;
  }
  await rm(join(dirname(target), "retirement.json"), { force: true }).catch(() => undefined);
  await appendEvidence(paths, { type: "skill_rollback", retirementId, target, candidateId: record.candidateId }).catch(() => undefined);
  return target;
}

export async function snapshotSkillFile(paths: GovernorPaths, skillPath: string): Promise<string> {
  const source = assertContained(skillPath, paths.agentDir);
  const id = randomUUID();
  const target = assertContained(join(paths.root, "snapshots", id, "SKILL.md"), paths.root);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  return target;
}
