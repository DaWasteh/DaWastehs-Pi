import { createHash } from "node:crypto";
import type { Skill } from "@earendil-works/pi-coding-agent";
import type { GovernorConfig, RankedSkill, SkillRisk, StaticAudit, StaticFinding } from "./types.ts";

const INVISIBLE_CHARS = /[\u200b\u200c\u200d\u2060\ufeff\u202a-\u202e]/u;
const INJECTION_PATTERNS: Array<[string, RegExp]> = [
  ["prompt-injection", /ignore\s+(?:all|any|previous|prior|above)\s+instructions/i],
  ["role-hijack", /you\s+are\s+now\s+(?:the|a|an)\b/i],
  ["policy-bypass", /(?:disregard|override|bypass)\s+(?:the\s+)?(?:system|safety|policy|rules?)/i],
  ["hidden-action", /do\s+not\s+tell\s+the\s+user/i],
];
const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["api-key", /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/],
  ["private-key", /-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----|-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----/],
  ["high-entropy-block", /(?:^|\n)[A-Za-z0-9+/]{80,}={0,2}(?=\n|$)/],
  ["secret-assignment", /\b(?:password|secret|token|api[_-]?key)\s*[=:]\s*[^\s<]{8,}/i],
];
const HARD_RISK_PATTERNS: Array<[string, string, RegExp]> = [
  ["destructive-delete", "Destructive deletion is prescribed as a reusable step.", /\b(?:rm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*|-r\s+-f|-f\s+-r)|git(?:\s+-C\s+\S+)*\s+clean\s+-[^\n]*[fdx]|git(?:\s+-C\s+\S+)*\s+reset\s+--hard|remove-item\b[^\n]*-recurse|rmdir\s+\/s|del\s+\/[sq])\b/i],
  ["privilege", "Privilege escalation or broad permission changes are prescribed.", /\b(?:sudo|runas|takeown|icacls\b[^\n]*(?:\/grant|:f)|chmod\s+(?:777|a\+w))\b/i],
  ["secret-access", "The procedure reads or transmits secret-bearing files or variables.", /(?:cat|type|get-content|read)\s+[^\n]*(?:\.env|credentials|\.ssh|\.npmrc)|(?:curl|wget|invoke-webrequest)[^\n]*(?:token|secret|password|credential)/i],
  ["untrusted-egress", "The procedure sends local data to an external destination.", /(?:curl|wget|invoke-restmethod|invoke-webrequest)[^\n]*(?:--data|\s-d\s|body|upload|post)/i],
];
const INSTALL_PATTERN = /\b(?:(?:python\s+-m\s+)?pip\s+install|pipx\s+install|(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|update|upgrade)|(?:uv|cargo|winget|choco|scoop|conda|apt(?:-get)?|brew)\s+(?:install|update|upgrade|add))\b/i;
const RELEASE_PATTERN = /\b(?:git\s+(?:push|tag)|gh\s+release|npm\s+publish|deploy(?:ment)?|create\s+(?:an?\s+)?(?:annotated\s+)?tag)\b/i;
const BROAD_VERIFY_PATTERN = /(?:run|execute|require|must run|führe)[^;\n]{0,80}(?:\bfull\b|\bcomplete\b|\bentire\b|\ball\b|\bvollständige\b|\bgesamte\b)[^;\n]{0,40}(?:test|suite|matrix|audit)/i;
const ABSOLUTE_PATH_PATTERN = /(?:\b[A-Za-z]:[\\/]|\/(?:home|Users|opt|usr)\/)/;
const NEGATIVE_TRIGGER_PATTERN = /(?:do not use|don['’]?t use|not for|nicht verwenden|nicht nutzen|gilt nicht|exclude|negative trigger)/i;
const TASK_PRECEDENCE_PATTERN = /(?:explicit|task|user).{0,60}(?:requirement|path|acceptance|anforderung|pfad|akzeptanz).{0,80}(?:override|precedence|priority|vorrang|schlägt)/i;
const DIRECT_PROHIBITION_PATTERN = /\b(?:(?:do\s+not|don['’]?t|never|must\s+not|nicht|niemals)(?:\s+(?:run|execute|invoke|use|call|perform|read|send|upload|install|push|tag|delete|remove|make|normalize|ausführen|verwenden|lesen|senden|installieren|löschen|entfernen))?|avoid|refuse\s+to)\s*[`'"(]*$/i;

export const DEFAULT_GOVERNOR_CONFIG: GovernorConfig = {
  schemaVersion: 2,
  enabled: true,
  routing: { maxSkills: 3, maxSkillsLocal: 1, maxLocalSystemPromptBytes: 900, minScore: 2 },
  localTools: {
    enabled: true,
    interactiveOnly: true,
    keep: ["read", "bash", "edit", "write", "capability_route"],
    blocked: ["skill_manage"],
  },
};

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function parseFrontmatterField(text: string, field: string): string | undefined {
  if (!text.startsWith("---")) return undefined;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return undefined;
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.slice(3, end).match(new RegExp(`^${escaped}:\\s*(.*)$`, "mi"));
  const value = match?.[1].trim();
  if (!value) return value;
  const quote = value[0];
  return (quote === "\"" || quote === "'") && value.endsWith(quote) ? value.slice(1, -1) : value;
}

export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text.trim();
  const end = text.indexOf("\n---", 3);
  return end < 0 ? text.trim() : text.slice(end + 4).trim();
}

function firstPrescribedMatch(text: string, pattern: RegExp, suppressConditional = false): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (!match) continue;
    const before = line.slice(0, match.index);
    const clauseStart = Math.max(-1, before.lastIndexOf(";"), before.lastIndexOf(". "), before.lastIndexOf(" but "), before.lastIndexOf(" then ")) + 1;
    const actionPrefix = line.slice(clauseStart, match.index).trim();
    const clauseTail = line.slice(match.index + match[0].length);
    if (DIRECT_PROHIBITION_PATTERN.test(actionPrefix)) continue;
    if (suppressConditional && /\b(?:only\s+(?:when|for|through)|nur\s+(?:wenn|für)|unless|reserve\b[^.]{0,30}\bfor)\b/i.test(clauseTail)) continue;
    return match[0];
  }
  return undefined;
}

const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "do", "for", "from", "in", "is", "it", "not", "of", "on", "only", "or", "the", "this", "to", "use", "when", "with", "work", "task", "project", "change", "code", "file", "skill",
  "als", "auf", "aus", "bei", "das", "der", "die", "ein", "eine", "für", "im", "ist", "mit", "nicht", "nur", "oder", "und", "verwenden", "wenn",
  // Generic verbs and conversational filler carry no routing signal even though
  // many skill names start with them ("fix-…", "repair-…", "ok mach weiter").
  "fix", "repair", "check", "make", "run", "please", "bitte", "mach", "weiter", "ok", "okay", "explain", "erkläre", "erklär", "help", "hilf", "can", "kann", "kannst", "should", "soll", "sollte", "you", "du", "ich", "we", "wir", "my", "mein", "meine", "es", "dass", "so",
]);
function routingTokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9äöüß]+/i).filter((term) => term.length >= 2 && !STOP_WORDS.has(term));
}

