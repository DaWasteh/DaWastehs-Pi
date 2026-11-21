---
name: "author-walkable-lofted-vessel"
description: "Build and verify budgeted procedural/hybrid static structures (e.g. PolarVessel) with capsule access, hull sections and finish batching. Do not use for unrelated scenes or non-vessel props."
version: 4
created: "2026-10-01"
updated: "2026-11-21"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for large procedural or optional-native static structures such as PolarVessel with prescribed deck markers, exact collision, continuous ramp/stair routes, and shared surface batches.

## Procedure
1. Design accessible heights and continuous routes first. Keep gangways below30degrees and stair ramps below35degrees; reserve real stairwell apertures and ascending headroom.
2. Emit clockwise Godot triangles with independently verified outward normals. Use exact static concave collision from visible triangles; use boxes only for authored structure masses.
3. Batch primitives per finish. Build custom details in a separate SurfaceTool, index/commit it, then append_from; never mix unindexed add_vertex details into indexed batches.
4. For native hybrid crops, reject only faces wholly outside the retained half-space, then precisely clip crossing faces and preserve normals/UVs. Measure the hull section and distinguish rising sheer from the constant replacement-floor datum.
5. Sample native hull widths at a plane below the lowest sheer, or use full cross-section reconstruction. Add broad floor-support rays across the native/procedural transition; a narrow access promenade can mask a missing main floor in route tests.
6. Fit imported props uniformly using transformed bounds/lowest points. Preserve native materials and create exact collision; inspect visible front direction from textured-face normals instead of assuming every prop has the same facing axis.
7. Write deterministic marker/array, render/collision parity, outward-ray, indexed-detail, slope/light/triangle/surface and real r0.38/h1.78 CharacterBody continuous-route smoke checks. Verify every spawn's support and capsule clearance.
8. Develop complete global-class candidates in a separately cached project. Inspect all logs for diagnostics even when success markers or exit0 appear. Install only complete validated owned files in a coordinated window.
9. Coordinate R9700 ownership, inspect every final native/fallback PNG, and hash the captured source. For optical handoffs capture the actual game before/after with identical camera specifications and source/config boundaries, then release the GPU.

## Pitfalls
- Landing slabs or bridge-wing floors overlapping an ascending flight cap headroom; make a real stairwell opening and verify normal-input capsule traversal.
- Support posts must stop below ramp undersides, not protrude as collision lips.
- A hull slice exactly at deck height may miss a rising native sheer, collapse replacement widths to a tiny fallback, and leave a large visible/physical hole. An existing narrow promenade can still make the main route smoke pass.
- Bow-spoon offsets applied to the authored aft's join ring create a wedge behind the precise native cut; constrain shaping to the intended bow interval.
- Conditional literals assigned to Array[Vector3] can fail at runtime; use PackedVector3Array or typed initialization.
- Painted-metal textures can darken a desired coating; default additive emission can wash textured displays white. For textured emissive diagnostics explicitly use EMISSION_OP_MULTIPLY and validate GPU output rather than masking problems with brighter lights.
- Heeling moves the distant gangway foot vertically. Recheck the actual integrated ice interface; a straight standalone fixture proves only its own contract.
- Standalone art views, headless success, and screenshot timing do not establish final optical, campaign, performance or export acceptance.
- Broad bright hull shader easing may read as a translucent/render-error band. For a physical plate transition share the same opaque plate PBR response, use a bounded slightly raised dark strip with exact collision, and offset shared profile vertices consistently rather than each panel independently (corner cracks). Preserve native name-art UV islands/overlay mounts.
- Godot automatically renames duplicate child names; an exact HullName search can skip the second side. Name/locale regressions must check the real label array and its expected nonzero count, then every supported locale after translation notifications. Move portholes away from actual shaped text bounds, not only its origin.
## Verification
1. Diagnostic-free editor/native/fallback POLAR_VESSEL_SMOKE_OK; all route waypoints reached through continuous gravity/move_and_slide motion, not teleportation.
2. Index-based detail regressions survive batching; current vessel contract stays below90meshes/surfaces and220ktriangles, with required light/slope/static-layer budgets.
3. Every spawn is supported and capsule-clear; broad native foredeck support probes and optional prop visible/collision parity pass.
4. All requested actual-game native/fallback A/B PNGs opened with matching eyes/targets/FOV/settle/HUD, requested resolution and recorded R9700 identity; source/config deltas and unresolved findings are explicit.