---
name: "build-llama-forks"
created: "2026-07-17"
description: "Build llama.cpp and local forks through the Auto Tuner *_llama_build.txt scripts, including server-capable OCR builds and Vulkan/VS 2026 failure recovery. Manual-only; do not use for unrelated work."
version: 6
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

# Auto Tuner — llama.cpp Fork Build Rules

## Scope
Use the checked-in `building llama.cpp/*_llama_build.txt` scripts as the source of truth. Copy the relevant checked-in recipe to `L:/LAB/ai-local/Buildcommands/` when updating the live workstation command.

## Build workflow
- Run the matching build script instead of hand-writing CMake flags.
- Use Visual Studio 18 2026, Vulkan, and `--parallel 20` on Pandaking.
- Check every native command's `$LASTEXITCODE`; PowerShell's stop preference does not turn native failures into exceptions.
- Do not delete a last-known-good versioned build before the replacement passes its binary smoke test. Use unique staging/output names or backup-and-restore around the build directory.
- Do not force `-DCMAKE_ASM_COMPILER=cl` from an ordinary PowerShell: the generator locates the full MSVC assembler path itself, while a bare `cl` may fail CMake detection.
- For upstream llama.cpp after b9174, expect UI layout changes; preserve cached `node_modules` only when the selected script explicitly allows it.
- OpenSSL/cpp-httplib `const X509_NAME*` failures are solved by disabling SSL/HTTP extras or by the local patch already documented in the matching script.

## OCR builds
- AutoTuner OCR is server-based (`/v1/chat/completions`), so fork discovery intentionally requires `llama-server`; a `llama-mtmd-cli`-only source tree is not runnable by AutoTuner.
- The legacy `ocr_b17400_llama.cpp` recipe must build both `llama-server` and `llama-mtmd-cli`. Pin reviewed commit `95cc5665859b49d7158c5c4abc9943adf109c6d5`, refuse tracked dirty state, and restore the prior `build/` on configure/build/smoke failure.
- CMake caches absolute paths. If an OCR build moved from H: to L:, rebuild from a clean build directory rather than reusing the H:-bound cache.
- Unlimited-OCR `max_tiles=32` is not a CMake option. It requires llama.cpp b10287+ and mmproj metadata `clip.vision.preproc_max_tiles=32`; rebuilding the server cannot repair a stale projector.

## DiffusionGemma Vulkan crash triage
The classic `alloc_tensor_range ... Vulkan0 buffer of size 1073741824` has three causes:
1. Broadcast `head_count_kv=[2]` must be expanded to block count or KV is ~30× under-estimated.
2. Vulkan device 0 may be the smaller 9070 XT; forward `--main-gpu` / `--tensor-split` deliberately.
3. Vulkan has a ~1 GiB single-allocation ceiling; build/use a HIP/ROCm variant for that path.

## Pitfalls
- Do not rely only on `git describe` for llama.cpp build folder names. Since b10470, release CI explicitly pushes lightweight `b*` tags; recipes should query the remote tag namespace (`git ls-remote --tags <remote> refs/tags/b*`) for the exact commit before falling back to local tags or `git describe`, otherwise fresh releases can become `bUNKNOWN`.
- Do not fetch b-tags with a bracket refspec such as `+refs/tags/b[0-9]*:refs/tags/b[0-9]*`; Git refspecs do not accept that character-class pattern. Use `git fetch --tags` or remote `ls-remote` plus local filtering instead.
## Verification
- PowerShell parser accepts each edited `.txt` recipe before execution.
- Build log ends with the expected binaries under `build/bin/Release/`; run `llama-server.exe --version` and the secondary target's `--help`/`--version`.
- `auto_tuner._discover_llama_forks()` lists a server-built OCR directory and excludes a CLI-only directory.
- Run `llama-bench` or an AutoTuner launch against a real model when changing backend flags.
- For DiffusionGemma, verify `/health`, one completed prompt, actual KV type/context, GPU placement, and observed VRAM instead of equating parser acceptance with runtime application.
