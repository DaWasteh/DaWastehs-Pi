---
name: "verify-voxengine-windows-build"
created: "2026-07-08"
description: "Configure, build, and test VOXEngine on Pandaking Windows/VS 2026. Manual-only: invoke for an explicit engine/build validation task; do not use for small source-only edits."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill. It is manual-only because it runs configure/build/test stages. Invoke only the requested validation scope; do not add release, dependency, or unrelated cleanup work. Historical versions and paths must be rechecked.

## When to Use
Use after changing VOXEngine CMake, Vulkan startup, gameplay math, shaders, or platform portability code on Windows.

## Procedure
1. Run `cmake --preset windows-vs2026` from `L:/LAB/VOXEngine` to configure with Visual Studio 2026 x64.
2. Run `cmake --build --preset windows-vs2026-release` to build the engine and bundled test target.
3. Run `ctest --test-dir build/windows-vs2026 -C Release --output-on-failure` for the fast unit-test suite.
4. Check `git status --short` afterward; generated build output should remain ignored under `build/`.

## Pitfalls
- Use the Visual Studio 18 2026 preset, not VS 17/2022.
- If `vox_tests` fails on normal direction expectations, remember `gameplay/VoxMath.hpp::rayTriangle` deliberately flips normals to point against the ray direction.
- `ROADMAP.md` may be a local untracked planning file; do not commit it unless the user explicitly wants it.

## Verification
1. `cmake --build --preset windows-vs2026-release` exits successfully and produces `build/windows-vs2026/Release/VoxelEngine2026.exe`.
2. `ctest --test-dir build/windows-vs2026 -C Release --output-on-failure` reports 100% tests passed.
