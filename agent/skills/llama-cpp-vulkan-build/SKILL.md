---
name: llama-cpp-vulkan-build
description: Build llama.cpp from source on Windows 11 with Vulkan for AMD RDNA4 (RX 9070 XT / R9700) using Visual Studio 2026. Use this skill for ANY llama.cpp build, rebuild, daily-update, build error (MSB8066, xxd.cmake, WebUI, C2440/cpp-httplib/OpenSSL), CMake configuration, or HIP-vs-Vulkan question. Contains known-good commands and fixes for recurring failures.
---

# llama.cpp Vulkan Build (Windows 11 / VS 2026 / RDNA4)

## Canonical incremental daily build

```powershell
$ErrorActionPreference = "Stop"
$repo = "C:\LAB\ai-local\llama.cpp"

if (Test-Path $repo) {
    cd $repo
    git fetch --all --prune
    git reset --hard origin/master
    # wipe everything untracked EXCEPT webui node_modules (saves ~1 GB/day)
    git clean -fdx -e tools/server/webui/node_modules
} else {
    cd C:\LAB\ai-local
    git clone https://github.com/ggml-org/llama.cpp llama.cpp
    cd $repo
}

cmake -B build `
  -G "Visual Studio 18 2026" -A x64 `
  -DGGML_VULKAN=ON `
  -DGGML_NATIVE=ON `
  -DBUILD_SHARED_LIBS=OFF `
  -DCMAKE_BUILD_TYPE=Release `
  -DGGML_CCACHE=OFF `
  -DLLAMA_CURL=OFF

cmake --build build --config Release --parallel 20 --target llama-server llama-cli llama-bench
```

Binaries land in `build\bin\Release\`.

## Hard requirements
- CMake >= 4.2 (older CMake does not know the `"Visual Studio 18 2026"` generator). Check `cmake --version`, update via `winget upgrade Kitware.CMake`, then open a NEW PowerShell session.
- Do not use `"Visual Studio 17 2022"` — VS 2022 is not installed.
- Building only the three targets above skips most WebUI pipeline fragility.

## Known failure patterns and fixes

### 1. WebUI / MSB8066 / xxd.cmake ("string sub-command LENGTH requires two arguments")
The SvelteKit WebUI embed pipeline (index.html.hpp, bundle.js.hpp, ...) breaks periodically after upstream refactors, or when Node/Git-Bash aren't on PATH.
- Fastest fix: build without embedded WebUI → add `-DLLAMA_BUILD_WEBUI=OFF` (warning about "building server without embedded WebUI" is then expected and fine).
- If WebUI is wanted: ensure `node -v` >= 22 and `bash` resolves (Git Bash on PATH), delete `build/` fully, reconfigure.
- MSB8065 stamp warnings are cosmetic; the real error is usually the xxd.cmake/npm step above it.

### 2. C2440 "Conversion loses qualifiers" in vendor\cpp-httplib\httplib.cpp (~line 12511)
Newer OpenSSL returns `const X509_NAME*`, cpp-httplib expects non-const. `-DLLAMA_CURL=OFF` alone does NOT prevent httplib compilation.
- Preferred: disable SSL paths entirely: `-DLLAMA_OPENSSL=OFF -DGGML_OPENSSL=OFF -DCPPHTTPLIB_OPENSSL_SUPPORT=OFF`
- Fallback: patch the line with an explicit C-style cast to `X509_NAME*`.
- Always delete `build/` before reconfiguring so the CMake cache doesn't keep old flags.

### 3. Generator/MSBuild flakiness
Ninja is the robust alternative (single-config, drives cl.exe directly). Must run from an "x64 Native Tools Command Prompt for VS 2026":
```powershell
winget install Ninja-build.Ninja
cmake -B build -G Ninja -DGGML_VULKAN=ON -DCMAKE_BUILD_TYPE=Release -DLLAMA_CURL=OFF
cmake --build build --parallel 20
```

## HIP/ROCm on Windows for gfx1201 — default answer: don't
- Vulkan is the reliable backend on this hardware/OS. HIP on gfx1201/Windows has known init failures ("has 2 ISAs...", CPU fallback) and broken rocWMMA-FA episodes.
- MXFP4 GGUFs are a quant format, NOT a backend feature — they run on the Vulkan build with no extra flags.
- If HIP is attempted anyway: Ninja + clang from `$env:HIP_PATH\bin`, `-DGGML_HIP=ON -DGPU_TARGETS=gfx1201` (`AMDGPU_TARGETS` is deprecated), leave `GGML_HIP_GRAPHS` and `GGML_HIP_ROCWMMA_FATTN` OFF until the bare build works.

## Verification after build
```powershell
.\build\bin\Release\llama-bench.exe -m I:\models\<family>\<model>.gguf
```
Expected: three Vulkan devices (Vulkan0 = RX 9070 XT, Vulkan1 = R9700, Vulkan2 = Intel iGPU) and both AMD cards reporting `matrix cores: KHR_coopmat`. `warp size: 64` on the Windows proprietary driver is normal — see `amd-dual-gpu-inference`.
