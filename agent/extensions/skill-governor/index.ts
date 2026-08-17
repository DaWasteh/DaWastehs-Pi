import { access, readFile, realpath } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import {
  formatSkillsForPrompt,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
  type Skill,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { criticizeCandidate, generateCandidate, type EvolutionSource } from "./llm.ts";
import {
  applyDeleteOnlyRepair,
  auditSkillText,
  buildSkillMarkdown,
  COMPACT_SKILL_POLICY,
  parseFrontmatterField,
  resolveSkillPolicy,
  scoreSkillForPrompt,
  sha256,
  slugifySkillName,
  stripFrontmatter,
} from "./policy.ts";
import {
  activeSkillPath,
  addPairedEvidenceBatch,
  appendEvidence,
  attachCriticResult,
  atomicWrite,
  createGovernorPaths,
  ensureGovernorLayout,
  listCandidates,
  loadCandidate,
  loadGovernorConfig,
  promoteCandidate,
  recordEvolutionObservation,
  resetEvolutionObservation,
  retireActiveSkill,
  rollbackRetirement,
  saveCandidate,
  updateCandidate,
} from "./store.ts";
import type {
  CandidateManifest,
  GeneratedCandidate,
  GovernorConfig,
  PairedEvidence,
  RunObservation,
  SkillRisk,
  SkillSnapshot,
} from "./types.ts";

const MUTATING_SKILL_ACTIONS = new Set(["create", "patch", "update", "edit", "delete"]);
const SKILL_BLOCK_PATTERN = /(?:\n\nThe following skills provide specialized instructions[\s\S]*?(?=<available_skills>))?<available_skills>[\s\S]*?<\/available_skills>/g;
const GOVERNANCE_BLOCK_PATTERN = /\n?<skill-governance>[\s\S]*?<\/skill-governance>\n?/g;
const AGENT_MUTATION_COMMAND = /(?:\b(?:cp|mv|rm|del|rmdir|move|copy|set-content|out-file|add-content|tee|git\s+apply)\b|(?:python|node)\s+(?:-c|-e)\b|powershell(?:\.exe)?\b[^\n]*(?:-command|-encodedcommand)|(?:>|>>)\s*[^&|])/i;
const DANGEROUS_COMMAND_PATTERNS: Array<[string, RegExp]> = [
  ["destructive Git cleanup", /\bgit\s+(?:clean\s+-[^\n;&|]*[fdx]|reset\s+--hard)\b/i],
  ["recursive deletion", /\b(?:rm\s+-rf|rmdir\s+\/s|del\s+\/[sq])\b|remove-item\b[^\n;&|]*-recurse/i],
  ["global package/toolchain mutation", /\b(?:npm\s+(?:install|update)\s+-g|pip\s+install\s+--user|winget\s+(?:install|upgrade)|brew\s+(?:install|upgrade)|apt(?:-get)?\s+(?:install|upgrade)|cargo\s+install)\b/i],
];

interface CachedSkill {
  snapshot: SkillSnapshot;
  text: string;
  normalizedPath: string;
}

function emptyObservation(): RunObservation {
  return {
    userPrompt: "",
    toolCalls: 0,
    toolTypes: new Set(),
    skillReads: new Set(),
    changedFiles: new Set(),
    commands: [],
    toolErrors: 0,
    completed: false,
    startedAt: Date.now(),
  };
}

function absoluteFrom(value: string, cwd = process.cwd()): string {
  return isAbsolute(value) ? resolve(value) : resolve(cwd, value);
}

function normalizePath(value: string, cwd = process.cwd()): string {
  const normalized = absoluteFrom(value, cwd).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

async function canonicalTarget(value: string, cwd = process.cwd()): Promise<string> {
  let cursor = absoluteFrom(value, cwd);
  const suffix: string[] = [];
  while (true) {
    try {
      const base = await realpath(cursor);
      return resolve(base, ...suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") return absoluteFrom(value, cwd);
      const parent = dirname(cursor);
      if (parent === cursor) return absoluteFrom(value, cwd);
      suffix.unshift(basename(cursor));
      cursor = parent;
    }
  }
}

function isWithin(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("../"));
}

function collectInputStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectInputStrings(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectInputStrings(item, output);
  return output;
}

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => (
      !!block && typeof block === "object" && (block as { type?: string }).type === "text"
    ))
    .map((block) => block.text)
    .join("\n");
}

function textFromToolResult(content: unknown): string {
  return textFromMessageContent(content);
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9äöüß]+/i)
    .filter((token) => token.length >= 2);
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(tokenize(left));
  const b = new Set(tokenize(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function routeScore(query: string, skill: CachedSkill): number {
  return scoreSkillForPrompt(query, skill.snapshot.skill.name, skill.snapshot.skill.description);
}

function evolutionErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("cross-provider")) return "cross-provider-disabled";
  if (message.includes("model") && (message.includes("unavailable") || message.includes("registry"))) return "model-unavailable";
  if (message.includes("api key") || message.includes("auth")) return "auth-unavailable";
  if (message.includes("timed out") || message.includes("aborted")) return "timeout-or-abort";
  if (message.includes("json") || message.includes("decision") || message.includes("risk/confidence")) return "invalid-model-output";
  if (message.includes("audit") || message.includes("candidate")) return "candidate-validation";
  return "internal-error";
}

function safeCommandSummary(command: string): string {
  return command
    .replace(/\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9_]{10,})\b/g, "[REDACTED]")
    .replace(/\b(?:password|secret|token|api[_-]?key)\s*=\s*[^\s;&|]+/gi, "$1=[REDACTED]")
    .slice(0, 500);
}

