---
name: "windows-python-golden-rules"
description: "Write modern Python 3.12+ for Windows paths, venvs, subprocess/multiprocessing, native wheels, and AMD GPU backends. Use for Windows Python/local-AI code; do not use for pure POSIX tasks, authorize package changes, or translate CUDA examples blindly."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for Python code that runs on Windows, especially paths, subprocesses, multiprocessing, native wheels, GUI launchers, or AMD GPU ML. Explicit project Python/package policy and lockfiles override tool preferences.

## Procedure
1. Use the repository's existing environment manager; prefer per-project venvs and `pathlib.Path`. Do not install globally or replace lockfile versions without scope.
2. Use Proactor-compatible async I/O and guard multiprocessing entry points for Windows spawn semantics.
3. Treat free-threaded Python as opt-in only after native extensions are confirmed compatible.
4. Use argument-vector subprocesses and process-group-aware Windows shutdown; load `powershell-windows-scripting` for launcher/console details.
5. For native packages, diagnose wheel/ABI/toolchain compatibility before compiling or changing dependencies.
6. On Pandaking, select ROCm/HIP, DirectML, Vulkan, or CPU deliberately. Never propose CUDA-only solutions; map tutorials to a supported backend or state incompatibility.
7. Select the intended AMD device explicitly when the framework may choose the smaller GPU.

## Pitfalls
- Defender/temp directories can distort subprocess/build timings.
- Windows path comparisons need normalized case; long paths need deliberate support.
- ROCm/HIP wheel compatibility is workload/version-specific on Windows.
- DirectML is a fallback with different operator/performance behavior, not a drop-in quality guarantee.
- A package repair must not silently replace the custom AMD Torch stack.

## Verification
1. Run the smallest test/import/CLI smoke in the intended venv and Python version.
2. For multiprocessing/subprocess changes, exercise the Windows spawn/shutdown path.
3. For ML changes, print/verify backend, device identity, and expected memory before one focused model operation.
4. Run broad environment/package checks only when dependencies or distribution changed.
