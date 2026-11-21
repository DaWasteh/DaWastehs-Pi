---
name: "pi-model-routing"
description: "Configure Pi cloud roles (Astra/Sol/Terra/Luna) and local AutoTuner routing, or diagnose context/routing failures. Use for model/subagent settings; do not use for ordinary edits or as permission to spawn agents."
version: 7
created: "2026-07-18"
updated: "2026-11-21"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use when changing Pi/subagent model settings, choosing local AutoTuner vs. cloud models, or diagnosing routing/context failures. Explicit user requirements and the active registry override this routing policy.

## Procedure
1. Keep the parent on the user-selected model; the configured startup default is `openai-codex/gpt-6-astra` at high thinking. Route leadership, planning and critical review (`teamleiter`, `planner`, `oracle`/`advisor`, `reviewer`) to Astra high.
2. Use Sol high for evidence-driven bug reproduction/root-cause analysis (`bugtester`), Terra medium for implementation/repairs/substantial research (`worker`, `mechanic`, `delegate`, `researcher`), and Luna low for focused recon/web evidence (`scout`, `web-searcher`). Unclassified native roles default to Terra medium, not Spark.
3. Keep exact model/thinking assignments in `agent/settings.json`; custom role files define behavior, not duplicate model pins. `advisor` aliases `oracle`; use `scout` for repository recon.
4. Prefer fresh context with a compact handoff (goal, cwd/ref, files, authority, acceptance, tests, stop rules). `oracle` retains its fork default for inherited decisions; explicit fork remains available when history matters.
5. Inspect `subagent({ action: "models" })` and the installed Pi catalog's actual context windows before changing routing or launching work. In Pi 1.6.0 `openai-codex`, `gpt-6-astra`/`gpt-6.2-astra` and the `5.6` roles expose 272,000 tokens, while `gpt-6.1-sol`, `gpt-6.1-terra`, and `gpt-6.2-sol` expose 500,000 tokens (`gpt-5.5` and `spark` were removed from Codex). Do not invent context limits or promote models without user approval.
6. For local models, route exclusively through the `autotuner` provider (`127.0.0.1:1233`); `pi-llama-cpp` is retired. Interactive local sessions use `skill-governor`'s compact prompt, reduced core tool surface (`capability_route` restores hidden tools on demand), and `autotuner.ts`'s soft thinking budgets so local models do not truncate inside reasoning. Keep heavy multi-agent fanout on cloud models unless explicitly requested.
7. Escalate ambiguous/high-risk work to the parent/Astra and split oversized tasks even on larger models. Leave automatic fallbacks absent unless exact available candidates and acceptable quality are verified; an offline local alias can fail preflight even with a healthy primary.
8. Use a flat native team: only the root parent launches children. `teamleiter` plans read-only assignments and synthesizes completed reports, with no shell or subagent tools. Await keyed evidence children in the root workflow before launching `teamleiter` synthesis; a started run is not completed evidence.
9. Check resolved agent paths for project/legacy shadows (e.g. `~/.agents/teamleiter.md`). Runtime fanout defaults belong in `agent/extensions/subagent/config.json` (4 concurrent per workflow, 12 launches per run tree, 2 active top-level async runs per session, depth 1), not under `settings.subagents`.

## Pitfalls
- Routing expresses operator policy, not a benchmark proving one model's quality or price. Thinking budgets do not enlarge context; per-model startup thinking and explicit child-role thinking are distinct.
- Do not enable priority `fast` for Astra without verifying the installed `pi-subagents` allowlist. No priority tier is configured here.
- Missing external CLI runners are optional and never a recovery path for failed native children. Stop on infrastructure failures and use only an explicit same-protocol retry or owner-approved mode change.
- A read-only role with `bash` is a behavioral contract, not a sandbox. Keep test side effects bounded and publication authority with the parent.

## Verification
1. Run `npm --prefix agent test`, `npm --prefix agent run typecheck`, and `npm --prefix agent run skill:lint`. Confirm every override names an executable agent and every configured model exists in the active registry.
2. Run `subagent({ action: "list", capabilities: true })` and `subagent({ action: "doctor" })`; confirm the resolved `teamleiter` path and `advisor` alias.
3. For routing behavior changes, run one bounded root-owned async workflow with stable `key` fields and inspect actual runtime model evidence and tool results rather than self-reported model names.
