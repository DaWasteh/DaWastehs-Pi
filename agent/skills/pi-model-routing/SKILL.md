---
name: "pi-model-routing"
description: "Configure Pi roles across GPT-6 Astra, GPT-5.6 Sol/Terra/Luna and diagnose context or routing failures. Use for model/subagent settings; do not use for ordinary edits or as permission to spawn agents."
version: 6
created: "2026-07-18"
updated: "2026-09-07"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use when changing Pi/subagent model settings or diagnosing routing/context failures. Explicit user requirements and the active registry override this routing policy.

## Procedure
1. Keep the parent on the user-selected model; the startup default is `openai-codex/gpt-6-astra` at high thinking. Route leadership, planning and critical review (`teamleiter`, `planner`, `oracle`/`advisor`, `reviewer`) to Astra high.
2. Use Sol high for evidence-driven bug reproduction/root-cause analysis (`bugtester`), Terra medium for implementation/repairs/substantial research (`worker`, `mechanic`, `delegate`, `researcher`), and Luna low for focused recon/web evidence (`scout`, `web-searcher`). Unclassified native roles default to Terra medium, not Spark.
3. Keep exact model/thinking assignments in `agent/settings.json`; custom role files define behavior, not duplicate model pins. `advisor` aliases `oracle`; the old `context-builder` override had no executable agent—use `scout` instead.
4. Prefer fresh context with a compact handoff (goal, cwd/ref, files, authority, acceptance, tests, stop rules). `oracle` retains its fork default for inherited decisions; explicit fork remains available when needed. A fork copies history, not a selectively retrieved context packet.
5. Inspect `subagent({ action: "models" })` and the registry's actual context windows before launch. On this installation Astra and the 5.6 roles expose 272,000 tokens, Spark 128,000. Do not inflate registry limits or claim a million-token window. Spark is manual-only for tiny self-contained work, not an automatic fallback or default.
6. Escalate ambiguous/high-risk work to the parent/Astra and split oversized tasks even on larger models. Model fallback is not semantic escalation. Leave automatic fallbacks absent unless exact available candidates and acceptable quality are verified; an offline local alias can fail preflight even with a healthy primary.
7. Use a flat native team: only the root parent launches children. `teamleiter` plans read-only assignments and synthesizes completed reports, with no shell or subagent tools. Nested async fanout lost its runner during a live test; the owner selected flat orchestration instead. Await keyed evidence children in the root workflow before launching the teamleiter synthesis. A started run is not completed evidence.
8. Check resolved agent paths for project/legacy shadows. `~/.agents/teamleiter.md` can override `~/.pi/agent/agents/teamleiter.md`. Reconcile obsolete copies with a reversible backup outside `.md` discovery, not a second divergent prompt.
9. Reload/restart Pi after edits and verify live mappings. Runtime fanout settings belong in `agent/extensions/subagent/config.json`, not under `settings.subagents`; configured defaults are four concurrent children per workflow, twelve cumulative launches per run tree, two active top-level async runs per session and depth one. Inherited stricter limits win; do not raise ceilings to bypass a rejected launch.

## Pitfalls
- Routing expresses operator policy, not a benchmark proving one model's quality or price. Thinking budgets do not enlarge context; per-model startup thinking and explicit child-role thinking are distinct.
- Do not enable priority `fast` for Astra: pi-subagents 0.66.0's allowlist only includes Luna/Sol. No priority tier is configured here.
- Missing external CLI runners are optional and never a recovery path for failed native children. Stop on infrastructure failures and use only an explicit same-protocol retry or owner-approved mode change.
- A read-only role with `bash` is a behavioral contract, not a sandbox. Keep test side effects bounded and publication authority with the parent.

## Verification
1. Run configuration tests, typecheck and skill lint. Check every override names an executable agent and every exact model is registered.
2. Run `subagent({ action: "list", capabilities: true })` and `subagent({ action: "doctor" })`; confirm the resolved teamleiter path and `advisor` alias.
3. Exercise the changed role contracts through one bounded root-owned async workflow, using unique stable `key` fields and role routing rather than per-run model overrides. Read runtime model evidence, actual tool results and final reports; do not infer success from a model's self-identification.
