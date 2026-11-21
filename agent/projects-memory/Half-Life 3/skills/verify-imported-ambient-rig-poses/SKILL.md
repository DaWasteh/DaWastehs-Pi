---
name: "verify-imported-ambient-rig-poses"
description: "Validate native optional ambient rigs, animated poses and cargo sockets against ground/scale bounds. Do not use for static props or unrelated world scripts."
version: 2
created: "2026-10-01"
updated: "2026-11-21"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use when adding imported local Source creatures/aircraft, native motion clips, cargo sockets, or atmospheric far-field actors in game/scripts/world/.

## Procedure
1. Extend only selected neutral keys in import_local_source_assets.py and verify MDL/WAV paths with vpk_list. Keep all inherited GLB/WAV hashes and selectively import with --only/--only-sounds.
2. Resolve included animation MDLs and external ANI blocks through SourceIO's common loader; retain idle/flight/walk clips plus the gunship prop_turn clip. Record omitted empty helpers honestly.
3. Run Godot --headless --editor --import with child-only APPDATA and inspect native instantiated AnimationPlayer names; imported @ names become underscores.
4. Inspect actual animated skeleton transforms and socket scales. A native body-centred strider walk needs the authored .Body_Bone rest-height baseline above terrain; geometry AABB min alone buries its legs.
5. For metre-sized independent cargo art, sample animated socket pose scale after native clip advance(0), then cancel that scale on the cargo root. Bind-rest socket scale may differ from animation scale.
6. Suspend distant bird node processing and shadows; retain a hard allocation cap. Set real PCM loop ranges for aircraft sounds and meaningful unit_size as well as max_distance for far-field audio.
7. Test native and absent-pack modes, proximity and actual EventHub signal, ground support, real posed feet/body, timed routes, all-object pause/resume and repeat/before-tree setup.
8. Coordinate exclusive R9700 art views and inspect saved PNGs. Keep incorrect first-pass captures and source/image hashes; staged close views are not integration or performance evidence.

## Pitfalls
- A diagnostic-free behavioral smoke can still hide a visually buried rig if it checks only wrapper positions or bind bounds.
- SourceI/O skeletal socket pose scale can be0.0254 while rest scale is1; attaching already-metre-scaled cargo uncorrected makes it tiny.
- A large audio max_distance does not make a sound audible when unit_size remains7m; far-field loops and giant footsteps need suitable attenuation reference distances.
- Loop mode mutation every physics frame can invalidate shared animation resources. Change clips only on state transitions.
- --quit-after can abort the editor scan with WARNING: Scan thread aborted; use --import to wait for an honest diagnostic-free asset scan.
- Choose far ridge paths within rendered terrain bounds and hide actors approaching500m rather than assuming terrain exists650m outside the map.

## Verification
1. Native AMBIENT_LIFE_OK and empty AMBIENT_LIFE_OK exit0 with no ERROR/WARNING lines.
2. Actual animated walker body is upright and feet near ground; container root world scale remains1.
3. Saved four real native-resolution PNGs show actual skins, all walker legs, and correctly sized hanging cargo on the confirmed R9700.