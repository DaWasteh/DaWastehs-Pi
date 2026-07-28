---
name: windows-cpp-golden-rules
description: "Windows 11 C/C++ and systems-programming rules for MSVC, CMake/Ninja, WinAPI, kernel-mode, and Intel Core Ultra 9 285K tuning. Use whenever writing or reviewing native Windows code."
---

# Windows C/C++ Golden Rules (285K / Arrow Lake-S)

## Toolchain
- MSVC + CMake + Ninja; `vcpkg.json` manifest mode; standardize with `CMakePresets.json`.
- `/W4 /WX`, `/analyze`, ASan (`/fsanitize=address`) are normal development tools, not polish.

## CPU tuning (Core Ultra 9 285K)
- 24 logical cores = 8 P + 16 E, no Hyper-Threading — don't assume SMT pairs.
- Max SIMD is AVX2/AVX-VNNI. **No AVX-512.** Runtime-dispatch via `__cpuid`/`IsProcessorFeaturePresent`.
- Latency-critical render/audio/game threads → P-cores; background/asset/logging work → E-cores (`SetThreadSelectedCpuSets`).
- Caches: P L1d 48 KB, P L2 2 MB private; E L1d 64 KB, E L2 4 MB per 4-core cluster; 36 MB shared L3.

## Memory, resources, WinAPI
- RAII everywhere; wrap `HANDLE`/`HMODULE`/`HKEY`/COM/PDH with custom deleters:

```cpp
using unique_handle = std::unique_ptr<std::remove_pointer_t<HANDLE>, decltype(&CloseHandle)>;
```

- MSVC has no `std::aligned_alloc` → `_aligned_malloc/_aligned_free`, aligned `operator new`, or PMR.
- `W` APIs at OS boundaries (`CreateFileW`); internal text may stay UTF-8, convert deliberately.
- `std::filesystem` + `<longPathAware>true</longPathAware>` manifest; never assume `MAX_PATH`.

## Kernel/system code
Check IRQL before paged memory; `NonPagedPoolNx`; model errors as `NTSTATUS`/`HRESULT`/`std::expected`, not silent booleans.

## Verification
```powershell
rg "std::aligned_alloc|/arch:AVX512|CreateFileA|RegOpenKeyA|strcpy|sprintf|gets" .
```
Build with `/W4 /WX /analyze` + ASan; CPUID dispatch smoke test exercises AVX2 and fallback paths; static search finds no ANSI WinAPI calls, banned C functions, or AVX-512 flags.
