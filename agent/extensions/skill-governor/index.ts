import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatSkillsForPrompt } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, ExtensionContext, Skill } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { auditSkillText, DEFAULT_GOVERNOR_CONFIG, rankSkills, scoreSkillForPrompt } from "./policy.ts";
import type { GovernorConfig } from "./types.ts";

const SKILL_BLOCK = /\n*The following skills provide specialized instructions for specific tasks\.[\s\S]*?<\/available_skills>/g;
const COMPACT_LOCAL_PROMPT = "You are Pi, a coding agent. Obey exact user requirements and repository evidence. Before edits, read applicable AGENTS.md, CLAUDE.md, and PLAN.md. Use schema-valid active-tool calls; trust real results. Make the smallest complete safe change. Fix validator errors before success. Use capability_route for hidden skills/tools.";
// Provider IDs that always denote a local inference server. Anything else is
// classified by its base URL (loopback or unspecified-address origins).
const LOCAL_PROVIDERS = new Set(["llama-server", "llama.cpp", "autotuner", "ollama", "lmstudio", "vllm", "sglang"]);
const LOCAL_ORIGIN = /^https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]|\[::\])(?::\d+)?(?:\/|$)/i;
const MAX_ROUTE_DESCRIPTION_CHARS = 320;
/** Session entry type that remembers the governor-owned tool delta across /reload. */
const DELTA_ENTRY_TYPE = "skill-governor";

type ModelReference = { provider?: string; id?: string; baseUrl?: string };
type CapabilityMatch = { type: "skill" | "tool"; name: string; description: string; score: number; path?: string };
type DeltaEntryData = { removed?: unknown };

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? [...value] : fallback;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Field-wise validation: a malformed config.json degrades to the defaults instead of throwing at session start. */
export function mergeConfig(input: unknown): GovernorConfig {
  const raw = input && typeof input === "object" ? input as Record<string, unknown> : {};
  const routing = raw.routing && typeof raw.routing === "object" ? raw.routing as Record<string, unknown> : {};
  const localTools = raw.localTools && typeof raw.localTools === "object" ? raw.localTools as Record<string, unknown> : {};
  const defaults = DEFAULT_GOVERNOR_CONFIG;
  return {
    schemaVersion: 2,
    enabled: booleanOr(raw.enabled, defaults.enabled),
    routing: {
      maxSkills: positiveInteger(routing.maxSkills, defaults.routing.maxSkills),
      maxSkillsLocal: positiveInteger(routing.maxSkillsLocal, defaults.routing.maxSkillsLocal),
      maxLocalSystemPromptBytes: positiveInteger(routing.maxLocalSystemPromptBytes, defaults.routing.maxLocalSystemPromptBytes),
      minScore: positiveInteger(routing.minScore, defaults.routing.minScore),
    },
    localTools: {
      enabled: booleanOr(localTools.enabled, defaults.localTools.enabled),
      interactiveOnly: booleanOr(localTools.interactiveOnly, defaults.localTools.interactiveOnly),
      keep: stringArray(localTools.keep, defaults.localTools.keep),
      blocked: stringArray(localTools.blocked, defaults.localTools.blocked),
    },
  };
}

export function isLocal(model: ModelReference | undefined): boolean {
  if (!model) return false;
  const provider = (model.provider ?? "").toLowerCase();
  return LOCAL_PROVIDERS.has(provider)
    || /^llama-server=https?:\/\//i.test(provider)
    || LOCAL_ORIGIN.test(model.baseUrl ?? "");
}

function visibleSkill(skill: Skill): Skill {
  return skill.disableModelInvocation ? { ...skill, disableModelInvocation: false } : skill;
}

function boundedDescription(value: string): string {
  return value.length <= MAX_ROUTE_DESCRIPTION_CHARS ? value : `${value.slice(0, MAX_ROUTE_DESCRIPTION_CHARS - 1)}…`;
}

function truncateUtf8(value: string, maxBytes: number): string {
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(result + character, "utf8") > maxBytes) break;
    result += character;
  }
  return result;
}

function compactLocalPrompt(cwd: string, byteLimit: number): string {
  const prefix = `${COMPACT_LOCAL_PROMPT}\ncwd: `;
  return prefix + truncateUtf8(cwd, Math.max(0, byteLimit - Buffer.byteLength(prefix, "utf8")));
}

// Built from code points so the source never contains raw control characters.
const CONTROL_CHARS = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, "g");