function buildGeneratedMarkdown(candidate: GeneratedCandidate, risk: SkillRisk = "medium"): string {
  if (!candidate.name || !candidate.description || !candidate.whenToUse) throw new Error("Candidate is incomplete.");
  if (!candidate.procedureSteps?.length || !candidate.verificationSteps?.length) throw new Error("Candidate lacks procedure or verification.");
  return buildSkillMarkdown({
    name: slugifySkillName(candidate.name),
    description: candidate.description,
    whenToUse: candidate.whenToUse,
    procedureSteps: candidate.procedureSteps,
    pitfalls: candidate.pitfalls ?? [],
    verificationSteps: candidate.verificationSteps,
    tier: "quarantine",
    risk,
  });
}

function observationFingerprint(projectName: string | undefined, observation: RunObservation): string {
  const extensions = [...observation.changedFiles]
    .map((path) => extname(path).toLowerCase() || "(none)")
    .sort();
  const modules = [...observation.changedFiles]
    .map((path) => basename(dirname(path)).toLowerCase())
    .filter(Boolean)
    .sort()
    .slice(0, 12);
  const intentStop = new Set(["add", "change", "check", "create", "edit", "fix", "make", "please", "run", "the", "this", "update", "use", "with"]);
  const intent = tokenize(observation.userPrompt).filter((token) => !intentStop.has(token)).sort().slice(0, 12);
  return sha256(JSON.stringify({
    projectName: projectName ?? "global",
    toolTypes: [...observation.toolTypes].sort(),
    extensions,
    modules,
    intent,
    skillLineage: [...observation.skillReads].sort(),
  }));
}

function cloneObservation(observation: RunObservation): RunObservation {
  return {
    ...observation,
    toolTypes: new Set(observation.toolTypes),
    skillReads: new Set(observation.skillReads),
    changedFiles: new Set(observation.changedFiles),
    commands: [...observation.commands],
  };
}

function activeEvidenceQualifies(manifest: CandidateManifest, config: GovernorConfig): { ok: boolean; reason: string } {
  if (!manifest.staticAudit.pass) return { ok: false, reason: "Static audit has blocking findings." };
  if (!manifest.critic || manifest.critic.decision !== "pass" || manifest.critic.candidateSha256 !== manifest.staticAudit.sha256) return { ok: false, reason: "Independent critic has not passed the current candidate digest." };
  if (manifest.critic.risk > config.promotion.maxCriticRisk) return { ok: false, reason: "Critic risk is above the promotion threshold." };
  if (manifest.critic.confidence < config.promotion.minCriticConfidence) return { ok: false, reason: "Critic confidence is below the promotion threshold." };
  if (!config.promotion.allowedAutomaticRisks.includes(manifest.risk)) return { ok: false, reason: `Risk tier '${manifest.risk}' is not eligible.` };
  const usable = manifest.evidence.filter((item) => !item.hardSafetyViolation);
  const uniqueTasks = new Set(usable.map((item) => item.taskId));
  if (usable.length < config.promotion.minPairedRuns || uniqueTasks.size < config.promotion.minPairedRuns) return { ok: false, reason: `Need ${config.promotion.minPairedRuns} unique paired tasks; found ${uniqueTasks.size}.` };
  if (manifest.evidence.some((item) => item.hardSafetyViolation)) return { ok: false, reason: "A paired run recorded a hard safety violation." };
  if (usable.some((item) => !item.candidatePassed)) return { ok: false, reason: "Every qualifying candidate run must pass." };
  if (config.promotion.requirePositiveUtility) {
    const deltas = usable.map((item) => item.utilityDelta).filter((value): value is number => typeof value === "number");
    if (deltas.length === 0 || deltas.reduce((sum, value) => sum + value, 0) <= 0) {
      return { ok: false, reason: "No positive paired utility evidence." };
    }
  }
  return { ok: true, reason: "Qualification evidence passes." };
}

