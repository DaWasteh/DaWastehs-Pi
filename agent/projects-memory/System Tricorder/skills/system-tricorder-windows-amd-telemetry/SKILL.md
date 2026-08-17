---
name: "system-tricorder-windows-amd-telemetry"
created: "2026-08-08"
description: "Diagnose and extend System Tricorder Windows AMD GPU/CPU power telemetry without WMI stalls. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: high
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when System Tricorder disagrees with AMD Software/Adrenalin, RDNA compute appears only as spikes, GPU/CPU watt metrics are changed, or the Windows telemetry loop stutters under AI load.

## Procedure
1. Reproduce the workload and compare three sources separately: PDH GPU Engine rows for queue-level detail, AMD ADLX GPUUsage for authoritative Radeon overall load, and AMD Software for the user-visible reference.
2. Keep PDH for 3D/Compute/Copy/Codec and GPU Adapter Memory, but initialize and sample it only in HardwareMonitorThread; never poll WMI in the live loop.
3. Call the driver-installed amdadlx64.dll through the official ADLX C ABI. Use cdecl for ADLXInitialize/ADLXTerminate exports, stdcall for interface vtables, ADLX 1.4.0.110 as the compatible client version, and a 250 ms sampling interval.
4. Query ADLX support per GPU before reading GPUUsage, GPUTotalBoardPower (preferred), GPUPower (fallback), and GPUVRAM. Map unique AMD PCI device IDs one-to-one; suppress the ADLX merge when identical IDs are ambiguous.
5. Release every ADLX metrics/support/GPU/performance interface, stop tracking, and only then call ADLXTerminate. Construct, sample, and close the session in the same worker thread.
6. Read CPU package power with PdhAddEnglishCounterW on \\Energy Meter(*)\\Power. Sum only rapl_package*_pkg values and divide milliwatts by 1000; never add PP0, PP1, or DRAM to PKG.
7. Throttle ADLX/NVML/power to about 4 Hz and PDH VRAM to about 2 Hz while publishing cached values at 30 FPS. Expire stale usage/power/VRAM caches and reinitialize failed ADLX sessions with backoff.
8. Keep packaging, push, tag, and release work in the manual `system-tricorder-cross-platform-ci` skill; telemetry changes do not grant release authority.

## Pitfalls
- ADLXPybind 1.4.6 returned valid data on this host but caused native process exit code 2816 even after cleanup; do not embed it in the main process. The direct official C ABI wrapper is the proven path.
- The ADLX C support vtable methods return ADLX_RESULT and write adlx_bool through an output pointer. Python binding stubs expose convenience bools and must not be treated as the native ABI.
- Task Manager and PDH can report a long RDNA4 compute dispatch as a brief 100% Compute pulse every few seconds; do not use that as the Radeon overall-utilization source.
- GPUTotalBoardPower includes board components; GPUPower is a GPU-chip fallback. Keep UI/docs wording generic enough to remain truthful.
- PCI device IDs are vendor-relative and non-unique across identical cards. Check vendor/name and do not guess per-card ADLX identity for duplicate IDs.
- Do not call CoUninitialize while live WMI proxies remain referenced; clear row and service proxies first.
- A self-test must use an isolated config/home so it cannot overwrite the developer's layout or geometry.

## Verification
1. On the RX 9070 XT + AI PRO R9700 host, a direct ADLX probe initializes, reports both cards, returns plausible usage/VRAM/watts, closes cleanly, and exits with code 0.
2. Under the target ComfyUI workload, R9700 gpu_total_percent stays near 100% while PDH Compute may pulse; CPU PKG and each GPU power remain plausible.
3. A five-second monitor cadence probe delivers approximately 30 Hz with no gap above 250 ms; the validated v2.7 run achieved about 30.0 Hz and roughly 41 ms maximum gap.
4. Run focused telemetry tests plus lint/type checks for changed files. Add source self-test for cross-module monitor changes.
5. Build/frozen self-test and the cross-platform release workflow are required only when packaging or releasing is explicitly in scope.
