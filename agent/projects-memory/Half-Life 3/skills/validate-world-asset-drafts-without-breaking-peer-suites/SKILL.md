---
name: "validate-world-asset-drafts-without-breaking-peer-suites"
description: "Prototype global-class Godot world changes in a separately cached draft project while peer suites run. Do not use for isolated non-global edits or single-writer tasks."
version: 2
created: "2026-10-01"
updated: "2026-11-21"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for substantial vessel/setpiece changes during concurrent Claude/Astra validation, especially when new helpers or marker/collision deltas are not yet tested.

## Procedure
1. Save canonical source SHA256 before any changes and record file ownership. Keep updates and completion paths in game/reports/raw/handoff/sol.md as well as Intercom.
2. Create a private project under reports/raw with a copy of project.godot and complete copies of scripts and tests. Junction unchanged scenes/assets/shaders/config to canonical read-only inputs.
3. Create a private .godot directory. Copy global_script_class_cache.cfg and uid_cache.bin; junction only imported resources to canonical imported assets. Keep script/UID/shader caches separate.
4. Edit the private owned script/test files, not the canonical global class. Run --check-only or a bounded smoke after complete helper additions; scan all diagnostics and cap run time.
5. Run native and --no-local-assets gates with child-only APPDATA. Native visuals need native posed geometry and exact collision tests; a passing procedural fallback does not imply native acceptance.
6. Coordinate GPU1 actual art and compare against retained baseline camera metadata. Do not claim a native variant ready when markers or native collision contacts fail.
7. Before switching source, confirm the owner’s current source window and refresh unchanged peer code if the draft copy predates their changes. Install only complete validated owned files; communicate exact marker deltas and evidence.
8. If canonical code was accidentally exposed mid-edit, save it privately, reverse only owned edits, verify original SHA256 byte equality, rerun the baseline smoke and immediately write restoration evidence in the handoff file.

## Pitfalls
- An earlier free-source-window message may cross a later suite-start notification; a private draft prevents breaking global class dependencies regardless.
- Single global-class edits can break main.tscn when helper definitions are saved in a later call.
- Centroid-only native triangle deletion does not reliably empty a bridge volume; long intersecting faces may leave collider remnants.
- Optional native vessels can have missing deck surfaces even if their silhouette and texture look complete.
- Do not use git commands or overwrite peer-owned files to construct or restore a draft.

## Verification
1. Canonical source SHA remains unchanged throughout private work.
2. Private fallback and native logs both exit0 with no diagnostics before handoff.
3. Actual capsule reaches every required waypoint and native spawn markers have real floor support.
4. Handoff file includes final source paths, source hashes, marker deltas, test commands/results and actual image paths.