---
name: "pi-model-routing"
description: "Route Pi parent/subagent roles across GPT-5.3 Spark and GPT-5.6 Luna/Terra/Sol, with an optional registered local llama-server fallback. Use for model/subagent configuration; do not use for ordinary code edits or as permission to spawn agents."
version: 5
created: "2026-07-18"
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use before changing Pi/subagent model settings, choosing a child role/model, or diagnosing routing/fallback failures. The active model registry, current task size, user budget, and explicit run configuration override this hierarchy.

## Procedure
1. Keep the parent on the user-selected strong reasoning model; the current default is `openai-codex/gpt-5.6-sol` with the configured global thinking level.
2. Route bounded mechanical work below 128k to `openai-codex/gpt-5.3-codex-spark` (`scout`, `context-builder`, `delegate`, `bugtester`, `mechanic`). Escalate ambiguous architecture or broad synthesis.
3. Route lightweight evidence synthesis to Luna, substantial implementation/research to Terra, and leadership/critical review to Sol.
4. Keep `subagents.defaultModel` on Spark only when unclassified work is intentionally bounded. Explicit per-run models override role settings.
5. Configure a local fallback only when its exact `provider/model` is present in Pi's active registry. For port 1234 this normally requires a running server exposing alias `local`; an offline provider must not remain in `fallbackModels`, because pi-subagents validates every candidate before launch.
6. Store global overrides in `agent/settings.json`; use central role mappings rather than repeating per-run overrides unless testing or bypassing stale state.
7. After settings changes, reload/restart Pi before judging child behavior.

## Pitfalls
- Spark has a 128k context limit; do not assign broad repository synthesis or long inherited context to it.
- A configured fallback is preflight-validated even if the primary model is healthy. An absent `llama-server=http://127.0.0.1:1234/local` entry can block the whole launch.
- Fallback retries rerun the task; they do not repair tool/test failures.
- Cloud child calls consume plan/API capacity; fanout must match the decision value.
- Do not let model routing silently grant write, release, or merge authority.

## Verification
1. `settings.json` parses and all configured primary/fallback IDs appear in `subagent({ action: "models" })` or the active registry.
2. Run `/subagents-doctor` and one bounded fresh-context Spark read-only smoke.
3. If local fallback is enabled, verify `/v1/models` contains the exact alias before launching; otherwise omit the fallback and document that it is unavailable.
4. Use a stronger reviewer only when the work warrants it; do not require a multi-agent matrix for routine routing changes.
