---
name: "llama-cpp-vulkan-build"
description: "Build or repair llama.cpp on Pandaking Windows with Vulkan, VS 2026, and RDNA4. Use only for explicit llama.cpp configure/build failures or requested rebuilds; do not use for inference tuning, GGUF choice, Linux ROCm, or unrelated CMake projects."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Load manually for a requested llama.cpp Windows/Vulkan build, configure failure, MSBuild/WebUI problem, OpenSSL/cpp-httplib error, or backend build decision. The selected repository, desired targets, preservation requirements, and current upstream docs override this recipe.

## Procedure
1. Confirm the exact repository/drive, Git status, current branch/ref, CMake version, VS generator, desired backend, and targets. Do not assume `C:\LAB` versus another lab tree.
2. Preserve tracked and untracked user work. Never normalize `git reset --hard` or `git clean -fdx`; show any proposed cleanup separately and obtain approval. Prefer a new staging build directory.
3. Configure with CMake >=4.2 and `-G "Visual Studio 18 2026" -A x64`. Start from Vulkan, static libs, ccache off, and only task-required optional components.
4. Build the narrow targets first (`llama-server`, `llama-cli`, or `llama-bench` as requested) with `--parallel 20`.
5. For WebUI/xxd/MSB8066 failures, identify the failing embed/npm step. Use `LLAMA_BUILD_WEBUI=OFF` only when an embedded UI is not an acceptance requirement.
6. For cpp-httplib/OpenSSL qualifier failures, prefer supported CMake feature flags or an upstream/local reviewed patch; do not cast vendor code blindly. Reconfigure in a fresh build directory when cache flags changed.
7. Use Ninja only from a VS 2026 native tools environment when the generator itself is the problem.
8. Keep HIP on Windows opt-in and experimental for gfx1201; Vulkan remains the default. MXFP GGUF does not require a different backend.

## Pitfalls
- Deleting the repository/build before a replacement passes can destroy the last-known-good binary or local work.
- `LLAMA_CURL=OFF` alone may not disable cpp-httplib SSL compilation.
- A stale CMake cache can preserve obsolete paths/flags.
- Accepted CLI flags do not prove a fork applies them at runtime.
- Device/KV/context tuning belongs in `amd-dual-gpu-inference`, not this build procedure.

## Verification
1. CMake configure and the requested target build exit successfully; check native `$LASTEXITCODE` in PowerShell.
2. Run `--version` or `--help` on only the newly built requested binaries.
3. When backend/runtime behavior changed, run one focused real-model smoke or `llama-bench`; otherwise do not require a full model benchmark.
4. Confirm no pre-existing tracked/untracked work was removed and the last-known-good output remains recoverable until acceptance.
