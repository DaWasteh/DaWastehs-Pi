---
name: "2d-pixel-engine-golden-rules"
description: "Design deterministic 2D pixel-engine loops, data layouts, cameras, sprites, particles, and hot paths. Use for real-time 2D engine work; do not use for ordinary DOM UI, turn-based logic, or unrelated rendering stacks."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: low
---
## When to Use
Use for fixed-step 2D simulation, pixel-perfect rendering, ECS/SoA layout, sprite cameras, particles, or measured frame-time work. Explicit task requirements and repository behavior override these defaults.

Do not apply the complete engine workflow to a small UI or isolated asset edit.

## Procedure
1. Separate fixed-rate simulation from display-rate rendering. Clamp large frame gaps and interpolate only render state.
2. Keep hot data flat and allocation-free where profiling shows pressure: SoA/ECS for repeated component scans, `index = y * width + x` for grids, and pools for frequently recycled entities.
3. Render to the repository's intended low-resolution buffer and use integer final draw coordinates. Add sprite padding/edge extrusion only when texture bleeding is present.
4. Preserve the existing architecture when it already satisfies determinism and frame-time requirements; do not introduce an ECS, pool, or render layer merely because this skill mentions one.
5. Use `windows-cpp-golden-rules` only for native Windows CPU/toolchain questions and `amd-dual-gpu-inference` only for inference workloads.

## Pitfalls
- Updating collision or physics from variable render delta changes gameplay across refresh rates.
- Per-frame allocation and nested hot arrays can cause stalls, but optimize only after identifying the hot path.
- Floating camera transforms can shimmer even when simulation state is deterministic.
- A full renderer rewrite is not justified by one visual defect.

## Verification
1. For simulation changes, compare one deterministic scenario at two frame rates or with a fixed-step test.
2. For pixel/camera changes, inspect one slow pan or focused screenshot sequence for shimmer/bleeding.
3. Profile allocations or frame time only when performance was changed or is the reported defect; do not require a repository-wide benchmark for unrelated edits.
