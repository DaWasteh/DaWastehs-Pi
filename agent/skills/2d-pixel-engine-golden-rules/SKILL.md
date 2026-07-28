---
name: 2d-pixel-engine-golden-rules
description: "Architecture and rendering rules for deterministic 2D pixel-art games. Use whenever designing a game loop, ECS/data layout, sprite renderer, camera, particles, or performance pass for a 2D browser/native pixel engine."
---

# 2D Pixel-Art Engine Golden Rules

## Fixed timestep
Simulation is fixed-rate (usually 60 Hz); rendering runs as fast as the display allows. Accumulator + clamp big frame gaps (tab switch/pause); interpolate render positions from previous/current sim state. `position += speed * deltaTime` inside physics/collision = different gameplay at 30/60/144 Hz — never do it.

```ts
const STEP = 1 / 60;
let acc = 0;
function frame(dt: number) {
  acc += Math.min(dt, 0.1);
  while (acc >= STEP) { previous = current.clone(); update(STEP); acc -= STEP; }
  render(acc / STEP);
}
```

## Data layout and allocation
- ECS/SoA for hot simulation loops; flat grids (`index = y * width + x`), no array-of-arrays in hot paths.
- Pool bullets, particles, enemies, decals: stable gameplay allocates zero objects per frame (per-frame spawning/destroying causes GC/allocator spikes).

## Pixel-perfect rendering
- Render into a low-res internal buffer (e.g. 320×180), upscale by an integer factor.
- `Math.round`/`floor` final draw coordinates after camera transforms — floating coords shimmer even when the sim is correct.
- Sprite sheets need padding/edge extrusion; texture bleeding = missing padding, wrong UVs, or non-integer scaling.

## Related skills
CPU tuning (285K P/E cores, AVX2-only) → `windows-cpp-golden-rules`. GPU/inference roles → `amd-dual-gpu-inference`; gameplay rendering targets the display GPU, AI workloads stay separate.

## Verification
Logic identical at 30/60/144 FPS; slow checkerboard pan shows no shimmer; profiler shows zero per-frame allocations during steady gameplay.
