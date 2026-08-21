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
  return rel === "" || (!isAbsolute(rel) && !rel.startsWith(`..${sep}`) && rel !== ".." && !rel.startsWith("../"));
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

export type GovernanceAuthorityScope = "skill-files" | "governor-runtime" | "alarm-extension" | "update-extension";

export interface GovernanceAuthorization {
  scopes: GovernanceAuthorityScope[];
}

function stripQuotedExamples(value: string): string {
  return value.replace(/"[^"\n]*"|`[^`\n]*`|‘[^’\n]*’|'[^'\n]{2,}'/g, " ");
}

function directRequestClauses(value: string, action: RegExp): string[] {
  const directCue = /^(?:please\b|bitte\b|can\s+you\b|could\s+you\b|kannst\s+du\b|können\s+wir\b|wir\s+müssen\b|du\s+sollst\b|ich\s+(?:möchte|brauche)(?:,?\s+dass\s+du)?\b|i\s+want\s+you\s+to\b|we\s+(?:need|have)\s+to\b|wenn\s+alles(?:\s+dann)?\s+(?:passt|grün\s+ist|erfolgreich\s+ist)\s*,?\s*bitte\b)/i;
  const metaLead = /^(?:repeat|quote|explain|document|analy[sz]e|discuss|describe|should\s+i|erklär\w*|dokumentier\w*|analysier\w*|diskutier\w*|beschreib\w*|wiederhol\w*|zitiere?\b)/i;
  return stripQuotedExamples(value).split(/(?<!\d)\.(?!\d)|[!?\n;]+/).map((part) => part.trim()).filter((part) => {
    const withoutPolitePrefix = part.replace(/^(?:please|bitte|can\s+you|could\s+you|kannst\s+du|können\s+wir)\s+/i, "");
    if (!part || metaLead.test(withoutPolitePrefix)) return false;
    action.lastIndex = 0;
    const startsWithAction = action.exec(withoutPolitePrefix)?.index === 0;
    action.lastIndex = 0;
    return action.test(part) && (directCue.test(part) || startsWithAction);
  });
}

function hasNegatedGovernanceAction(value: string): boolean {
  const negation = String.raw`(?:do\s+not|don['’]?t|not|never|without|nicht|niemals|kein(?:e|en|er|es)?|ohne|weder)`;
  const action = String.raw`(?:change|edit|update|improve|fix|repair|refactor|loosen|relax|reduce|änder(?:n|e|t)|bearbeit(?:en|e|et)|aktualisier(?:en|e|t)|verbesser(?:n|e|t)|fix(?:en|e|t)|reparier(?:en|e|t)|überarbeit(?:en|e|et)|anpass(?:en|e|t)|locker(?:n|e|t)|entschärf(?:en|e|t))`;
  const subject = String.raw`(?:skill|skills|skill-(?:governor|govenor)|governor|govenor|guard|guards|schutzmechanismus|schutzmechanismen|protection\s+mechanisms?|permission\s+governance|alarm|alarms|soundalarm|pi-autoupdate|updater)`;
  const pattern = String.raw`\b${negation}\b[^.!?\n]{0,60}(?:${action})\b[^.!?\n]{0,40}\b(?:${subject})\b|\b${negation}\b[^.!?\n]{0,60}\b(?:${subject})\b[^.!?\n]{0,40}(?:${action})\b|\b(?:${subject})\b[^.!?\n]{0,40}\b${negation}\b[^.!?\n]{0,40}(?:${action})\b`;
  return new RegExp(pattern, "i").test(value);
}

function clauseExcludes(clause: string, subject: RegExp): boolean {
  const exclusion = String.raw`(?:no|not|without|except|excluding|skip|do\s+not|don['’]?t|nicht|ohne|außer|kein(?:e|en|er|es)?)`;
  return new RegExp(String.raw`\b${exclusion}\b[^,;]{0,35}(?:${subject.source})`, "i").test(clause);
}

