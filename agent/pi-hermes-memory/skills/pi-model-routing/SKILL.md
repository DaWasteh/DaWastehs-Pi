---
name: "pi-model-routing"
description: "Current Pi model routing policy: GPT-5.6 Sol for orchestrator/lead and selected worker roles, GLM-5.2 for the remaining roles, local llama-server as universal fallback."
version: 2
created: "2026-07-18"
updated: "2026-07-18"
---
## When to Use
Always consult before spawning subagents, choosing a model or thinking level, editing Pi/subagent settings, or reasoning about API cost and local fallback behavior on Basti's workstation.

## Procedure
1. Keep the parent orchestrator on `openai-codex/gpt-5.6-sol` with `high` thinking via the global Pi `defaultModel` and `defaultThinkingLevel`.
2. Route `teamleiter` to `openai-codex/gpt-5.6-sol` with `high` thinking.
3. Route `worker`, `researcher`, `bugtester`, and `web-searcher` to `openai-codex/gpt-5.6-sol` with `low` thinking.
4. Route all remaining builtin subagent roles (`oracle`, `planner`, `scout`, `reviewer`, `context-builder`, and `delegate`) to `zai/glm-5.2` with `high` thinking. Keep `subagents.defaultModel` on `zai/glm-5.2` so newly added/unclassified roles inherit GLM rather than the parent model.
5. Give every subagent override and custom agent the sole fallback `llama-server=http://127.0.0.1:1234/local`. Do not insert another cloud fallback unless Basti explicitly changes this policy.
6. Store global overrides in `C:\Users\Sebas\.pi\agent\settings.json`. Custom global agents live in `C:\Users\Sebas\.pi\agent\agents\`; the current legacy teamleiter agent lives at `C:\Users\Sebas\.agents\teamleiter.md`.
7. After edits, validate JSON, run `/subagents-models` (or `subagent({ action: "models" })`), inspect representative agents with `get`, and run `/subagents-doctor`. Reload Pi if an older session still shows stale mappings.

## Pitfalls
- Use the exact qualified model ID `openai-codex/gpt-5.6-sol`; do not use the old malformed `openai-codex/gpt5.6-sol` spelling.
- The local model rotates. The fallback must target the stable `/local` alias, and llama-server must be started with `--alias local`; otherwise the configured fallback cannot resolve.
- The local server normally listens on port 1234 but may be offline. An offline last-resort fallback is acceptable and should not block configuration validation.
- Do not let unclassified subagents inherit the expensive parent model; retain `subagents.defaultModel: zai/glm-5.2`.
- Per-run model overrides beat `agentOverrides`, which beat agent frontmatter, then `subagents.defaultModel`, then the parent session model.
- Cloud subagent calls are metered. Compress noisy build/test output before passing it into cloud-model context.

## Verification
1. `settings.json` parses as JSON and contains all expected role overrides with the correct `thinking` value.
2. `subagent({ action: "models" })` shows worker/researcher on GPT-5.6 Sol and the remaining builtins on GLM-5.2.
3. `subagent({ action: "get", agent: ... })` shows Teamleiter High, Worker/Researcher/Bugtester/Web-Searcher Low, and the local `/local` fallback.
4. `subagent({ action: "doctor" })` reports the custom agents as discovered and no discovery/configuration failure.
5. When llama-server is online, `http://127.0.0.1:1234/v1/models` includes the alias `local`.