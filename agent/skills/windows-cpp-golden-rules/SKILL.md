---
name: "windows-cpp-golden-rules"
description: "Implement and validate native Windows C/C++ with MSVC/CMake, WinAPI resource safety, analyzers, and 285K tuning. Manual-only: invoke for explicit native/toolchain review; do not apply to a tiny isolated edit or portable module."
version: 3
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Load manually for cross-cutting MSVC/CMake/Ninja, WinAPI/COM/PDH handles, native memory/SIMD/threading, kernel code, or Windows build failures. For a tiny isolated edit, follow the task contract without loading this full checklist. Explicit repository toolchain and acceptance criteria override preferred defaults.

## Procedure
1. Preserve the repository's supported generator/package strategy. Prefer CMake presets/manifests when introducing new configuration, but do not migrate an established build without scope.
2. Use `/W4` and correct warnings in changed code. Add `/WX`, `/analyze`, or ASan when supported and justified by the component/risk; do not make all three mandatory for every edit.
3. On the Core Ultra 9 285K, assume 8 P + 16 E cores, no SMT, and AVX2/VNNI maximum. Gate specialized code with runtime feature detection.
4. Wrap Windows handles/resources with RAII and correct deleters; use wide WinAPI boundaries and deliberate UTF-8 conversion.
5. Use aligned allocation APIs supported by MSVC and `std::filesystem` with long-path-aware application configuration where path length matters.
6. For kernel/system code, enforce IRQL/paged-memory rules and return structured `NTSTATUS`/`HRESULT`/`std::expected` errors.
7. Apply P/E-core affinity only when latency/profile evidence justifies it.

## Pitfalls
- The 285K has no AVX-512; emitting it can cause illegal instructions.
- `std::aligned_alloc` is not the portable MSVC choice.
- ANSI WinAPI and `MAX_PATH` assumptions create avoidable encoding/path bugs.
- Forcing `/WX` across untouched third-party code can block unrelated work.

## Verification
1. Run the directly affected configure/build target or unit test.
2. Add static analysis/ASan for memory-, parser-, boundary-, or release-sensitive changes where supported.
3. For SIMD/CPU-affinity changes, execute fallback and optimized paths on a focused fixture and inspect instructions/profile evidence.
4. Avoid a full build matrix unless public ABI, buildsystem, or release scope changed.
