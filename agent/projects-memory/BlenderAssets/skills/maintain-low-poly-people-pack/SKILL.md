---
name: "maintain-low-poly-people-pack"
description: "Regenerate and validate the 1,008-character Blender/Godot people asset pack. Do not use for unrelated work."
version: 1
created: "2026-09-04"
updated: "2026-09-04"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when changing or rebuilding people-asset_generation_21jobs_4decades_4variationseach-gpt5.6sol in this BlenderAssets workspace. Do not use for unrelated asset packs.

## Procedure
1. Edit config/catalog.json for data changes or generate_assets.py/asset_builder.py for geometry changes; bump GENERATOR_VERSION when generated GLB content or wrapper conventions change.
2. Run build_and_validate.bat on Windows, or BLENDER_BIN=blender PYTHON_BIN=python3 ./build_and_validate.sh on Unix. The required order is generation, showcase rendering, Python validation, then full Blender reimport.
3. Run validate_in_godot.bat with GODOT_BIN set, or the shell equivalent. This imports the project, loads and instantiates all 1,008 wrappers, verifies looping animations, and starts the demo scene.
4. After Godot validation, remove regenerable .godot/, *.import, and *.uid cache files before delivery.
5. Confirm validation_report.json, blender_validation_report.json, and godot_validation_report.json all report passed/1008 and carry identical manifest_sha256 and glb_inventory_sha256 values.
6. Run ruff check on all Python files, python -m py_compile, bash -n on shell scripts, and perform a final count of 1,008 GLBs, 1,008 TSCNs, and 21 previews.

## Pitfalls
- Godot strips the recognized glTF -loop suffix: source clips Idle-loop/Walk-loop/Work-loop appear as Idle/Walk/Work and must have non-NONE loop mode.
- TSCN dependencies must use the same-directory relative GLB filename; a hard-coded res:// pack folder fails when the pack itself is opened as project root or renamed.
- On Windows, do not pass quoted %~dp0 with its trailing backslash to Godot --path; pushd first and use %CD%.
- Do not trust --skip-existing based only on file presence. Compatibility must include generator version, generation fingerprint, animation profile, and requested BLEND presence.
- Generation or showcase changes must invalidate old validation reports before writing new outputs; stale green reports are not evidence.
- Godot import creates sidecars and a large .godot cache. They are reproducible and should not ship.
- The plain validator supports static or standard animated profiles per manifest entry; the full delivered default pack is animated.

## Verification
1. asset_manifest.json has exactly 1,008 unique combinations, generator version 1.1.0 (or the current bumped version), 1,008 unique valid generation fingerprints, and no unexpected blend sources in the default distribution.
2. validate_assets.py exits zero and reports 950–1,696 triangles for the current baseline.
3. validate_blender_imports.py reimports all 1,008 assets and verifies sampled motion for every declared action.
4. Godot deep validation prints GODOT_ALL_1008_ASSETS_VALIDATION_PASSED and the demo headless run has no errors or warnings.
5. The final distribution contains no .godot directory, *.import, *.uid, __pycache__, or unintended *.blend files.