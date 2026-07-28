---
name: powershell-windows-scripting
description: House rules for writing PowerShell, batch, and Python launcher scripts on this Windows 11 system. Use whenever generating or fixing any .ps1/.bat/CLI automation, subprocess handling, downloads, or console output on Windows. Encodes fixes for recurring bugs (encoding, error handling, process shutdown, pip/venv quirks).
---

# Windows Scripting House Rules

## PowerShell
- Start scripts with `$ErrorActionPreference = "Stop"`. Native EXE failures don't throw — check `$LASTEXITCODE` after critical native calls (cmake, git, npm) explicitly.
- Backtick line continuation only with NO trailing spaces. Prefer splatting for long argument lists.
- After installing/updating tools (winget), a NEW shell session is required for PATH changes. Say so in instructions.
- `where.exe <tool>` to find shadowed/duplicate installs (classic: old Node before new Node).
- Prefer incremental workflows: `git fetch + reset --hard + git clean -fdx -e <keep>` instead of re-cloning; delete only `build/` instead of the repo.

## Batch (.bat)
- First lines: `chcp 65001` and `set PYTHONUTF8=1` — prevents `UnicodeEncodeError` from emoji/umlaut prints on cp1252 consoles.
- Check `%errorlevel%` after every critical step; end failure paths with `pause` so the window doesn't vanish.
- Verify tool presence (git, curl, tar) before use and print clear messages.

## Python on Windows
- Avoid emoji in `print()` for console tools; or guard with `isinstance(sys.stderr, io.TextIOWrapper)` before `reconfigure(encoding="utf-8")` (also satisfies mypy without ignore comments).
- Path comparisons are case-insensitive on Windows — normalize with `.lower()` / `os.path.normcase` before comparing (e.g. blocklists).
- Graceful shutdown of console subprocesses (llama-server): send `CTRL_BREAK_EVENT` (process started with `CREATE_NEW_PROCESS_GROUP`), not SIGTERM. Warn users to press Ctrl+C once, not repeatedly (zombie process on port otherwise).
- Long-running subprocess monitoring: dedicated reader thread on stdout/stderr with regex matching (e.g. OOM patterns) — never blocking `subprocess.run` when live reaction is needed.

## pip / venv / wheels
- Broken/interrupted installs leave corrupt RECORD files → `--force-reinstall` can enter resolver backtracking hell. Prefer direct wheel URLs with resumable `curl -C -` downloads, then `pip install --ignore-installed --no-deps <wheel>`.
- Nightly wheel ecosystems (torch/ROCm): versions must be resolved as a SET — intersect the available tags across all required packages and pick the newest complete set; never pin one package's nightly and hope the rest match.
- On this system pip inside dedicated venvs; on Ubuntu use `--break-system-packages` only in throwaway environments.

## Downloads & repos
- `curl -L -C -` for resumable large downloads; verify file size afterwards.
- Log to files under a `logs\` directory next to the script; timestamped filenames.