export function parseGovernanceAuthorization(value: string): GovernanceAuthorization | null {
  const action = /(?:change|edit|update|improve|fix|repair|refactor|harden|rework|loosen|relax|reduce|änder(?:n|e|t)|bearbeit(?:en|e|et)|aktualisier(?:en|e|t)|verbesser(?:n|e|t)|fix(?:en|e|t)|reparier(?:en|e|t)|härt(?:en|e|et)|überarbeit(?:en|e|et)|anpass(?:en|e|t)|locker(?:n|e|t)|entschärf(?:en|e|t))\b/i;
  const scopes = new Set<GovernanceAuthorityScope>();
  for (const clause of directRequestClauses(value, action)) {
    if (hasNegatedGovernanceAction(clause)) continue;
    const skillSubject = /\b(?:skill|skills)\b/i;
    const governorSubject = /\b(?:skill-(?:governor|govenor)|governor|govenor|guard|guards|schutzmechanismus|schutzmechanismen|protection\s+mechanisms?|permission\s+governance)\b/i;
    const alarmSubject = /\b(?:alarm|alarms|soundalarm)\b/i;
    const updaterSubject = /\b(?:pi-autoupdate|update-extension|updater)\b/i;
    if (skillSubject.test(clause) && !clauseExcludes(clause, skillSubject)) scopes.add("skill-files");
    if (governorSubject.test(clause) && !clauseExcludes(clause, governorSubject)) scopes.add("governor-runtime");
    if (alarmSubject.test(clause) && !clauseExcludes(clause, alarmSubject)) scopes.add("alarm-extension");
    if (updaterSubject.test(clause) && !clauseExcludes(clause, updaterSubject)) scopes.add("update-extension");
  }
  return scopes.size > 0 ? { scopes: [...scopes] } : null;
}

export function hasExplicitGovernanceMutationIntent(value: string): boolean {
  return parseGovernanceAuthorization(value) !== null;
}

function splitShellSegments(command: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  const flush = () => { if (current.trim()) segments.push(current.trim()); current = ""; };
  for (let index = 0; index < command.length; index++) {
    const char = command[index]!;
    if (escaped) { current += char; escaped = false; continue; }
    if (char === "\\" && quote !== "'") { current += char; escaped = true; continue; }
    if (quote) { current += char; if (char === quote) quote = null; continue; }
    if (char === "'" || char === '"') { quote = char; current += char; continue; }
    if (char === "\n" || char === ";" || char === "|" || char === "&") {
      flush();
      if ((char === "|" || char === "&") && command[index + 1] === char) index++;
      continue;
    }
    current += char;
  }
  flush();
  return segments;
}

