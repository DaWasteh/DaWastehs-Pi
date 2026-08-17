---
name: "cross-platform-macos-compat"
description: "Keep shipped Python, GUI, launcher, subprocess, path, and packaging code compatible with Windows 11, Ubuntu, and macOS. Use for cross-platform deliverables; do not force macOS work onto platform-specific internal tools or one-OS maintenance tasks."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: low
---
## When to Use
Use when code or instructions are intended to ship on Windows, Linux, and macOS, especially Python applications, tkinter/Qt/Flet GUIs, launchers, subprocesses, paths, and packaging. Explicit target-platform requirements and repository CI are authoritative.

## Procedure
1. Branch explicitly with `sys.platform` (`win32`, `linux`, `darwin`) where behavior differs; do not let macOS accidentally fall through to Linux behavior.
2. Prefer `pathlib.Path`, `platformdirs`, argument-vector subprocesses with `shell=False`, and `shutil.which()` over platform shell assumptions.
3. Use Windows process groups/`CTRL_BREAK_EVENT`; on POSIX use `SIGTERM`, then bounded `SIGKILL` fallback. Preserve existing shutdown contracts.
4. Avoid GNU-only shell behavior on macOS (BSD `sed`, `date`, `stat`, and no guaranteed `grep -P`). Prefer Python for portable automation.
5. For GUI code, add Command-key accelerators on Darwin, portable PNG icons, and a clear Tk availability error. Do not hard-code Windows fonts.
6. Route GPU work by platform: Vulkan/ROCm/DirectML on supported AMD systems, Metal/MPS on macOS, CPU fallback when necessary. Never introduce CUDA-only requirements on Pandaking.
7. Keep LF in portable text and add a `macos-latest` CI job when macOS behavior materially changes.

## Pitfalls
- Windows/macOS case-insensitive filesystems can hide case-collision bugs seen on Linux.
- Rosetta Python and arm64 native libraries can fail in confusing ways.
- Gatekeeper behavior belongs in release guidance, not in routine code changes.
- Installing Homebrew/Tk or changing packaging dependencies requires task scope or user approval; it is not an automatic repair step.

## Verification
1. Run the smallest existing test/build for the changed path on the available OS.
2. For platform branches, add or run focused mocked/platform-dispatch tests.
3. Require macOS CI only when shipped macOS behavior changed; do not run a full cross-platform matrix for an unrelated local edit.
