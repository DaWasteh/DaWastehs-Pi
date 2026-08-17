---
name: "simulation-and-system-golden-rules"
description: "Optimize deterministic grid simulations and high-frequency Windows telemetry using cache-aware layouts and appropriate PDH/WMI paths. Use for measured simulation/monitoring work; do not apply to ordinary app logic or unprofiled micro-optimization."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: low
---
## When to Use
Use for cellular automata/falling-sand grids, deterministic neighbor updates, CPU/GPU simulation paths, high-frequency telemetry, or monitoring stalls. Explicit simulation semantics and profiler evidence override generic optimization advice.

## Procedure
1. Keep hot grids flat and consider SoA only for repeatedly scanned fields. Use double buffering when neighbor reads require deterministic old state; document intentional in-place bias otherwise.
2. Tile working sets for cache only after measuring a relevant bottleneck. The 285K supports AVX2/VNNI, not AVX-512.
3. Offload to GPU only when work amortizes transfer/synchronization and retain a CPU reference path for correctness.
4. Use PDH for Windows GPU engine utilization and WMI only for slow inventory/VRAM. Load `windows-gpu-utilization-pdh` for the exact PDH sequence.
5. Keep polling off the UI thread, use adaptive intervals/waitable timers where appropriate, and close COM/PDH handles deterministically.
6. Preserve existing architecture when it meets latency/CPU targets; do not add threading/SIMD/GPU paths without a measured requirement.

## Pitfalls
- Nested arrays/AoS can hurt hot scans but may be clearer and sufficient for small grids.
- Too-small tiles add overhead; too-large tiles thrash cache.
- Synchronous WMI polling can freeze UI and report stale utilization.
- GPU transfer/sync can cost more than the kernel.

## Verification
1. For simulation changes, compare a focused deterministic fixture against the reference path.
2. Profile only the changed/hot scenario and inspect generated instructions only for SIMD work.
3. For telemetry changes, run a bounded known-load sample and check update cadence plus handle/memory stability.
4. Do not require long profiling runs for unrelated edits.
