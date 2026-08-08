---
name: "pi-model-routing"
description: "Current Pi model hierarchy: GPT-5.3 Codex Spark for mechanical work under 128k, then GPT-5.6 Luna, Terra, and Sol by complexity, with local llama-server fallback."
version: 4
created: "2026-07-18"
updated: "2026-08-02"
---
## When to Use
Always consult before spawning subagents, choosing a model or thinking level, editing Pi/subagent settings, or reasoning about API cost and local fallback behavior on Basti's workstation.

## Procedure
1. Keep the parent orchestrator on `openai-codex/gpt-5.6-sol` with `high` thinking via the global Pi `defaultModel` and `defaultThinkingLevel`.
2. Route mechanical, obvious work that fits inside 128k tokens (`scout`, `context-builder`, `delegate`, `bugtester`, and `mechanic`) to `openai-codex/gpt-5.3-codex-spark` with `low` thinking. Use `mechanic` for small, tightly scoped bug fixes and repository chores; escalate as soon as architecture, broad cross-domain judgment, or more than 128k context may be needed.
3. Route lightweight but non-mechanical evidence synthesis (`web-searcher`) to `openai-codex/gpt-5.6-luna` with `low` thinking.
4. Route substantial implementation and research (`worker` and `researcher`) to `openai-codex/gpt-5.6-terra` with `low` thinking.
5. Route leadership and critical judgment (`teamleiter`, `advisor`, `oracle`, `planner`, and `reviewer`) to `openai-codex/gpt-5.6-sol` with `high` thinking.
6. Keep `subagents.defaultModel` on Spark and `subagents.defaultThinking` on `low`, so new or unclassified roles inherit the cheapest bounded tier instead of the parent model.
7. Give every subagent override and custom agent the sole fallback `llama-server=http://127.0.0.1:1234/local`. Do not insert another cloud fallback unless Basti explicitly changes this policy.
8. Store global overrides in `C:\Users\Sebas\.pi\agent\settings.json`. Custom global agents live in `C:\Users\Sebas\.pi\agent\agents\`; keep the legacy `C:\Users\Sebas\.agents\teamleiter.md` copy aligned while it remains discoverable.
9. In Teamleiter fanout, do not pass per-run `model` or `thinking` overrides; let each selected child resolve through the central role mapping.
10. After edits, validate JSON, run `/subagents-models` (or `subagent({ action: "models" })`), inspect representative agents with `get`, run `/subagents-doctor`, and launch a small real Spark smoke run. Reload Pi if an older session still shows stale mappings.

## Pitfalls
- Use the exact qualified model IDs `openai-codex/gpt-5.3-codex-spark`, `openai-codex/gpt-5.6-luna`, `openai-codex/gpt-5.6-terra`, and `openai-codex/gpt-5.6-sol`.
- Spark has a 128k context window. Do not assign it broad repository synthesis, architecture, ambiguous product work, or tasks likely to exceed that bound.
- The local model rotates. The fallback must target the stable `/local` alias, and llama-server must be started with `--alias local`; otherwise the configured fallback cannot resolve.
- The local server normally listens on port 1234 but may be offline. An offline last-resort fallback is acceptable and should not block configuration validation.
- Do not let unclassified subagents inherit the expensive parent model; retain `subagents.defaultModel: openai-codex/gpt-5.3-codex-spark` and `subagents.defaultThinking: low`.
- Per-run model overrides beat `agentOverrides`, which beat agent frontmatter, then `subagents.defaultModel`, then the parent session model.
- Cloud subagent calls consume ChatGPT plan capacity. Compress noisy build/test output before passing it into cloud-model context and keep fanout proportional to the task.

## Verification
1. `settings.json` parses as JSON and contains all expected role overrides with the correct `thinking` value.
2. `subagent({ action: "models" })` shows Spark as the default, Scout/Delegate on Spark, Worker/Researcher on Terra, and Reviewer/Oracle on Sol.
3. `subagent({ action: "get", agent: ... })` shows Mechanic/Bugtester Spark Low, Web-Searcher Luna Low, Worker/Researcher Terra Low, Teamleiter/Reviewer Sol High, and the local `/local` fallback.
4. A real fresh-context Mechanic or Scout smoke run resolves to `openai-codex/gpt-5.3-codex-spark` and completes a bounded read-only check without a per-run model override.
5. No active subagent override, custom-agent frontmatter, or Teamleiter instruction references the expired Z.AI route.
6. `subagent({ action: "doctor" })` reports the custom agents as discovered and no discovery/configuration failure.
7. When llama-server is online, `http://127.0.0.1:1234/v1/models` includes the alias `local`.
