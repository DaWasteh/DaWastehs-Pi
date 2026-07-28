---
name: "pi-model-routing"
description: "Current Pi model routing policy: GPT-5.6 Sol for leadership and critical judgment, Terra for implementation and research, Luna for lightweight context work, with local llama-server fallback."
version: 3
created: "2026-07-18"
updated: "2026-07-28"
---
## When to Use
Always consult before spawning subagents, choosing a model or thinking level, editing Pi/subagent settings, or reasoning about API cost and local fallback behavior on Basti's workstation.

## Procedure
1. Keep the parent orchestrator on `openai-codex/gpt-5.6-sol` with `high` thinking via the global Pi `defaultModel` and `defaultThinkingLevel`.
2. Route leadership and critical-judgment roles (`teamleiter`, `advisor`, `oracle`, `planner`, and `reviewer`) to `openai-codex/gpt-5.6-sol` with `high` thinking.
3. Route implementation, research, and test roles (`worker`, `researcher`, and `bugtester`) to `openai-codex/gpt-5.6-terra` with `low` thinking.
4. Route lightweight reconnaissance and context roles (`scout`, `context-builder`, `delegate`, and `web-searcher`) to `openai-codex/gpt-5.6-luna` with `low` thinking. Keep `subagents.defaultModel` on Luna so newly added or unclassified roles inherit the least expensive GPT-5.6 tier rather than the parent model.
5. Give every subagent override and custom agent the sole fallback `llama-server=http://127.0.0.1:1234/local`. Do not insert another cloud fallback unless Basti explicitly changes this policy.
6. Store global overrides in `C:\Users\Sebas\.pi\agent\settings.json`. Custom global agents live in `C:\Users\Sebas\.pi\agent\agents\`; the current legacy teamleiter agent lives at `C:\Users\Sebas\.agents\teamleiter.md`.
7. In Teamleiter fanout, do not pass per-run `model` or `thinking` overrides; let each selected child resolve through the central role mapping.
8. After edits, validate JSON, run `/subagents-models` (or `subagent({ action: "models" })`), inspect representative agents with `get`, and run `/subagents-doctor`. Reload Pi if an older session still shows stale mappings.

## Pitfalls
- Use the exact qualified model IDs `openai-codex/gpt-5.6-sol`, `openai-codex/gpt-5.6-terra`, and `openai-codex/gpt-5.6-luna`.
- The local model rotates. The fallback must target the stable `/local` alias, and llama-server must be started with `--alias local`; otherwise the configured fallback cannot resolve.
- The local server normally listens on port 1234 but may be offline. An offline last-resort fallback is acceptable and should not block configuration validation.
- Do not let unclassified subagents inherit the expensive parent model; retain `subagents.defaultModel: openai-codex/gpt-5.6-luna`.
- Per-run model overrides beat `agentOverrides`, which beat agent frontmatter, then `subagents.defaultModel`, then the parent session model.
- Cloud subagent calls consume ChatGPT plan capacity. Compress noisy build/test output before passing it into cloud-model context and keep fanout proportional to the task.

## Verification
1. `settings.json` parses as JSON and contains all expected role overrides with the correct `thinking` value.
2. `subagent({ action: "models" })` shows leadership/judgment roles on Sol, implementation/research/test roles on Terra, and lightweight context roles on Luna.
3. `subagent({ action: "get", agent: ... })` shows Teamleiter Sol High, Worker/Researcher/Bugtester Terra Low, Scout/Context-Builder/Delegate/Web-Searcher Luna Low, and the local `/local` fallback.
4. No active subagent override, custom-agent frontmatter, or Teamleiter instruction references the expired Z.AI route.
5. `subagent({ action: "doctor" })` reports the custom agents as discovered and no discovery/configuration failure.
6. When llama-server is online, `http://127.0.0.1:1234/v1/models` includes the alias `local`.
