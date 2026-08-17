---
name: sandgame-html-workflow
description: "Safely modify and validate the SandGame single-file HTML simulation. Use for sand_game.html UI, simulation-loop, rendering, input, material, WebGL2, or CPU/GPU render-path changes. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# SandGame — Single-File HTML Simulation Workflow

## Scope
Read `html-golden-rules`, `2d-pixel-engine-golden-rules`, and `simulation-and-system-golden-rules` before broad UI/engine changes.

## Edit workflow
- Inspect `sand_game.html` around the target functions; preserve physics, chemistry, and biology unless explicitly improving correctness.
- Use targeted edits. For simulation changes, watch edge wrapping, update-order bias, active-cell wake-up behavior, and typed-array bounds.
- New grid arrays must be wired through declaration, `resize()` allocation/copy, and `swap()` transfer.

## Dual render path invariant
`render()` dispatches to WebGL2 `renderGL()` when GPU is enabled, otherwise CPU `renderCPU()` with 2D canvas `putImageData`. CPU is the exact-color source of truth.

Any per-cell color logic change must be applied to BOTH:
- `renderCPU()` JavaScript.
- `GL_FS` GLSL fragment shader.

The shader reads packed RGBA8 textures: `t0` material/temp/ph/csLow, `t1` age/health/stage, `t2` csHigh/salinity/rad. Material colors/dynamic flags come from `u_colors[77]` / `u_dyn[77]` generated from `MATS` / `DYNAMIC_COLOR` in `initGL()`.

## GLSL gotchas
- WebGL2 / GLSL ES 3.00 is required for dynamic uniform-array indexing.
- Use `texelFetch` and `*255` to reconstruct integer channels from RGBA8.
- Flip Y in the vertex shader so grid row 0 renders at the top.
- JS `%` on ints maps to GLSL integer `%`; float modulo uses `mod(x, 2.0)`.

## Pitfalls
- Do not remove materials or simplify systems to make optimization easier.
- Dead-code guards hide reactions: if salt/acid/growth "does nothing", inspect enclosing conditions first.
- Newly grown cells must inherit parent plant water/sap state or immediately lose health.
- Node/vm lexical `let`/`const` do not land on the sandbox object; access them in-context.

## Verification
```bash
node validate.cjs
node smoke.cjs
```

`validate.cjs` extracts the script and syntax-checks it. `smoke.cjs` runs a mocked DOM/canvas/WebGL2 VM, calls `init()` and 30 simulation/render ticks, and exercises both GPU and CPU render paths. It catches runtime errors but not pixel-perfect shader fidelity; still review the visual diff manually when color logic changes.