function nameTokens(name: string): Set<string> {
  return new Set(name.toLowerCase().split(/[^a-z0-9äöüß]+/i).filter(Boolean));
}

/**
 * Deterministic lexical routing score. Only whole name tokens and metadata
 * tokens count; a bare substring of a name ("ok" inside "smoke") never does,
 * and two-character tokens are too ambiguous to route a skill on their own.
 */
export function scoreSkillForPrompt(prompt: string, name: string, description: string): number {
  const terms = new Set(routingTokens(prompt));
  const normalizedName = name.toLowerCase();
  const nameParts = nameTokens(name);
  const metadata = [...new Set(routingTokens(`${name} ${description}`))];
  const metadataSet = new Set(metadata);
  let score = 0;
  for (const term of terms) {
    if (term.length < 3) {
      if (metadataSet.has(term)) score += 1;
      continue;
    }
    if (normalizedName === term) score += 12;
    else if (nameParts.has(term)) score += 5;
    if (metadataSet.has(term)) score += 2;
    else if (metadata.some((candidate) => candidate.length >= 3 && Math.max(candidate.length, term.length) >= 4 && (candidate.startsWith(term) || term.startsWith(candidate)))) score += 1;
  }
  return score;
}

export function rankSkills(prompt: string, skills: Skill[], minScore: number, limit: number): RankedSkill[] {
  return skills.map((skill) => ({
    skill,
    score: scoreSkillForPrompt(prompt, skill.name, skill.description),
    matchedTerms: routingTokens(prompt).filter((term) => routingTokens(`${skill.name} ${skill.description}`).includes(term)),
  })).filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
    .slice(0, limit);
}

