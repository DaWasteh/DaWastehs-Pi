---
name: "verify-highland-patrol-navigation"
description: "Validate Vesper highland patrol coverage, async navigation map readiness and spawn reachability. Do not use for non-navigation edits or pass-only gameplay changes."
version: 2
created: "2026-10-01"
updated: "2026-11-21"
skill-governor-tier: auto
skill-governor-risk: low
---
## When to Use
Use when changing FrontierChapter navigation patches or generated highland actor patrols.

## Procedure
1. Run game/tests/smoke_highland_patrols.gd with isolated APPDATA, first native and then -- --no-local-assets. Verify every authored leg including loop closure and actual CharacterBody movement.
2. Keep highland regions and their NavigationAgent3D descendants on the same dedicated NavigationServer3D map. Free its RID on chapter exit; do not let its larger asynchronous build delay initial pass routes.
3. Align patches to a common world grid and deduplicate polygon cells across regions. Cover patrol endpoints, not just group spawn centers; current road legs extend approximately 60 metres from their centers.
4. Wait boundedly for a populated map using map_get_closest_point_owner, not merely a positive iteration ID or a fixed short frame count.
5. If only one actor cannot reach an otherwise connected route, inspect its authored spawn. A lateral offset on a narrow road can place it on a disconnected hillside island. Fix the generator to stagger actors along the route tangent rather than teleporting or ignoring collision.
6. Re-run smoke_gameplay to protect pass navigation and inspect complete logs for diagnostics, not only success markers.

## Pitfalls
- A positive map iteration may describe an initial empty map while a larger asynchronous update is still pending.
- A center within 0.8 times the patch radius does not guarantee its full patrol fits inside that patch.
- Do not bypass missing navigation with direct movement through world geometry.
- The campaign generator/catalog are shared ownership: coordinate source edits and regeneration with their owner.

## Verification
1. HIGHLAND_PATROLS_OK reports all authored patrols reachable and actual movement, in native and fallback modes.
2. Pass gameplay smoke still returns a connected route and no navigation merge warnings.
3. No source staging or committing outside the agreed single-committer workflow.