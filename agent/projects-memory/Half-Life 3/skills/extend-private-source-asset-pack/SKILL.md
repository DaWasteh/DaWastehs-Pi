---
name: "extend-private-source-asset-pack"
description: "Extend private local_source SourceIO weapon/vehicle packs without re-exporting inherited assets. Manual-only; do not use for public redistributable art or unrelated imports."
version: 2
created: "2026-10-01"
updated: "2026-11-21"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Use for new private local_source models/audio imported through game/tools/import_local_source_assets.py, not public redistributable art.

## Procedure
1. Verify exact MDL/WAV archive paths with game/tools/vpk_list.py; preserve hashes of existing GLB/WAV files.
2. Extend MODELS/SOUNDS, use explicit multi-key --only and --only-sounds or --skip-sounds. Use Episode Two --game only for its models; maintain per-entry game_root provenance.
3. Decode MDL v44/v49 bones and attachments even for static world models; skip animations for world_/item_/lab_/prop_ entries with empty retained-action sets.
4. Inspect exported GLB animation names, skin joint counts and attachment-parent relationships; store actual exported names, source actions and omitted actions separately.
5. For omitted clips, inspect SourceIO AnimationData: one-frame helpers with zero bone channels create empty Blender actions and are legitimately omitted, not replacement poses to fabricate.
6. Coordinate editor import with peers; launch Godot with child-only isolated APPDATA, inspect logs for diagnostics, and instantiate all new scenes in a private ignored inspection fixture.
7. Record actual Godot clip/bone/attachment names and per-model rest bounds/materials; compare inherited asset hashes before handoff.

## Pitfalls
- Godot sanitizes @clip to _clip. Magnum's duplicated muzzle node names cause its bone to become muzzle_2 while the attachment marker remains muzzle; Jeep muzzle is Muzzle.
- Private proprietary GLBs/WAVs remain ignored/export-excluded; never assert redistribution rights.
- Opaque BSDF conversion does not reconstruct all Source transparency or material effects (e.g. airboat fan blur).
- Rest bounds include all exported bodygroups and are not ready-made vehicle collision hulls.

## Verification
1. Blender batches and Godot editor import exit successfully; Godot logs contain no ERROR/WARNING.
2. Actual instantiated scenes have expected bones, real clips and bone-bound attachments.
3. Existing inherited GLB/WAV SHA256 values remain unchanged; no old key was selected.