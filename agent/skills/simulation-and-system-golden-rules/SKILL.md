---
name: simulation-and-system-golden-rules
description: "Performance rules for grid simulations and Windows system monitoring. Use for cellular automata, falling-sand style grids, high-frequency telemetry, PDH/WMI choices, and CPU/GPU performance triage."
---

# Grid Simulation & Windows System Monitoring

## Grid simulation (CPU)
- Flat 1D arrays + SoA for hot cell state; AoS/nested arrays cause cache misses on large grids.
- Double-buffer when deterministic neighbor reads matter; otherwise document the intentional in-place bias.
- Tile working sets to L1 (e.g. ≤32 KB including both buffers); too large thrashes L1, too small wastes loop overhead. CPU/cache facts → `windows-cpp-golden-rules`.
- SIMD target is AVX2/VNNI only — AVX-512 intrinsics crash the 285K (illegal instruction).

## GPU offload
Offload only when the grid amortizes transfer/sync cost; always keep a CPU reference path for correctness. Device roles/inference → `amd-dual-gpu-inference`.

## System monitoring
- GPU engine utilization on Windows: PDH, not WMI → `windows-gpu-utilization-pdh` for the canonical sequence.
- WMI only for one-shot inventory/VRAM or slow async queries; never poll synchronously in a UI thread.
- Adaptive polling intervals + waitable timers: idle monitoring thread stays ~0 % CPU. Watch for leaked COM/PDH handles on long runs.

## Verification
Profiler confirms cache/tile behavior; disassembly shows AVX2 only (no 512-bit instructions); long telemetry runs show stable handle/memory counts; CPU and GPU paths match on deterministic test grids.