export default function skillGovernor(pi: ExtensionAPI): void {
  const paths = createGovernorPaths(getAgentDir());
  let config: GovernorConfig;
  let cachedSkills: CachedSkill[] = [];
  let cachedByPath = new Map<string, CachedSkill>();
  let turnVisibleSkills = new Set<string>();
  let observation = emptyObservation();
  let lastAssistantSummary = "";
  let lastProjectName: string | undefined;
  let evolutionInProgress = false;
  const approvedSkillReads = new Set<string>();
  const approvedWrites = new Set<string>();

  const refreshToolVisibility = () => {
    if (!config?.enabled) return;
    const active = pi.getActiveTools();
    if (active.includes("skill_manage")) pi.setActiveTools(active.filter((name) => name !== "skill_manage"));
  };

  const projectNameForCwd = async (cwd: string): Promise<string | undefined> => {
    const resolvedCwd = resolve(cwd);
    const resolvedHome = resolve(homedir());
    if (!resolvedCwd || resolvedCwd === resolvedHome || dirname(resolvedCwd) === resolvedCwd) return undefined;
    const cwdName = basename(resolvedCwd);
    let repoName: string | undefined;
    try {
      const result = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 3000 });
      if (result.code === 0 && result.stdout.trim()) {
        const repoRoot = resolve(result.stdout.trim());
        if (repoRoot === resolvedHome) return undefined;
        repoName = basename(repoRoot);
      }
    } catch { /* fallback below */ }
    const exists = async (path: string) => {
      try { await access(path); return true; } catch { return false; }
    };
    if (repoName && repoName !== cwdName) {
      const projectsRoot = join(paths.agentDir, "projects-memory");
      const repoStore = join(projectsRoot, repoName);
      const legacyStore = join(projectsRoot, cwdName);
      if (!await exists(repoStore) && await exists(legacyStore)) return cwdName;
      return repoName;
    }
    return cwdName && cwdName !== basename(getAgentDir()) ? cwdName : undefined;
  };

  const cacheSkills = async (skills: Skill[] | undefined) => {
    if (!skills) return;
    const next: CachedSkill[] = [];
    for (const skill of skills) {
      let text = "";
      try { text = await readFile(skill.filePath, "utf8"); } catch { /* unavailable skills remain native */ }
      next.push({
        snapshot: resolveSkillPolicy(skill, config, text),
        text,
        normalizedPath: normalizePath(await canonicalTarget(skill.filePath)),
      });
    }
    cachedSkills = next;
    cachedByPath = new Map();
    for (const item of next) {
      cachedByPath.set(item.normalizedPath, item);
      cachedByPath.set(normalizePath(item.snapshot.skill.filePath), item);
    }
  };

  const latePromptHook = async (event: Parameters<Parameters<ExtensionAPI["on"]>[1]>[0] & { prompt?: string; systemPrompt: string; systemPromptOptions?: { skills?: Skill[] } }) => {
    if (!config.enabled) return undefined;
    refreshToolVisibility();
    await cacheSkills(event.systemPromptOptions?.skills);
    const visibleRanked = cachedSkills
      .filter((item) => item.snapshot.tier === "auto")
      .map((item) => ({ item, score: routeScore(event.prompt ?? "", item) }))
      .filter((entry) => entry.score >= config.routing.minScore)
      .sort((a, b) => b.score - a.score || a.item.snapshot.skill.name.localeCompare(b.item.snapshot.skill.name))
      .slice(0, config.routing.maxAutoSkills);
    const visible = visibleRanked.map((entry) => entry.item.snapshot.skill);
    turnVisibleSkills = new Set(visible.map((skill) => skill.name));
    let prompt = event.systemPrompt.replace(GOVERNANCE_BLOCK_PATTERN, "\n");
    const skillBlock = visible.length > 0 ? formatSkillsForPrompt(visible) : "";
    prompt = prompt.replace(SKILL_BLOCK_PATTERN, skillBlock);
    if (!event.systemPrompt.includes("<available_skills>") && skillBlock) prompt += skillBlock;
    if ((prompt.match(/<available_skills>/g) ?? []).length > 1) throw new Error("skill-governor could not safely replace every skill block.");
    if (config.promptPolicyEnabled) prompt += `\n\n${COMPACT_SKILL_POLICY}`;
    return { systemPrompt: prompt };
  };

  const runCriticAndRepair = async (
    ctx: Pick<ExtensionContext, "model" | "modelRegistry" | "signal">,
    manifest: CandidateManifest,
  ): Promise<CandidateManifest> => {
    let loaded = await loadCandidate(paths, manifest.id);
    if (!loaded) throw new Error(`Candidate disappeared: ${manifest.id}`);
    let current = manifest;
    for (let round = 0; round <= config.evolution.maxRepairRounds; round++) {
      const critic = await criticizeCandidate(ctx, config, loaded.markdown, current.source.skillLineage, ctx.signal);
      current = await attachCriticResult(paths, current, critic);
      if (critic.decision === "pass" || critic.decision === "reject") return current;
      if (round >= config.evolution.maxRepairRounds || critic.deleteSpans.length === 0) {
        return updateCandidate(paths, current, {
          status: "rejected",
          notes: [...(current.notes ?? []), "Critic requested repair but no safe subtractive repair remained."],
        });
      }
      const repaired = applyDeleteOnlyRepair(loaded.markdown, critic.deleteSpans);
      if (!repaired.text) {
        return updateCandidate(paths, current, {
          status: "rejected",
          notes: [...(current.notes ?? []), repaired.error ?? "Delete-only repair failed."],
        });
      }
      const audit = auditSkillText(repaired.text, {
        scope: current.scope,
        maxChars: config.evolution.maxCandidateChars,
      });
      if (!audit.pass) {
        return updateCandidate(paths, current, {
          status: "rejected",
          staticAudit: audit,
          notes: [...(current.notes ?? []), "Delete-only repair failed static re-audit."],
        }, repaired.text);
      }
      current = await updateCandidate(paths, current, {
        status: "repaired",
        staticAudit: audit,
        critic: undefined,
        evidence: [],
        repairRounds: current.repairRounds + 1,
      }, repaired.text);
      loaded = { manifest: current, markdown: repaired.text };
    }
    return current;
  };

  const maybePromoteCanary = async (manifest: CandidateManifest): Promise<CandidateManifest> => {
    if (!config.promotion.automaticCanary) return manifest;
    if (!manifest.staticAudit.pass || manifest.critic?.decision !== "pass") return manifest;
    if (manifest.source.model && manifest.critic.model && manifest.source.model === manifest.critic.model) return manifest;
    if (!config.promotion.allowedAutomaticRisks.includes(manifest.risk)) return manifest;
    if ((manifest.critic?.risk ?? 1) > config.promotion.maxCriticRisk) return manifest;
    if ((manifest.critic?.confidence ?? 0) < config.promotion.minCriticConfidence) return manifest;
    const target = activeSkillPath(paths, manifest, "canary");
    return withFileMutationQueue(target, () => promoteCandidate(paths, manifest, "canary"));
  };

  const autoPromoteQualifiedCandidates = async (): Promise<void> => {
    if (!config.promotion.automaticActive) return;
    for (const manifest of await listCandidates(paths)) {
      if (manifest.status !== "canary" || !manifest.promotedPath) continue;
      const loaded = await loadCandidate(paths, manifest.id);
      if (!loaded) continue;
      let canaryText: string;
      try { canaryText = await readFile(manifest.promotedPath, "utf8"); } catch { continue; }
      const canaryStillManual = parseFrontmatterField(canaryText, "skill-governor-tier") === "manual"
        && parseFrontmatterField(canaryText, "disable-model-invocation") === "true"
        && parseFrontmatterField(canaryText, "skill-governor-risk") === manifest.risk
        && stripFrontmatter(canaryText) === stripFrontmatter(loaded.markdown);
      if (!canaryStillManual) continue;
      const qualification = activeEvidenceQualifies(manifest, config);
      if (!qualification.ok) continue;
      const target = activeSkillPath(paths, manifest, "active");
      await withFileMutationQueue(target, () => promoteCandidate(paths, manifest, "active"));
      await appendEvidence(paths, {
        type: "candidate_auto_activated",
        candidateId: manifest.id,
        target,
      });
    }
  };

  const evolveObservation = async (
    ctx: Pick<ExtensionContext, "model" | "modelRegistry" | "signal" | "sessionManager" | "ui">,
    sourceObservation: RunObservation,
    force = false,
  ): Promise<CandidateManifest | null> => {
    if (evolutionInProgress) return null;
    if ((!config.evolution.enabled || !config.evolution.userApprovedAt) && !force) return null;
    if (!force && (!sourceObservation.completed
      || sourceObservation.toolCalls < config.evolution.minToolCalls
      || sourceObservation.toolTypes.size < config.evolution.minToolTypes)) return null;
    evolutionInProgress = true;
    const taskHash = sha256(sourceObservation.userPrompt);
    const fingerprint = observationFingerprint(lastProjectName, sourceObservation);
    try {
      if (!force) {
        const recurrence = await withFileMutationQueue(paths.observations, () =>
          recordEvolutionObservation(paths, fingerprint, taskHash, config.evolution.minObservations));
        if (!recurrence.ready) {
          await appendEvidence(paths, {
            type: "evolution_deferred",
            fingerprint,
            observations: recurrence.count,
            required: config.evolution.minObservations,
            taskHash,
          });
          return null;
        }
      }
      const source: EvolutionSource = {
        projectName: lastProjectName,
        userPrompt: sourceObservation.userPrompt,
        assistantSummary: lastAssistantSummary,
        observation: sourceObservation,
      };
      const generated = await generateCandidate(ctx, config, source, ctx.signal);
      if (generated.candidate.skip) {
        await appendEvidence(paths, {
          type: "evolution_skipped",
          reasonCode: "model-skip",
          reasonHash: generated.candidate.reason ? sha256(generated.candidate.reason) : undefined,
          taskHash,
          model: generated.model,
        });
        if (!force) await withFileMutationQueue(paths.observations, () => resetEvolutionObservation(paths, fingerprint));
        return null;
      }
      if (generated.candidate.scope === "project" && !lastProjectName) generated.candidate.scope = "global";
      const proposedIdentity = `${generated.candidate.name ?? ""} ${generated.candidate.description ?? ""}`;
      const activeDuplicate = cachedSkills.find((item) => item.snapshot.skill.name === slugifySkillName(generated.candidate.name ?? "")
        || tokenSimilarity(proposedIdentity, `${item.snapshot.skill.name} ${item.snapshot.skill.description}`) >= 0.8);
      const candidateDuplicate = (await listCandidates(paths)).find((item) => item.status !== "rejected" && item.status !== "retired"
        && (item.name === slugifySkillName(generated.candidate.name ?? "")
          || tokenSimilarity(proposedIdentity, `${item.name} ${item.description}`) >= 0.8));
      if (activeDuplicate || candidateDuplicate) {
        await appendEvidence(paths, {
          type: "evolution_duplicate_skipped",
          taskHash,
          existingSkill: activeDuplicate?.snapshot.skill.name,
          existingCandidateId: candidateDuplicate?.id,
        });
        if (!force) await withFileMutationQueue(paths.observations, () => resetEvolutionObservation(paths, fingerprint));
        return null;
      }
      let markdown = buildGeneratedMarkdown(generated.candidate);
      let audit = auditSkillText(markdown, {
        scope: generated.candidate.scope,
        maxChars: config.evolution.maxCandidateChars,
      });
      if (audit.inferredRisk !== "medium") {
        markdown = buildGeneratedMarkdown(generated.candidate, audit.inferredRisk);
        audit = auditSkillText(markdown, {
          scope: generated.candidate.scope,
          maxChars: config.evolution.maxCandidateChars,
        });
      }
      if (!audit.pass) {
        await appendEvidence(paths, {
          type: "evolution_rejected_before_persist",
          taskHash,
          findings: audit.findings.map((finding) => finding.code),
          model: generated.model,
        });
        if (!force) await withFileMutationQueue(paths.observations, () => resetEvolutionObservation(paths, fingerprint));
        return null;
      }
      const manifest = await saveCandidate(paths, {
        name: generated.candidate.name!,
        description: generated.candidate.description!,
        scope: generated.candidate.scope!,
        whenToUse: generated.candidate.whenToUse!,
        procedureSteps: generated.candidate.procedureSteps!,
        pitfalls: generated.candidate.pitfalls ?? [],
        verificationSteps: generated.candidate.verificationSteps!,
      }, audit, {
        sessionId: ctx.sessionManager.getSessionId(),
        taskHash,
        model: generated.model,
        skillLineage: [...sourceObservation.skillReads],
        automatic: !force,
      }, {
        projectName: generated.candidate.scope === "project" ? lastProjectName : undefined,
        risk: audit.inferredRisk,
      });
      if (!force) await withFileMutationQueue(paths.observations, () => resetEvolutionObservation(paths, fingerprint));
      const reviewed = await runCriticAndRepair(ctx, manifest);
      const promoted = await maybePromoteCanary(reviewed).catch(async (error) => {
        await appendEvidence(paths, {
          type: "canary_promotion_failed",
          candidateId: reviewed.id,
          errorCode: evolutionErrorCode(error),
        });
        return reviewed;
      });
      ctx.ui.notify(
        promoted.status === "canary"
          ? `Skill candidate '${promoted.name}' passed governance and entered manual canary.`
          : `Skill candidate '${promoted.name}' remains ${promoted.status}.`,
        promoted.status === "rejected" ? "warning" : "info",
      );
      return promoted;
    } catch (error) {
      await appendEvidence(paths, {
        type: "evolution_error",
        errorCode: evolutionErrorCode(error),
        taskHash,
      }).catch(() => undefined);
      ctx.ui.notify(`Skill evolution failed safely: ${error instanceof Error ? error.message : String(error)}`, "warning");
      return null;
    } finally {
      evolutionInProgress = false;
    }
  };

  pi.on("before_agent_start", latePromptHook as never);

  pi.on("session_start", async (_event, ctx) => {
    await ensureGovernorLayout(paths);
    config = await loadGovernorConfig(paths);
    lastProjectName = await projectNameForCwd(ctx.cwd);
    refreshToolVisibility();
    ctx.ui.setStatus("skill-governor", config.enabled ? "skills: governed" : "skills: governor off");
  });

  pi.on("resources_discover", async (event) => {
    if (!config?.enabled) return undefined;
    lastProjectName = await projectNameForCwd(event.cwd);
    await autoPromoteQualifiedCandidates().catch(async (error) => {
      await appendEvidence(paths, {
        type: "auto_activation_error",
        errorCode: evolutionErrorCode(error),
      }).catch(() => undefined);
    });
    const skillPaths = [join(paths.agentDir, "skills"), join(paths.agentDir, "pi-hermes-memory", "skills")];
    if (lastProjectName) skillPaths.push(join(paths.agentDir, "projects-memory", lastProjectName, "skills"));
    return { skillPaths };
  });

  pi.on("input", async (event) => {
    if (event.source !== "extension") {
      observation = emptyObservation();
      observation.userPrompt = event.text;
      lastAssistantSummary = "";
    }
    return { action: "continue" };
  });

  pi.on("tool_call", async (event, ctx) => {
    if (!config.enabled) return undefined;
    observation.toolCalls++;
    observation.toolTypes.add(event.toolName);

    if (event.toolName === "skill_manage") {
      const action = String((event.input as { action?: unknown }).action ?? "");
      if (config.disableDirectSkillManageMutations && MUTATING_SKILL_ACTIONS.has(action)) {
        return {
          block: true,
          reason: "Direct active skill mutation is disabled by skill-governor. Use skill_governor(action='propose') so the procedure enters quarantine, criticism, and qualification instead.",
        };
      }
    }

    if (event.toolName === "read") {
      const path = String((event.input as { path?: unknown }).path ?? "");
      if (path.toLowerCase().endsWith("skill.md")) {
        const normalized = normalizePath(await canonicalTarget(path, ctx.cwd));
        const cached = cachedByPath.get(normalized) ?? cachedByPath.get(normalizePath(path, ctx.cwd));
        if (cached?.snapshot.tier === "manual" && !approvedSkillReads.delete(normalized)) {
          return {
            block: true,
            reason: `Skill '${cached.snapshot.skill.name}' is manual/canary. Use skill_route(action='load', name='${cached.snapshot.skill.name}') for explicit approval, or invoke /skill:${cached.snapshot.skill.name} yourself.`,
          };
        }
        observation.skillReads.add(cached?.snapshot.skill.name ?? normalized);
      }
    }

    if (event.toolName === "write" || event.toolName === "edit") {
      const path = String((event.input as { path?: unknown }).path ?? "");
      const absolute = absoluteFrom(path, ctx.cwd);
      const canonical = await canonicalTarget(absolute);
      const normalized = normalizePath(canonical);
      const projectRoot = normalizePath(join(paths.agentDir, "projects-memory"));
      const lexicalProjectSkill = normalizePath(absolute).includes(`${projectRoot}/`) && normalizePath(absolute).includes("/skills/");
      const canonicalProjectSkill = normalizePath(canonical).includes(`${projectRoot}/`) && normalizePath(canonical).includes("/skills/");
      const cachedSkillTarget = cachedByPath.has(normalizePath(absolute)) || cachedByPath.has(normalizePath(canonical));
      const protectedPath = cachedSkillTarget
        || isWithin(absolute, join(paths.agentDir, "skills"))
        || isWithin(canonical, join(paths.agentDir, "skills"))
        || lexicalProjectSkill
        || canonicalProjectSkill
        || isWithin(absolute, join(paths.agentDir, "pi-hermes-memory", "skills"))
        || isWithin(canonical, join(paths.agentDir, "pi-hermes-memory", "skills"))
        || isWithin(absolute, join(paths.agentDir, "extensions", "skill-governor"))
        || isWithin(canonical, join(paths.agentDir, "extensions", "skill-governor"))
        || isWithin(absolute, paths.root)
        || isWithin(canonical, paths.root);
      if (config.protectActiveSkillFiles && protectedPath && !approvedWrites.delete(normalized)) {
        return {
          block: true,
          reason: "Governed skill/governor files cannot be changed by ordinary edit/write calls. Use the governor candidate/promotion flow or ask the user to run /skill-governor allow-write <exact-path>.",
        };
      }
      observation.changedFiles.add(path);
    }

    if (!["read", "write", "edit", "bash", "skill_manage", "skill_route", "skill_governor"].includes(event.toolName)) {
      for (const value of collectInputStrings(event.input)) {
        if (!/[\\/]|skill\.md/i.test(value)) continue;
        const absolute = absoluteFrom(value, ctx.cwd);
        const canonical = await canonicalTarget(absolute);
        const targetsSkill = cachedByPath.has(normalizePath(absolute))
          || cachedByPath.has(normalizePath(canonical))
          || isWithin(absolute, join(paths.agentDir, "skills"))
          || isWithin(canonical, join(paths.agentDir, "skills"))
          || (normalizePath(absolute).includes("/projects-memory/") && normalizePath(absolute).includes("/skills/"));
        if (targetsSkill) {
          return { block: true, reason: `Tool '${event.toolName}' cannot access governed skill paths; use read/skill_route or the confirmed governor lifecycle.` };
        }
      }
    }

    if (event.toolName === "bash") {
      const command = String((event.input as { command?: unknown }).command ?? "");
      observation.commands.push(safeCommandSummary(command));
      const cwdInsideAgent = isWithin(ctx.cwd, paths.agentDir);
      const mentionsRelativeGovernedPath = cwdInsideAgent
        && /(?:^|[\s"'=])(skills|projects-memory|skill-governor)(?:[\\/]|\b)/i.test(command);
      const touchesGovernedPath = /skill-governor|(?:\.pi[\\/]agent|agent)[\\/]skills|projects-memory[^\n;&|]*[\\/]skills/i.test(command)
        || mentionsRelativeGovernedPath
        || (cwdInsideAgent && AGENT_MUTATION_COMMAND.test(command));
      if (config.protectActiveSkillFiles && touchesGovernedPath) {
        if (!ctx.hasUI || !await ctx.ui.confirm("Governed skill mutation", `Allow this command once?\n\n${command.slice(0, 1200)}`)) {
          return { block: true, reason: "Command may mutate governed skill state and was not approved." };
        }
      }
      for (const [label, pattern] of DANGEROUS_COMMAND_PATTERNS) {
        if (!pattern.test(command)) continue;
        if (!ctx.hasUI || !await ctx.ui.confirm("High-risk command", `Allow ${label} once?\n\n${command.slice(0, 1200)}`)) {
          return { block: true, reason: `${label} was blocked because explicit approval was not granted.` };
        }
      }
    }
  });

  pi.on("tool_result", async (event) => {
    if (event.isError) observation.toolErrors++;
    if ((event.toolName === "write" || event.toolName === "edit") && typeof (event.input as { path?: unknown }).path === "string") {
      observation.changedFiles.add((event.input as { path: string }).path);
    }
  });

  pi.on("message_end", async (event) => {
    if (event.message.role === "assistant") {
      const text = textFromMessageContent(event.message.content);
      if (text.trim()) lastAssistantSummary = text.slice(-6000);
      observation.completed = event.message.stopReason === "stop";
    }
  });

  pi.on("agent_settled", async (_event, ctx) => {
    if (!config.enabled) return;
    const snapshot = cloneObservation(observation);
    await appendEvidence(paths, {
      type: "run_settled",
      sessionId: ctx.sessionManager.getSessionId(),
      taskHash: snapshot.userPrompt ? sha256(snapshot.userPrompt) : undefined,
      completed: snapshot.completed,
      toolCalls: snapshot.toolCalls,
      toolTypes: [...snapshot.toolTypes],
      skills: [...snapshot.skillReads],
      changedFiles: [...snapshot.changedFiles],
      toolErrors: snapshot.toolErrors,
      elapsedMs: Date.now() - snapshot.startedAt,
    }).catch(() => undefined);
    if (config.evolution.enabled) void evolveObservation(ctx, snapshot, false);
  });

  pi.registerTool({
    name: "skill_route",
    label: "Skill Route",
    description: "Search governed skills and, with approval, lazy-load a manual/canary skill. Use only when a hidden specialized procedure is needed; ordinary auto skills are already listed.",
    promptSnippet: "Search or approve-load governed manual skills when a hidden specialized procedure is needed",
    promptGuidelines: [
      "Use skill_route only for a concrete hidden capability; do not load broad release, install, destructive, or audit workflows for routine tasks.",
    ],
    parameters: Type.Object({
      action: StringEnum(["search", "load"] as const),
      query: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }, { additionalProperties: false }),
    async execute(_id, params, _signal, _update, ctx) {
      if (params.action === "search") {
        const query = params.query?.trim() ?? "";
        if (!query) throw new Error("query is required for skill_route search.");
        const matches = cachedSkills
          .filter((item) => !turnVisibleSkills.has(item.snapshot.skill.name))
          .map((item) => ({ item, score: routeScore(query, item) }))
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score || a.item.snapshot.skill.name.localeCompare(b.item.snapshot.skill.name))
          .slice(0, params.limit ?? 5)
          .map(({ item, score }) => ({
            name: item.snapshot.skill.name,
            description: item.snapshot.skill.description,
            tier: item.snapshot.tier,
            risk: item.snapshot.risk,
            score,
          }));
        return { content: [{ type: "text", text: JSON.stringify({ matches }) }], details: { matches } };
      }
      const name = params.name?.trim();
      if (!name) throw new Error("name is required for skill_route load.");
      const selected = cachedSkills.find((item) => item.snapshot.skill.name === name);
      if (!selected) throw new Error(`Skill not found in current scope: ${name}`);
      if (selected.snapshot.tier === "auto") {
        observation.skillReads.add(name);
        const text = selected.text || await readFile(selected.snapshot.skill.filePath, "utf8");
        return {
          content: [{ type: "text", text: text.slice(0, 50_000) }],
          details: { name, path: selected.snapshot.skill.filePath, tier: selected.snapshot.tier, risk: selected.snapshot.risk },
        };
      }
      if (!ctx.hasUI || !await ctx.ui.confirm("Load manual skill?", `${name} [${selected.snapshot.risk}]\n\n${selected.snapshot.skill.description}`)) {
        throw new Error(`Manual skill '${name}' was not approved.`);
      }
      approvedSkillReads.add(selected.normalizedPath);
      observation.skillReads.add(name);
      const text = selected.text || await readFile(selected.snapshot.skill.filePath, "utf8");
      return {
        content: [{ type: "text", text: text.slice(0, 50_000) }],
        details: { name, path: selected.snapshot.skill.filePath, tier: selected.snapshot.tier, risk: selected.snapshot.risk },
      };
    },
  });

  pi.registerTool({
    name: "skill_governor",
    label: "Skill Governor",
    description: "Audit skills or propose a quarantined reusable procedure. This tool cannot directly activate, retire, delete, or overwrite a skill; those authority actions are user-confirmed slash commands.",
    promptSnippet: "Audit skills and submit reusable procedures to quarantine",
    promptGuidelines: [
      "Use skill_governor propose instead of skill_manage mutations; proposals remain quarantined until independent criticism and qualification.",
    ],
    parameters: Type.Object({
      action: StringEnum(["status", "audit", "propose", "list_candidates"] as const),
      name: Type.Optional(Type.String()),
      path: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      scope: Type.Optional(StringEnum(["global", "project"] as const)),
      when_to_use: Type.Optional(Type.String()),
      procedure_steps: Type.Optional(Type.Array(Type.String())),
      pitfalls: Type.Optional(Type.Array(Type.String())),
      verification_steps: Type.Optional(Type.Array(Type.String())),
    }, { additionalProperties: false }),
    async execute(_id, params, signal, _update, ctx) {
      if (params.action === "status") {
        const candidates = await listCandidates(paths);
        const summary = {
          enabled: config.enabled,
          autoSkills: cachedSkills.filter((item) => item.snapshot.tier === "auto").length,
          manualSkills: cachedSkills.filter((item) => item.snapshot.tier === "manual").length,
          candidates: candidates.length,
          byStatus: Object.fromEntries([...new Set(candidates.map((item) => item.status))].map((status) => [status, candidates.filter((item) => item.status === status).length])),
        };
        return { content: [{ type: "text", text: JSON.stringify(summary) }], details: summary };
      }
      if (params.action === "list_candidates") {
        const candidates = (await listCandidates(paths)).map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          risk: item.risk,
          updatedAt: item.updatedAt,
          criticRisk: item.critic?.risk,
          evidence: item.evidence.length,
        }));
        return { content: [{ type: "text", text: JSON.stringify({ candidates }) }], details: { candidates } };
      }
      if (params.action === "audit") {
        const selected = params.path
          ? cachedSkills.find((item) => item.normalizedPath === normalizePath(params.path!, ctx.cwd))
          : cachedSkills.find((item) => item.snapshot.skill.name === params.name);
        if (!selected) throw new Error("Provide a skill name/path in the current scope.");
        const audit = auditSkillText(selected.text || await readFile(selected.snapshot.skill.filePath, "utf8"), {
          scope: selected.snapshot.skill.sourceInfo.scope === "project" ? "project" : "global",
          maxChars: config.evolution.maxCandidateChars,
        });
        return { content: [{ type: "text", text: JSON.stringify(audit) }], details: audit };
      }
      if (!params.name || !params.description || !params.scope || !params.when_to_use || !params.procedure_steps?.length || !params.verification_steps?.length) {
        throw new Error("propose requires name, description, scope, when_to_use, procedure_steps, and verification_steps.");
      }
      if (params.scope === "project" && !lastProjectName) throw new Error("Project proposal requires an active project.");
      const generated: Required<Pick<GeneratedCandidate, "name" | "description" | "scope" | "whenToUse" | "procedureSteps" | "pitfalls" | "verificationSteps">> = {
        name: params.name,
        description: params.description,
        scope: params.scope,
        whenToUse: params.when_to_use,
        procedureSteps: params.procedure_steps,
        pitfalls: params.pitfalls ?? [],
        verificationSteps: params.verification_steps,
      };
      const makeMarkdown = (risk: SkillRisk) => buildSkillMarkdown({
        name: slugifySkillName(generated.name),
        description: generated.description,
        whenToUse: generated.whenToUse,
        procedureSteps: generated.procedureSteps,
        pitfalls: generated.pitfalls,
        verificationSteps: generated.verificationSteps,
        tier: "quarantine",
        risk,
      });
      let markdown = makeMarkdown("medium");
      let audit = auditSkillText(markdown, { scope: generated.scope, maxChars: config.evolution.maxCandidateChars });
      if (audit.inferredRisk !== "medium") {
        markdown = makeMarkdown(audit.inferredRisk);
        audit = auditSkillText(markdown, { scope: generated.scope, maxChars: config.evolution.maxCandidateChars });
      }
      if (!audit.pass) throw new Error(`Proposal rejected before persistence: ${audit.findings.filter((item) => item.severity === "error").map((item) => item.code).join(", ")}`);
      let manifest = await saveCandidate(paths, generated, audit, {
        sessionId: ctx.sessionManager.getSessionId(),
        taskHash: observation.userPrompt ? sha256(observation.userPrompt) : undefined,
        model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
        skillLineage: [...observation.skillReads],
        automatic: false,
      }, { projectName: generated.scope === "project" ? lastProjectName : undefined, risk: audit.inferredRisk });
      manifest = await runCriticAndRepair(ctx, manifest);
      return {
        content: [{ type: "text", text: JSON.stringify({ id: manifest.id, name: manifest.name, status: manifest.status, risk: manifest.risk, critic: manifest.critic }) }],
        details: manifest,
      };
    },
  });

  pi.registerCommand("skill-governor", {
    description: "Inspect and control governed skills: status|candidates|audit|evolve|evidence|promote|retire|rollback|allow-write",
    handler: async (args, ctx) => {
      const [action = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      if (action === "status") {
        const candidates = await listCandidates(paths);
        ctx.ui.notify(`Skill governor: ${cachedSkills.filter((item) => item.snapshot.tier === "auto").length} auto, ${cachedSkills.filter((item) => item.snapshot.tier === "manual").length} manual, ${candidates.length} candidates.`, "info");
        return;
      }
      if (action === "candidates") {
        const rows = (await listCandidates(paths)).slice(0, 20).map((item) => `${item.id}  ${item.status.padEnd(8)}  ${item.risk.padEnd(8)}  ${item.name}`);
        ctx.ui.notify(rows.length ? rows.join("\n") : "No candidates.", "info");
        return;
      }
      if (action === "audit") {
        const name = rest.join(" ");
        const selected = cachedSkills.find((item) => item.snapshot.skill.name === name);
        if (!selected) { ctx.ui.notify(`Unknown skill: ${name}`, "error"); return; }
        const audit = auditSkillText(selected.text || await readFile(selected.snapshot.skill.filePath, "utf8"), {
          scope: selected.snapshot.skill.sourceInfo.scope === "project" ? "project" : "global",
          maxChars: config.evolution.maxCandidateChars,
        });
        ctx.ui.notify(`${name}: ${audit.pass ? "PASS" : "BLOCK"}, score ${audit.score}, risk ${audit.inferredRisk}\n${audit.findings.map((item) => `${item.severity}: ${item.code}`).join("\n")}`, audit.pass ? "info" : "warning");
        return;
      }
      if (action === "evolve") {
        await evolveObservation(ctx, cloneObservation(observation), true);
        return;
      }
      if (action === "evidence") {
        const [id, ...evidencePathParts] = rest;
        const evidencePathRaw = evidencePathParts.join(" ");
        const loaded = id ? await loadCandidate(paths, id) : null;
        if (!loaded || !evidencePathRaw) { ctx.ui.notify("Usage: /skill-governor evidence <candidate-id> <json-file>", "error"); return; }
        const evidencePath = resolve(ctx.cwd, evidencePathRaw);
        let payload: unknown;
        try { payload = JSON.parse(await readFile(evidencePath, "utf8")); }
        catch (error) { ctx.ui.notify(`Invalid evidence file: ${evolutionErrorCode(error)}`, "error"); return; }
        const records = Array.isArray(payload) ? payload : [payload];
        if (!await ctx.ui.confirm("Import paired evidence?", `${records.length} record(s) for ${loaded.manifest.name}\n${evidencePath}`)) return;
        let manifest = loaded.manifest;
        try {
          manifest = await addPairedEvidenceBatch(paths, manifest, records as PairedEvidence[]);
        } catch (error) {
          ctx.ui.notify(`Evidence import rejected: ${evolutionErrorCode(error)}`, "error");
          return;
        }
        const qualification = activeEvidenceQualifies(manifest, config);
        if (qualification.ok && config.promotion.automaticActive && manifest.status === "canary") {
          const target = activeSkillPath(paths, manifest, "active");
          manifest = await withFileMutationQueue(target, () => promoteCandidate(paths, manifest, "active"));
          ctx.ui.notify(`Imported evidence and automatically activated ${manifest.name}. Reloading resources.`, "info");
          await ctx.reload();
          return;
        }
        ctx.ui.notify(`Imported ${records.length} evidence record(s). ${qualification.reason}`, qualification.ok ? "info" : "warning");
        return;
      }
      if (action === "promote") {
        const [id, tierRaw = "canary"] = rest;
        const tier = tierRaw === "active" ? "active" : "canary";
        const loaded = id ? await loadCandidate(paths, id) : null;
        if (!loaded) { ctx.ui.notify("Usage: /skill-governor promote <candidate-id> [canary|active]", "error"); return; }
        if (tier === "active") {
          const qualification = activeEvidenceQualifies(loaded.manifest, config);
          if (!qualification.ok && !await ctx.ui.confirm("Qualification incomplete", `${qualification.reason}\n\nPromote manually anyway?`)) return;
        }
        if (!await ctx.ui.confirm("Promote skill?", `${loaded.manifest.name} → ${tier}\nRisk: ${loaded.manifest.risk}`)) return;
        const target = activeSkillPath(paths, loaded.manifest, tier);
        const promoted = await withFileMutationQueue(target, () => promoteCandidate(paths, loaded.manifest, tier));
        ctx.ui.notify(`Promoted ${promoted.name} to ${tier}: ${promoted.promotedPath}. Reloading resources.`, "info");
        await ctx.reload();
        return;
      }
      if (action === "retire") {
        const [name, ...reasonParts] = rest;
        const selected = cachedSkills.find((item) => item.snapshot.skill.name === name);
        if (!selected) { ctx.ui.notify("Usage: /skill-governor retire <skill-name> <reason>", "error"); return; }
        const reason = reasonParts.join(" ").trim() || "User-authorized retirement";
        if (!await ctx.ui.confirm("Retire skill?", `${name}\n${selected.snapshot.skill.filePath}\n\n${reason}`)) return;
        const linked = (await listCandidates(paths)).find((candidate) => candidate.promotedPath
          && normalizePath(candidate.promotedPath) === normalizePath(selected.snapshot.skill.filePath));
        const retired = await retireActiveSkill(paths, selected.snapshot.skill.filePath, reason, linked);
        ctx.ui.notify(`Retired ${name}. Rollback id: ${retired.retirementId}. Reloading resources.`, "warning");
        await ctx.reload();
        return;
      }
      if (action === "rollback") {
        const [id] = rest;
        if (!id) { ctx.ui.notify("Usage: /skill-governor rollback <retirement-id>", "error"); return; }
        if (!await ctx.ui.confirm("Rollback retired skill?", id)) return;
        const target = await rollbackRetirement(paths, id);
        ctx.ui.notify(`Restored skill to ${target}. Reloading resources.`, "info");
        await ctx.reload();
        return;
      }
      if (action === "allow-write") {
        const raw = rest.join(" ").trim();
        if (!raw) { ctx.ui.notify("Usage: /skill-governor allow-write <exact-path>", "error"); return; }
        const path = resolve(ctx.cwd, raw);
        if (!isWithin(path, paths.agentDir)) { ctx.ui.notify("Only paths inside the Pi agent directory can be approved.", "error"); return; }
        if (!await ctx.ui.confirm("Allow one governed write?", path)) return;
        approvedWrites.add(normalizePath(path));
        ctx.ui.notify(`One write/edit call approved for ${path}`, "warning");
        return;
      }
      ctx.ui.notify("Usage: /skill-governor status|candidates|audit <name>|evolve|evidence <id> <json-file>|promote <id> [canary|active]|retire <name> <reason>|rollback <id>|allow-write <path>", "warning");
    },
  });
}
