---
name: "extend-vesper-campaign-systems"
description: "Extend and validate the data-driven Vesper campaign, mission facts, localization, and versioned saves in this Godot repo. Do not use for unrelated work."
version: 1
created: "2026-09-04"
updated: "2026-09-04"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding campaign sections/objectives, changing mission fact semantics, evolving checkpoint saves, or expanding EN/DE campaign text in Borealis-Signal-Godot / the future Half-Life 3 Godot repo.

## Procedure
1. Keep `config/missions/quality_gate.json` as the compatibility default until the integration owner explicitly wires the full campaign; configure `res://config/missions/vesper_campaign.json` on `MissionDirector` before adding it to the scene tree.
2. Represent progression as ordered JSON objectives and submit only typed facts: checkpoints, friendlies, triggers, interactions, enemies, and timed survival. Preserve early facts while advancing only the contiguous objective prefix.
3. When evolving saves, validate the envelope and nested JSON before use, keep replacement rollback-safe with temp and backup files, read the legacy v1 path, and preserve the source save until an explicit clear.
4. Keep EN and DE catalog key sets identical, and ensure every campaign field ending in `_key` resolves in both locales.
5. Add or update an isolated headless campaign smoke without relying on the shared smoke aggregator, then run it alongside the existing smoke suite.
6. Before committing, run the editor headlessly, `git diff --check`, JSON/catalog parity checks, verify changed paths stay inside the assigned lane, and stage only explicit files.

## Pitfalls
- Do not iterate `String.to_utf32_buffer()` as Unicode code points in GDScript; it exposes bytes including zero bytes for ASCII. Validate characters with `unicode_at(index)` instead.
- `MissionDirector.configure_campaign()` must run before the node enters the tree; the default config intentionally remains the two-objective quality gate.
- The Aurora Vault fallback trigger coordinates extend beyond the current navigation corridor, so world/navigation integration must expand the route or replace fallback positions with authored section anchors.
- Enemy, friendly, interaction, and trigger IDs are strict contracts with other lanes; mismatches leave ordered objectives open without a parser error.
- Do not add the lane smoke to `scripts/testing/smoke_suite.gd` when that shared aggregator belongs to the QA/integration owner.

## Verification
1. Run `Godot_v4.7.2-stable_win64_console.exe --headless --path <repo> --script res://tests/smoke_campaign_migration.gd` and require `VESPER_CAMPAIGN_MIGRATION_OK`.
2. Run `Godot_v4.7.2-stable_win64_console.exe --headless --path <repo> --script res://scripts/testing/smoke_suite.gd` and require `VESPER_SMOKE_SUITE_OK tests=4` until QA integrates the new smoke.
3. Run Godot with `--headless --editor --quit` and require exit 0 with no parser or engine errors.
4. Run `git diff --check`, parse all mission/localization JSON, assert EN/DE key parity, and confirm `git status --short` contains only authorized paths.