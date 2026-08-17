---
name: "powershell-windows-scripting"
description: "Write or repair PowerShell, batch, and Windows launcher/process automation with correct encoding, error handling, shutdown, downloads, and venv behavior. Do not use for POSIX-only scripts or as authority to install/update/delete tools."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## When to Use
Use for `.ps1`, `.bat`, Windows CLI automation, subprocess supervision, downloads, console encoding, or Windows venv/wheel issues. Explicit task behavior and existing launcher contracts override these defaults.

## Procedure
1. In PowerShell, set `$ErrorActionPreference = "Stop"` and check `$LASTEXITCODE` after critical native commands. Prefer splatting over fragile backtick continuations.
2. Re-open a shell after approved tool installation or environment changes; use `where.exe` to diagnose shadowing first.
3. In batch files, initialize UTF-8 deliberately when needed, check `%errorlevel%`, and keep failure output visible for interactive launchers.
4. In Python, use argument-vector subprocesses, explicit UTF-8, normalized Windows path comparisons, and process-group-aware `CTRL_BREAK_EVENT` shutdown for cooperative console children.
5. Use reader threads/async streams only when live process reaction is required; a simple bounded `subprocess.run` is preferable for ordinary commands.
6. For broken wheel installs, diagnose the venv and package set before downloading or bypassing the resolver. Direct wheel recovery and environment mutation require task scope/approval.
7. Use resumable downloads and verify size/hash when the artifact is large or security-sensitive.
8. Preserve existing repositories and build outputs. Never make `git reset --hard`, `git clean -fdx`, recloning, or build deletion a default repair.

## Pitfalls
- Native executable failure does not become a PowerShell exception automatically.
- Backticks with trailing spaces break parsing.
- Repeated Ctrl+C can leave supervised server processes or ports in a bad state.
- Nightly ROCm/Torch wheels must be resolved as a compatible set.
- Global PATH, package, toolchain, and registry mutations require explicit approval.

## Verification
1. Parse the changed PowerShell/batch script or run its smallest dry-run/help path.
2. Exercise only the changed success/failure/shutdown path with a disposable process or fixture.
3. For environment recovery, verify from a fresh process and report what was intentionally not changed.
4. Run broad launcher/install tests only when those workflows changed.