function compactMetadata(value: string): string {
  return value.replace(CONTROL_CHARS, (character) => {
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return "";
  }).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function formatCompactLocalSkill(skill: Skill): string {
  return `\n<routed-skill>\nname: ${compactMetadata(skill.name)}\ndescription: ${compactMetadata(skill.description)}\npath: ${compactMetadata(resolve(skill.filePath))}\nRead this path when relevant.\n</routed-skill>`;
}

function skillMatches(query: string, catalog: Skill[], limit: number): CapabilityMatch[] {
  return rankSkills(query, catalog, 1, limit).map(({ skill, score }) => ({
    type: "skill",
    name: skill.name,
    description: boundedDescription(skill.description),
    path: skill.filePath,
    score,
  }));
}

function compareMatches(a: CapabilityMatch, b: CapabilityMatch): number {
  return b.score - a.score || a.name.localeCompare(b.name) || a.type.localeCompare(b.type);
}

export default function skillGovernor(pi: ExtensionAPI): void {
  const agentDir = process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent");
  const configPath = join(agentDir, "skill-governor", "config.json");
  let config = DEFAULT_GOVERNOR_CONFIG;
  let catalog: Skill[] = [];
  let currentLocal = false;
  let localProfileActive = false;
  let locallyRemoved = new Set<string>();
  let routeAdded = new Set<string>();

  /** The local profile (tool reduction and compact prompt) share one predicate. */
  const profileApplies = (ctx: Pick<ExtensionContext, "hasUI">): boolean =>
    config.enabled && config.localTools.enabled && (!config.localTools.interactiveOnly || ctx.hasUI);

  const rememberDelta = (): void => {
    try {
      pi.appendEntry<DeltaEntryData>(DELTA_ENTRY_TYPE, { removed: [...locallyRemoved] });
    } catch {
      // Entry persistence is best effort; the in-memory delta still works.
    }
  };

  const restoreOwnedDelta = (): void => {
    if (!localProfileActive) return;
    const active = new Set(pi.getActiveTools());
    for (const name of locallyRemoved) {
      active.add(name);
      routeAdded.delete(name);
    }
    pi.setActiveTools([...active]);
    locallyRemoved.clear();
    localProfileActive = false;
    rememberDelta();
  };

  const applyLocalTools = (ctx: Pick<ExtensionContext, "hasUI">, local: boolean): void => {
    if (!profileApplies(ctx) || !local) {
      restoreOwnedDelta();
      return;
    }
    if (localProfileActive) return;
    const blocked = new Set(config.localTools.blocked);
    const allowed = new Set(config.localTools.keep);
    const active = pi.getActiveTools();
    locallyRemoved = new Set(active.filter((name) => !allowed.has(name) || blocked.has(name)));
    pi.setActiveTools(active.filter((name) => allowed.has(name) && !blocked.has(name)));
    localProfileActive = true;
    rememberDelta();
  };

  /**
   * `/reload` rebuilds the extension with the already reduced tool set, so a
   * fresh instance would compute an empty delta and could never restore the
   * hidden tools after a switch to a cloud model. Re-add the delta persisted by
   * the previous instance before the normal profile logic runs again.
   */
  const recoverDeltaAfterReload = (ctx: ExtensionContext): void => {
    const entries = ctx.sessionManager.getEntries();
    for (let index = entries.length - 1; index >= 0; index--) {
      const entry = entries[index];
      if (entry.type !== "custom" || entry.customType !== DELTA_ENTRY_TYPE) continue;
      const removed = stringArray((entry.data as DeltaEntryData | undefined)?.removed, []);
      if (removed.length === 0) return;
      const known = new Set(pi.getAllTools().map((tool) => tool.name));
      const active = new Set(pi.getActiveTools());
      for (const name of removed) if (known.has(name)) active.add(name);
      pi.setActiveTools([...active]);
      return;
    }
  };

  const clearRoutedTools = (): void => {
    if (routeAdded.size === 0) return;
    const active = pi.getActiveTools().filter((name) => !routeAdded.has(name));
    pi.setActiveTools(active);
    routeAdded.clear();
  };

  const projectNameForCwd = async (cwd: string): Promise<string | undefined> => {
    const normalized = resolve(cwd);
    if (normalized === resolve(homedir()) || dirname(normalized) === normalized) return undefined;
    try {
      const result = await pi.exec("git", ["-C", cwd, "rev-parse", "--show-toplevel"], { timeout: 3000 });
      if (result.code === 0 && result.stdout.trim()) return basename(resolve(result.stdout.trim()));
    } catch {
      // A non-repository cwd uses its directory name as the project-memory key.
    }
    return basename(normalized);
  };

  pi.registerTool({
    name: "capability_route",
    label: "Capability Route",
    description: "Find a hidden skill or restore a governor-hidden local tool for a concrete task.",
    promptSnippet: "Find a hidden skill or governor-hidden local tool when needed",
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 500 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
    }),
    async execute(_id, params) {
      const limit = params.limit ?? 3;
      const blocked = new Set(config.localTools.blocked);
      const tools = currentLocal && localProfileActive
        ? pi.getAllTools().filter((tool) => locallyRemoved.has(tool.name) && !blocked.has(tool.name))
          .map((tool) => ({ type: "tool" as const, name: tool.name, description: boundedDescription(tool.description), score: scoreSkillForPrompt(params.query, tool.name, tool.description) }))
          .filter((match) => match.score > 0)
        : [];
      const matches = [...skillMatches(params.query, catalog, limit), ...tools].sort(compareMatches).slice(0, limit);
      const added = matches.filter((match) => match.type === "tool").map((match) => match.name);
      if (added.length > 0) {
        pi.setActiveTools([...new Set([...pi.getActiveTools(), ...added])]);
        for (const name of added) routeAdded.add(name);
      }
      const text = matches.length > 0
        ? matches.map((match) => match.type === "skill"
          ? `skill: ${match.name} — ${match.description}\n  path: ${match.path}`
          : `tool: ${match.name} — ${match.description}`).join("\n")
        : "No matching hidden skill or governor-hidden local tool.";
      return { content: [{ type: "text", text }], details: { matches, added } };
    },
  });

  pi.registerCommand("skill-governor", {
    description: "Show routed-skill status, search metadata, or audit a skill file (read-only)",
    handler: async (args, ctx) => {
      const [action, ...rest] = args.trim().split(/\s+/).filter(Boolean);
      if (action === "search") {
        const matches = skillMatches(rest.join(" "), catalog, 5);
        ctx.ui.notify(matches.length > 0 ? matches.map((match) => `${match.name}: ${match.description}\n  ${match.path}`).join("\n") : "No matching skill.", "info");
      } else if (action === "audit" && rest[0]) {
        try { ctx.ui.notify(JSON.stringify(auditSkillText(await readFile(rest[0], "utf8")), null, 2), "info"); }
        catch { ctx.ui.notify("Skill file could not be read.", "warning"); }
      } else {
        ctx.ui.notify(`skills: ${catalog.length}; local tool profile: ${localProfileActive ? "active" : "off"}${locallyRemoved.size > 0 ? ` (${locallyRemoved.size} hidden tools)` : ""}`, "info");
      }
    },
  });

  pi.on("session_start", async (event, ctx) => {
    try { config = mergeConfig(JSON.parse(await readFile(configPath, "utf8"))); }
    catch { config = DEFAULT_GOVERNOR_CONFIG; }
    currentLocal = isLocal(ctx.model);
    if (event.reason === "reload") recoverDeltaAfterReload(ctx);
    applyLocalTools(ctx, currentLocal);
  });

  pi.on("model_select", async (event, ctx) => {
    currentLocal = isLocal(event.model);
    applyLocalTools(ctx, currentLocal);
  });

  pi.on("input", async (event) => {
    if (event.source !== "extension") clearRoutedTools();
    return { action: "continue" };
  });

  pi.on("resources_discover", async (event) => {
    const roots = [join(agentDir, "skills")];
    const hermes = join(agentDir, "pi-hermes-memory", "skills");
    try { await access(hermes); roots.push(hermes); } catch { /* optional */ }
    const projectName = await projectNameForCwd(event.cwd);
    if (projectName) roots.push(join(agentDir, "projects-memory", projectName, "skills"));
    return { skillPaths: roots };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!config.enabled) return undefined;
    catalog = event.systemPromptOptions?.skills ?? catalog;
    const base = event.systemPrompt.replace(SKILL_BLOCK, "");
    // Headless local sessions (subagents, `--mode json`) keep Pi's full prompt
    // and their configured tools; only the routed-skill count is reduced.
    if (!currentLocal || !profileApplies(ctx)) {
      const limit = currentLocal ? config.routing.maxSkillsLocal : config.routing.maxSkills;
      const selected = rankSkills(event.prompt ?? "", catalog, config.routing.minScore, limit).map((row) => visibleSkill(row.skill));
      return { systemPrompt: selected.length > 0 ? base + formatSkillsForPrompt(selected) : base };
    }
    // Interactive local profile: the governor-owned prompt stays within the
    // byte budget. Package extensions that run later (memory policy, prompt
    // modes) append their own fragments and own that cost.
    const explicitPrompt = (typeof event.systemPromptOptions?.customPrompt === "string" && event.systemPromptOptions.customPrompt.length > 0)
      || (typeof event.systemPromptOptions?.appendSystemPrompt === "string" && event.systemPromptOptions.appendSystemPrompt.length > 0);
    const byteLimit = config.routing.maxLocalSystemPromptBytes;
    let systemPrompt = explicitPrompt ? base : compactLocalPrompt(event.systemPromptOptions?.cwd ?? process.cwd(), byteLimit);
    if (Buffer.byteLength(systemPrompt, "utf8") > byteLimit) return { systemPrompt };
    for (const selected of rankSkills(event.prompt ?? "", catalog, config.routing.minScore, config.routing.maxSkillsLocal)) {
      const candidate = systemPrompt + formatCompactLocalSkill(selected.skill);
      if (Buffer.byteLength(candidate, "utf8") > byteLimit) break;
      systemPrompt = candidate;
    }
    return { systemPrompt };
  });
}
