---
name: pytank-horde-improvements
description: "Fix and validate broad PyTank horde, AI, FFA/co-op, map, spawn, and tooling behavior. Manual-only: invoke for matching cross-system gameplay/validation work; do not use for a small isolated change."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and current game behavior override this skill. It is manual-only because it spans gameplay systems and multiple validation tools. Select only the matching subsystem/checks; do not turn a local change into a full gameplay/release sweep.

# PyTank — Horde Mode & Game-Logic Rules

## Architecture invariants
- Single file: `pytank.py`; use the project `.venv` with Python 3.12 because pygame is incompatible with Python 3.14 here.
- `GameMode` has `FFA`, `HORDE`, `MISSIONS`. Co-op is `GameManager.coop_enabled`, not `GameMode.COOP`.
- Enemy AI uses `EnemyAI` with PATROL/CHASE/ATTACK/RETREAT; AI owns ATTACK shooting.
- Defense target is `Eagle` with health, hit invulnerability, and wave repair; do not restore one-shot base death.

## Horde and FFA rules
- Horde spawning is telegraphed through `pending_spawns` before creating an `Enemy`; markers are drawn by `_draw_spawn_markers`.
- Wave completion requires `enemies_to_spawn == 0`, no pending spawns, and no live enemies.
- Difficulty affects cadence, telegraph frames, max live+pending cap, and enemy HP; MIXED resolves per enemy.
- FFA uses `Config.FFA_TOTAL_TANKS`; solo = one player + AI solo teams, co-op = two players + paired AI teams.

## Map and input rules
- Arena maps live in `Config.MAP_ORDER`; when adding maps update `Config.MAPS`, `MAP_ORDER`, `MapGenerator.generate()`, `_map_trait_chips()`, `BackgroundRenderer.THEMES`, and number-key handling together.
- In level select, `D` cycles difficulty. Do not bind `K_d` to map-right; it collides with difficulty handling. Use Right arrow for horizontal map navigation.
- Map button hitboxes in `_handle_menu_mouse_click` must match `_draw_level_select` / `_level_select_layout`.

## Pitfalls
- Powerup spawn validation must use inflated hitboxes, not only top-left points.
- `pygame.Rect.collidepoint` excludes right/bottom edges; slider endpoints need inclusive bounds.
- `ruff RET501`: `-> None` methods use bare `return`, not `return None`.
- `.flake8` ignores E402; do not add unused `# noqa: E402` that ruff flags as RUF100.

## Verification
```powershell
.venv\Scripts\python.exe -m py_compile pytank.py
.venv\Scripts\python.exe -m ruff check pytank.py tests
.venv\Scripts\python.exe -m mypy pytank.py tests
.venv\Scripts\python.exe -m flake8 pytank.py tests/ --count --statistics --max-line-length=120
$env:SDL_VIDEODRIVER='dummy'; $env:SDL_AUDIODRIVER='dummy'; .venv\Scripts\python.exe tests/test_maps.py
```

Smoke-test FFA solo/co-op, Horde telegraphs, mission maps, map select arrows/mouse/number keys, and enemy cannon rotation.
