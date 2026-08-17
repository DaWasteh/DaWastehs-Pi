import type { Api, Model } from "@earendil-works/pi-ai";
import { basename } from "node:path";
import { completeSimple, type Message, type SimpleStreamOptions } from "@earendil-works/pi-ai/compat";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { sha256 } from "./policy.ts";
import type { CriticFinding, CriticResult, GeneratedCandidate, GovernorConfig, RunObservation } from "./types.ts";

interface CompletionContext {
  model?: Model<Api>;
  modelRegistry: ExtensionContext["modelRegistry"];
}

function exactModel(reference: string | undefined, models: Model<Api>[]): Model<Api> | undefined {
  const wanted = reference?.trim().toLowerCase();
  if (!wanted) return undefined;
  const matches = models.filter((model) => `${model.provider}/${model.id}`.toLowerCase() === wanted);
  return matches.length === 1 ? matches[0] : undefined;
}

function responseText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => (
      !!block && typeof block === "object" && (block as { type?: string }).type === "text"
    ))
    .map((block) => block.text)
    .join("\n");
}

function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

async function completeJson(
  ctx: CompletionContext,
  modelReference: string | undefined,
  thinking: GovernorConfig["evolution"]["criticThinking"],
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
  timeoutMs = 120_000,
  requireConfiguredModel = false,
): Promise<{ payload: unknown; model: string; text: string }> {
  const configuredModel = exactModel(modelReference, ctx.modelRegistry.getAll());
  if (requireConfiguredModel && modelReference?.trim() && !configuredModel) {
    throw new Error(`Configured governor model is not in the active registry: ${modelReference}`);
  }
  const model = configuredModel ?? ctx.model;
  if (!model) throw new Error(`Governor model is unavailable: ${modelReference ?? "current"}`);
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error);
  const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Skill governor LLM call timed out.")), timeoutMs);
  const onAbort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  const message: Message = {
    role: "user",
    content: [{ type: "text", text: userPrompt }],
    timestamp: Date.now(),
  };
  const options: SimpleStreamOptions = {
    headers: auth.headers,
    env: auth.env,
    signal: controller.signal,
  };
  if (auth.apiKey) options.apiKey = auth.apiKey;
  if (model.reasoning && thinking && thinking !== "off") options.reasoning = thinking;
  try {
    const response = await completeSimple(requestModel, { systemPrompt, messages: [message] }, options);
    if (response.stopReason === "aborted") throw new Error("Skill governor LLM call was aborted.");
    const text = responseText(response.content);
    const payload = extractJson(text);
    if (payload === null) throw new Error(`Skill governor returned invalid JSON: ${text.slice(0, 300)}`);
    return { payload, model: `${model.provider}/${model.id}`, text };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
  }
}

export function redactForModel(value: string, maxChars: number): string {
  return value
    .replace(/[\u200b\u200c\u200d\u2060\ufeff\u202a-\u202e]/gu, "")
    .replace(/-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----/gi, "[REDACTED_PRIVATE_KEY]")
    .replace(/-----BEGIN\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----[\s\S]*$/gi, "[REDACTED_UNTERMINATED_PRIVATE_KEY]")
    .replace(/(?:^|\n)[A-Za-z0-9+/=\r\n]{80,}-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----/gi, "\n[REDACTED_ORPHAN_PRIVATE_KEY_BLOCK]")
    .replace(/^.*-----END\s+(?:RSA\s+|OPENSSH\s+|EC\s+|DSA\s+|ENCRYPTED\s+)?PRIVATE\s+KEY-----.*$/gim, "[REDACTED_ORPHAN_PRIVATE_KEY_END]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{12,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED_TOKEN]")
    .replace(/\b(?:password|secret|token|api[_-]?key|credential)\s*[=:]\s*[^\s,;]+/gi, "$1=[REDACTED]")
    .replace(/(?:[A-Za-z]:[\\/]|\/(?:home|Users)\/)[^\s\"'`]+/g, "[LOCAL_PATH]")
    .slice(0, maxChars);
}

function commandKinds(commands: string[]): string[] {
  const kinds = new Set<string>();
  for (const command of commands) {
    if (/\b(?:test|pytest|ctest|unittest|lint|ruff|mypy)\b/i.test(command)) kinds.add("test");
    if (/\b(?:build|cmake|msbuild|ninja|compile)\b/i.test(command)) kinds.add("build");
    if (/\bgit\s+(?:status|diff|show)\b/i.test(command)) kinds.add("git-read");
    if (/\b(?:python|node|powershell|bash|cmd)\b/i.test(command)) kinds.add("script");
  }
  return [...kinds].sort();
}

function stringArray(value: unknown, maxItems = 24): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

export interface EvolutionSource {
  projectName?: string;
  userPrompt: string;
  assistantSummary: string;
  observation: RunObservation;
}

export async function generateCandidate(
  ctx: CompletionContext,
  config: GovernorConfig,
  source: EvolutionSource,
  signal?: AbortSignal,
): Promise<{ candidate: GeneratedCandidate; model: string }> {
  const systemPrompt = `You propose quarantined procedural skills from completed coding work. A proposal is not active policy.

Return JSON only:
{
  "skip": false,
  "reason": "",
  "name": "lowercase-hyphen-slug",
  "description": "Narrow capability, positive triggers, and adjacent cases where it must not be used.",
  "scope": "global|project",
  "whenToUse": "Specific trigger and explicit non-trigger.",
  "procedureSteps": ["Smallest reusable steps"],
  "pitfalls": ["Task-specific assumptions not to generalize"],
  "verificationSteps": ["Smallest targeted falsification check"]
}

Set skip=true when the work is one-off, obvious, environment-specific without stable causality, already covered by a loaded skill, or cannot be generalized safely. Never include credentials, private prompt text, task progress, release authority, destructive defaults, global package updates, untrusted egress, or instructions to weaken verification. Explicit task requirements always outrank examples/defaults. Prefer a narrow project skill over a broad global skill.`;
  const configuredProvider = config.evolution.generatorModel?.split("/", 1)[0];
  if (!config.evolution.allowCrossProvider && ctx.model && configuredProvider && configuredProvider !== ctx.model.provider) {
    throw new Error("Cross-provider automatic evolution is disabled.");
  }
  const userPrompt = JSON.stringify({
    projectName: source.projectName ?? null,
    task: redactForModel(source.userPrompt, 2000),
    finalSummary: redactForModel(source.assistantSummary, 2000),
    toolTypes: [...source.observation.toolTypes].sort(),
    changedFiles: [...source.observation.changedFiles].slice(0, 40).map((path) => basename(path)),
    commandKinds: commandKinds(source.observation.commands),
    loadedSkills: [...source.observation.skillReads].slice(0, 20),
    toolErrors: source.observation.toolErrors,
  }, null, 2);
  const result = await completeJson(
    ctx,
    config.evolution.generatorModel,
    config.evolution.generatorThinking,
    systemPrompt,
    userPrompt,
    signal,
    120_000,
    true,
  );
  const raw = result.payload as Record<string, unknown>;
  const skip = raw.skip === true;
  const candidate: GeneratedCandidate = {
    skip,
    reason: typeof raw.reason === "string" ? raw.reason.trim() : undefined,
    name: typeof raw.name === "string" ? raw.name.trim() : undefined,
    description: typeof raw.description === "string" ? raw.description.trim() : undefined,
    scope: raw.scope === "project" ? "project" : raw.scope === "global" ? "global" : undefined,
    whenToUse: typeof raw.whenToUse === "string" ? raw.whenToUse.trim() : undefined,
    procedureSteps: stringArray(raw.procedureSteps),
    pitfalls: stringArray(raw.pitfalls),
    verificationSteps: stringArray(raw.verificationSteps),
  };
  if (!candidate.skip) {
    if (!candidate.name || !candidate.description || !candidate.scope || !candidate.whenToUse) {
      throw new Error("Candidate generator omitted required fields.");
    }
    if ((candidate.procedureSteps?.length ?? 0) === 0 || (candidate.verificationSteps?.length ?? 0) === 0) {
      throw new Error("Candidate generator omitted procedure or verification steps.");
    }
  }
  return { candidate, model: result.model };
}

function criticFindings(value: unknown): CriticFinding[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.category !== "string" || typeof row.reason !== "string") return [];
    return [{
      category: row.category.trim(),
      quote: typeof row.quote === "string" ? row.quote.trim() : "",
      reason: row.reason.trim(),
    }];
  }).slice(0, 8);
}

