---
name: "verify-vesper-faction-combat"
description: "Verify opt-in Vesper NPC faction combat, native melee geometry, attribution and rig lifecycles. Do not use for player-only combat or unrelated controller edits."
version: 4
created: "2026-10-02"
updated: "2026-11-21"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for EnemyController/ArcMachineController faction-combat changes and their smoke acceptance. Not a substitute for open-world population integration, GPU timing or Claude's visual approval.

## Procedure
1. Read the current controller ownership/seam handoff before editing. Preserve reserved population functions unless a specific exception is granted; snapshot sources into ignored reports for a no-Git comparison when another session owns commits.
2. Run tests headless with child-only APPDATA under game/reports, never the player's actual save directory. The isolated tests/smoke_faction_combat.gd builds its own registry, actors, floor and navigation map without main.tscn.
3. Run smoke_faction_combat in native and --no-local-assets modes. Require real reciprocal damage, a death within the declared frame limit, correct EventHub attribution, ray budgets and no engine warnings/errors/leaks.
4. Run -- --no-local-assets --negative-no-registry as an expected-red control. It must fail acquisition, reciprocal damage and death, rather than failing through script errors. Do not patch runtime sources to perform this control.
5. For native melee failures, inspect the actual MachineHull dimensions, aim-point distance, swept-body slide contacts and blocking contact ray. A larger native hull can contact a soldier outside a small centre-distance threshold. Preserve the committed-lunge dodge contract: a genuinely missed target should not take damage.
6. Account for machine detection range before timing acquisition. Preserve full HP and time limits; disclose any supported non-cover fixture profile used to isolate combat from deliberate flanking. NPC-only damage factors must never reach PlayerController.apply_damage's armor-bypass argument.
7. Verify accepted NPC hull hits do not accidentally reuse native player component-continuation logic, and that repeated accepted hits spawn only the bounded ImpactEffect path without duplicates.
8. After tier/seam changes run smoke_rig_modes, smoke_arc_machines and smoke_phase5_actors in both modes. Also run smoke_ai_behaviour, smoke_combat_tactics and smoke_actor_traffic for player-only and collision regressions.
9. Check reserved function diffs using a line-anchored seam marker: the file has both a top '## ---' block and a bottom '# ---' block. Record exact source hashes, markers, diagnostic scan and log paths in reports, then update reports/raw/handoff/astra.md and notify the known current validator.

## Pitfalls
- A successful visibility sample is not a weapon hit; cache budgeted perception but keep a real blocking weapon/contact ray.
- NPC aim-point snapshots already contain their height. Adding legacy player height offsets again makes gunfire and telegraphs miss.
- Native horizontal gun poses can reject low targets under a 3D barrel alignment gate. Any NPC-only pitch exception needs explicit visual disclosure; do not silently rotate the entire rig or change player fire.
- REDUCED accumulated delta does not itself reduce sensor frequency. Engaged REDUCED actors also need their MANUAL rig advanced, and rebuilt rigs need the cached mode reapplied.
- Negative controls intentionally contain failure markers; distinguish those from engine diagnostics. Technical headless success is not visual acceptance or full-suite acceptance.
- For real-world integration, record the actually dispatched contest slot. A signal_kite alarms but does not itself attack; its being shot is not evidence of reciprocal faction combat. Verify armed partners really join rather than assuming a whole territory moves together.
- An objective-protection fixture must stop before highland_clear_tessera and verify its eight victims are alive. Reusing a post-highland_align_array fixture makes that objective already complete and invalidates the test.
- The existing capture_highland_route driver deliberately hops between route sections, fires and heals. Do not inherit it unchanged as evidence of uninterrupted natural contest arrival or player-neutral NPC combat. Record actual camera distance: NPC impacts are culled beyond 120m, even when combat is valid at 150m.
## Verification
1. Native and fallback FACTION_COMBAT_OK with actual duel/contact evidence and clean logs.
2. Registry-null control exits nonzero with unchanged health/no acquisition and no script diagnostics.
3. Player-only, collision, animation-mode and restore regressions pass in both modes.
4. Only authorized source paths/seam exceptions changed; handoff includes limitations and leaves real-scene visual acceptance explicitly with Claude.
5. For objective-protection wiring, run smoke_objective_gate.gd native/fallback with isolated APPDATA: OBJECTIVE_GATE_OK must cover all eight Tessera and six deck IDs, seven wiring passes, six blocked/accepted distance pairs, two real checkpoint loads and four rebuilt dead rigs. The actual deck objective ID is polar_clear_deck. This direct API test freezes NPC movement/streaming and is not a natural encounter test. For an authorized negative control, mutate EncounterDirector._configure_open_world's radius assignment to INF, not the test's objective_ids; require assertion-driven failure and restore runtime source afterwards.