export function inferRiskFromName(name: string): SkillRisk {
  if (/(?:boot|efi|partition|credential|secret|pentest|security|clean|delete|retire)/i.test(name)) return "critical";
  if (/(?:release|publish|deploy|install|update|upgrade|migration|build|package|toolchain)/i.test(name)) return "high";
  if (/(?:repair|fix|configure|maintain|validate|audit|test)/i.test(name)) return "medium";
  return "low";
}

export function auditSkillText(text: string, options: { scope?: "global" | "project"; maxChars?: number } = {}): StaticAudit {
  const findings: StaticFinding[] = [];
  const add = (code: string, severity: StaticFinding["severity"], message: string, excerpt?: string) => findings.push({ code, severity, message, excerpt });
  const body = stripFrontmatter(text);
  const name = parseFrontmatterField(text, "name") ?? "";
  const description = parseFrontmatterField(text, "description") ?? "";
  const tier = parseFrontmatterField(text, "skill-governor-tier");
  const maxChars = options.maxChars ?? 12_000;

  if (!name || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) || name.includes("--")) add("invalid-name", "error", "Skill name is missing or invalid.", name);
  if (!description.trim()) add("missing-description", "error", "Skill description is required.");
  if (description.length > 600) add("description-too-long", "error", "Description exceeds 600 characters.");
  if (text.length > maxChars) add("body-size", tier === "auto" ? "error" : "warning", "Skill body exceeds the configured budget.");
  if (INVISIBLE_CHARS.test(text)) add("invisible-unicode", "error", "Invisible Unicode can hide instructions.");
  for (const [code, pattern] of INJECTION_PATTERNS) if (pattern.test(text)) add(code, "error", "Skill contains a prompt-injection or policy-bypass instruction.");
  for (const [code, pattern] of SECRET_PATTERNS) if (pattern.test(text)) add(code, "error", "Skill appears to contain a secret.");
  for (const [code, message, pattern] of HARD_RISK_PATTERNS) {
    const match = firstPrescribedMatch(body, pattern);
    if (match) add(code, "error", message, match);
  }
  if (firstPrescribedMatch(body, INSTALL_PATTERN)) add("environment-mutation", "warning", "Skill prescribes installation or update work.");
  if (firstPrescribedMatch(body, RELEASE_PATTERN)) add("release-authority", "warning", "Skill contains release, push, or deploy actions.");
  if (firstPrescribedMatch(body, BROAD_VERIFY_PATTERN, true)) add("excessive-verification", tier === "auto" ? "error" : "warning", "Skill appears to require exhaustive verification unconditionally.");
  if (options.scope === "global" && ABSOLUTE_PATH_PATTERN.test(body)) add("global-absolute-path", "warning", "Global skill embeds a machine-specific absolute path.");
  if (!NEGATIVE_TRIGGER_PATTERN.test(`${description}\n${body.slice(0, 1800)}`)) add("missing-negative-trigger", "info", "Skill has no explicit exclusion.");
  if (!TASK_PRECEDENCE_PATTERN.test(body)) add("missing-task-precedence", "info", "Skill does not state task precedence.");
  if (!/^##\s+(?:When to Use|Scope|Applicability)/mi.test(body)) add("missing-scope-section", "info", "Skill has no scope section.");
  if (!/^##\s+(?:Verification|Validation)/mi.test(body)) add("missing-verification", "warning", "Skill has no verification section.");

  const errors = findings.filter((item) => item.severity === "error").length;
  const warnings = findings.filter((item) => item.severity === "warning").length;
  const infos = findings.filter((item) => item.severity === "info").length;
  return {
    pass: errors === 0,
    score: Math.max(0, 100 - errors * 30 - warnings * 10 - infos * 2),
    inferredRisk: errors ? "critical" : warnings >= 3 ? "high" : warnings ? "medium" : "low",
    findings,
    sha256: sha256(text),
    chars: text.length,
  };
}