export function parseCriticResult(payload: unknown, model: string, markdown: string): CriticResult {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Critic response must be an object.");
  const raw = payload as Record<string, unknown>;
  if (raw.decision !== "pass" && raw.decision !== "repair" && raw.decision !== "reject") {
    throw new Error("Critic response has an invalid or missing decision.");
  }
  if (typeof raw.risk !== "number" || !Number.isFinite(raw.risk) || raw.risk < 0 || raw.risk > 1
    || typeof raw.confidence !== "number" || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) {
    throw new Error("Critic response has invalid risk/confidence values outside [0,1].");
  }
  const deleteSpans = stringArray(raw.deleteSpans, 12);
  if (raw.decision === "repair" && deleteSpans.length === 0) {
    throw new Error("Critic requested repair without exact delete spans.");
  }
  return {
    decision: raw.decision,
    risk: raw.risk,
    confidence: raw.confidence,
    findings: criticFindings(raw.findings),
    deleteSpans,
    rationale: typeof raw.rationale === "string" ? raw.rationale.trim().slice(0, 1200) : "",
    model,
    candidateSha256: sha256(markdown),
  };
}

export async function criticizeCandidate(
  ctx: CompletionContext,
  config: GovernorConfig,
  markdown: string,
  lineage: string[],
  signal?: AbortSignal,
): Promise<CriticResult> {
  const systemPrompt = `Audit a quarantined SKILL.md as durable reusable policy, not as a one-off answer. Ordinary narrow useful procedures should pass.

Inspect the complete candidate and lineage for:
- unsafe generalization or task-label spillover;
- explicit removal/avoidance of required verification;
- unauthorized privilege, irreversible/destructive action, untrusted egress, or secret handling;
- hard-coded environment assumptions presented as universal;
- task requirements, paths, APIs, or formats being replaced by examples/defaults;
- mandatory full-suite, broad exploration, installation, release, or heavyweight pipeline work unrelated to the narrow trigger.

Return JSON only:
{
  "decision": "pass|repair|reject",
  "risk": 0.0,
  "confidence": 0.0,
  "findings": [{"category":"...","quote":"exact candidate span","reason":"..."}],
  "deleteSpans": ["exact unique candidate text to delete"],
  "rationale": "one concise paragraph"
}

Use repair only when deleting the exact localized spans leaves a complete useful skill. Do not propose added safeguards or rewritten replacement text; deleteSpans must be exact verbatim substrings. Reject when safe utility cannot survive subtraction. Pass is the default when no active unsafe or over-prescriptive instruction exists.`;
  const result = await completeJson(
    ctx,
    config.evolution.criticModel,
    config.evolution.criticThinking,
    systemPrompt,
    JSON.stringify({ lineage, candidate: markdown }, null, 2),
    signal,
    120_000,
    true,
  );
  return parseCriticResult(result.payload, result.model, markdown);
}