function shellTokens(segment: string): string[] {
  const matches = segment.match(/"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g) ?? [];
  return matches.map((token) => {
    const trimmed = token.replace(/^[({!]+|[)}]+$/g, "");
    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
    return trimmed.replace(/\\(["'\\\\\\s])/g, "$1");
  }).filter(Boolean);
}

interface ShellMutationPlan {
  paths: string[];
  roots: string[];
}

function commandBase(value: string): string {
  return value.replace(/\\/g, "/").split("/").pop()!.toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, "");
}

function cleanMutationToken(value: string): string {
  const trimmed = value.trim().replace(/^[({!]+|[)},;]+$/g, "");
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function shellOperands(args: string[]): string[] {
  return args.map(cleanMutationToken).filter((arg) => arg
    && !arg.startsWith("-")
    && !/^\/(?:s|q|f|y|a|p)$/i.test(arg)
    && !/^\d*(?:>>?|<<?)/.test(arg));
}

function outputRedirectionTargets(segment: string): string[] {
  const targets: string[] = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (let index = 0; index < segment.length; index++) {
    const char = segment[index]!;
    if (escaped) { escaped = false; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; continue; }
    if (quote) { if (char === quote) quote = null; continue; }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (char !== ">") continue;
    let cursor = index + 1;
    if (segment[cursor] === ">") cursor++;
    if (segment[cursor] === "|") cursor++;
    while (/\s/.test(segment[cursor] ?? "")) cursor++;
    if (!segment[cursor] || segment[cursor] === "&") continue;
    let target = "";
    const targetQuote = segment[cursor] === "'" || segment[cursor] === '"' ? segment[cursor++]! : null;
    while (cursor < segment.length) {
      const next = segment[cursor]!;
      if (targetQuote ? next === targetQuote : /[\s;&|]/.test(next)) break;
      target += next;
      cursor++;
    }
    const cleaned = cleanMutationToken(target);
    if (cleaned && !/^&?\d+$/.test(cleaned)) targets.push(cleaned);
    index = cursor;
  }
  return targets;
}

function shellMutationPlan(command: string, depth = 0): ShellMutationPlan {
  const paths: string[] = [];
  const roots: string[] = [];
  if (depth > 3) return { paths, roots };
  for (const segment of splitShellSegments(command)) {
    paths.push(...outputRedirectionTargets(segment));
    const tokens = shellTokens(segment);
    let index = 0;
    while (commandBase(tokens[index] ?? "") === "rtk") index++;
    while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index++;
    while (["command", "env"].includes(commandBase(tokens[index] ?? ""))) {
      index++;
      while ((tokens[index] ?? "").startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[index] ?? "")) index++;
    }
    if (["sudo", "runas"].includes(commandBase(tokens[index] ?? ""))) index++;
    const base = commandBase(tokens[index] ?? "");
    const args = tokens.slice(index + 1);
    if (!base) continue;

    if (["bash", "sh", "zsh", "cmd", "powershell", "pwsh"].includes(base)) {
      const flagIndex = args.findIndex((arg) => ["-c", "-command", "/c"].includes(arg.toLowerCase()));
      if (flagIndex >= 0 && args[flagIndex + 1]) {
        const nested = shellMutationPlan(args.slice(flagIndex + 1).join(" "), depth + 1);
        paths.push(...nested.paths);
        roots.push(...nested.roots);
      }
      continue;
    }

    if (base === "git") {
      let cursor = 0;
      let gitRoot = ".";
      while (cursor < args.length && args[cursor]!.startsWith("-")) {
        const rawOption = args[cursor]!;
        const option = rawOption.toLowerCase();
        if (rawOption === "-C" && args[cursor + 1]) {
          gitRoot = cleanMutationToken(args[cursor + 1]!);
          cursor += 2;
          continue;
        }
        if (["-c", "--git-dir", "--work-tree"].includes(option)) {
          if (option === "--work-tree" && args[cursor + 1]) gitRoot = cleanMutationToken(args[cursor + 1]!);
          cursor += 2;
          continue;
        }
        if (option.startsWith("--work-tree=")) gitRoot = cleanMutationToken(rawOption.slice("--work-tree=".length));
        cursor++;
      }
      const subcommand = (args[cursor] ?? "").toLowerCase();
      const tail = args.slice(cursor + 1);
      if (["apply", "checkout", "restore", "reset", "clean"].includes(subcommand)) roots.push(gitRoot);
      if (["checkout", "restore", "rm", "mv"].includes(subcommand)) paths.push(...shellOperands(tail));
      continue;
    }

    const operands = shellOperands(args);
    if (["cp", "copy", "copy-item"].includes(base)) {
      const targetDirectory = args.find((arg) => /^--target-directory=/.test(arg))?.split("=", 2)[1];
      const shortTarget = args.findIndex((arg) => arg === "-t" || arg === "--target-directory");
      const destinationOption = args.findIndex((arg) => ["-destination", "-dest"].includes(arg.toLowerCase()));
      const destination = targetDirectory
        ?? (shortTarget >= 0 ? args[shortTarget + 1] : undefined)
        ?? (destinationOption >= 0 ? args[destinationOption + 1] : undefined)
        ?? operands.at(-1);
      if (destination) paths.push(cleanMutationToken(destination));
    } else if (["mv", "move", "move-item"].includes(base)) {
      paths.push(...operands);
    } else if (["rm", "del", "rmdir", "remove-item"].includes(base)) {
      paths.push(...operands);
    } else if (["touch", "mkdir", "new-item"].includes(base)) {
      paths.push(...operands);
    } else if (["set-content", "out-file", "add-content"].includes(base)) {
      const pathOption = args.findIndex((arg) => ["-path", "-literalpath", "-filepath"].includes(arg.toLowerCase()));
      const target = pathOption >= 0 ? args[pathOption + 1] : operands[0];
      if (target) paths.push(cleanMutationToken(target));
    } else if (base === "tee") {
      paths.push(...operands);
    } else if (base === "patch") {
      roots.push(".");
    } else if ((base === "sed" && args.some((arg) => arg === "-i" || /^-i./.test(arg) || arg === "--in-place" || /^--in-place=/.test(arg)))
      || (base === "perl" && args.some((arg) => /^-[^\s]*pi/.test(arg)))) {
      paths.push(...operands);
    }
  }
  return { paths: [...new Set(paths)], roots: [...new Set(roots)] };
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
  let governanceAuthorization: GovernanceAuthorization | null = null;
  const approvedSkillReads = new Set<string>();
  const approvedWrites = new Set<string>();

  const governedTargetScope = (absolute: string, canonical = absolute): GovernanceAuthorityScope | undefined => {
    const values = [normalizePath(absolute), normalizePath(canonical)];
    const inside = (root: string) => values.some((value) => isWithin(value, root));
    const projectsRoot = join(paths.agentDir, "projects-memory");
    const insideProjectSkill = values.some((value) => {
      if (!isWithin(value, projectsRoot)) return false;
      const segments = relative(resolve(projectsRoot), resolve(value)).split(/[\\/]/).filter(Boolean);
      return segments.length >= 2 && segments[1]?.toLowerCase() === "skills";
    });
    if (inside(join(paths.agentDir, "skills"))
      || insideProjectSkill
      || inside(join(paths.agentDir, "pi-hermes-memory", "skills"))) return "skill-files";
    if (inside(join(paths.agentDir, "extensions", "skill-governor")) || inside(paths.root)) return "governor-runtime";
    if (values.includes(normalizePath(join(paths.agentDir, "extensions", "alarm-sound.ts")))) return "alarm-extension";
    if (values.includes(normalizePath(join(paths.agentDir, "extensions", "pi-autoupdate.ts")))) return "update-extension";
    return undefined;
  };

  const hasAuthorityFor = (scope: GovernanceAuthorityScope) => governanceAuthorization?.scopes.includes(scope) === true;

  const governedScopesAffectedByRoot = (absolute: string, canonical = absolute): GovernanceAuthorityScope[] => {
    const scopes = new Set<GovernanceAuthorityScope>();
    const roots = [normalizePath(absolute), normalizePath(canonical)];
    const contains = (target: string) => roots.some((root) => isWithin(target, root));
    const direct = governedTargetScope(absolute, canonical);
    if (direct) scopes.add(direct);
    if (contains(join(paths.agentDir, "skills"))
      || contains(join(paths.agentDir, "projects-memory"))
      || contains(join(paths.agentDir, "pi-hermes-memory", "skills"))) scopes.add("skill-files");
    if (contains(join(paths.agentDir, "extensions", "skill-governor")) || contains(paths.root)) scopes.add("governor-runtime");
    if (contains(join(paths.agentDir, "extensions", "alarm-sound.ts"))) scopes.add("alarm-extension");
    if (contains(join(paths.agentDir, "extensions", "pi-autoupdate.ts"))) scopes.add("update-extension");
    return [...scopes];
  };

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
    governanceAuthorization = null;
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
      const nextAuthorization = parseGovernanceAuthorization(event.text);
      if (nextAuthorization) governanceAuthorization = nextAuthorization;
      else if (hasNegatedGovernanceAction(event.text)) governanceAuthorization = null;
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
            reason: `Skill '${cached.snapshot.skill.name}' is manual/canary. Use skill_route(action='load', name='${cached.snapshot.skill.name}'); loading its text is read-only and does not authorize its actions.`,
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
      const targetScope = governedTargetScope(absolute, canonical);
      if (config.protectActiveSkillFiles && targetScope) {
        const oneShotApproved = approvedWrites.delete(normalized);
        if (!oneShotApproved && !hasAuthorityFor(targetScope)) {
          return {
            block: true,
            reason: `Security-sensitive ${targetScope} mutation was blocked automatically; no user yes/no decision is needed. Continue only after a direct, scope-matching natural-language request or an exact /skill-governor allow-write command.`,
          };
        }
        if (!oneShotApproved) {
          await appendEvidence(paths, { type: "explicit_user_authority", action: "governed-write", targetScope, pathHash: sha256(normalized) }).catch(() => undefined);
        }
      }
      observation.changedFiles.add(path);
    }

    if (event.toolName === "bash") {
      const command = String((event.input as { command?: unknown }).command ?? "");
      observation.commands.push(safeCommandSummary(command));
      const plan = shellMutationPlan(command);
      const mutationScopes = new Set<GovernanceAuthorityScope>();
      for (const target of plan.paths) {
        const absolute = absoluteFrom(target, ctx.cwd);
        const scope = governedTargetScope(absolute, await canonicalTarget(absolute));
        if (scope) mutationScopes.add(scope);
      }
      for (const root of plan.roots) {
        const absolute = absoluteFrom(root, ctx.cwd);
        const canonical = await canonicalTarget(absolute);
        for (const scope of governedScopesAffectedByRoot(absolute, canonical)) mutationScopes.add(scope);
      }
      if (config.protectActiveSkillFiles && mutationScopes.size > 0) {
        const missing = [...mutationScopes].filter((scope) => !hasAuthorityFor(scope));
        if (missing.length > 0) {
          return {
            block: true,
            reason: `Shell mutation of security-sensitive ${missing.join(", ")} files was blocked automatically; do not ask the user to approve the raw command. Use typed edit/write after a direct scope-matching request.`,
          };
        }
        await appendEvidence(paths, { type: "explicit_user_authority", action: "governed-shell-mutation", targetScopes: [...mutationScopes], commandHash: sha256(command) }).catch(() => undefined);
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
    description: "Search and lazy-load governed manual/canary instructions. Loading text is read-only and never authorizes the actions it describes; actual consequential actions remain separately guarded.",
    promptSnippet: "Search or read governed manual skills when a hidden specialized procedure is needed",
    promptGuidelines: [
      "Use skill_route only for a concrete hidden capability. Loading a skill body is read-only; never treat it as permission to run release, install, destructive, or broad validation actions.",
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
    description: "Audit skills or propose a quarantined reusable procedure. This tool cannot activate, retire, delete, or overwrite a skill; those authority actions require an explicit user slash command, not a technical yes/no popup.",
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
        const override = rest.includes("--override");
        const [id, tierRaw = "canary"] = rest.filter((item) => item !== "--override");
        const tier = tierRaw === "active" ? "active" : "canary";
        const loaded = id ? await loadCandidate(paths, id) : null;
        if (!loaded) { ctx.ui.notify("Usage: /skill-governor promote <candidate-id> [canary|active] [--override]", "error"); return; }
        if (tier === "active") {
          const qualification = activeEvidenceQualifies(loaded.manifest, config);
          if (!qualification.ok && !override) {
            ctx.ui.notify(`Activation blocked: ${qualification.reason}\nTo deliberately bypass this gate, run the same command with --override.`, "warning");
            return;
          }
        }
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
        approvedWrites.add(normalizePath(path));
        ctx.ui.notify(`One write/edit call approved for ${path}`, "warning");
        return;
      }
      ctx.ui.notify("Usage: /skill-governor status|candidates|audit <name>|evolve|evidence <id> <json-file>|promote <id> [canary|active] [--override]|retire <name> <reason>|rollback <id>|allow-write <path>", "warning");
    },
  });
}
