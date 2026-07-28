---
name: cross-platform-macos-compat
description: Write code that runs on Windows 11, Ubuntu, AND macOS. Consult when creating or reviewing Python tools, GUI apps (tkinter/CustomTkinter), launcher/shell scripts, subprocess handling, file paths, or install instructions - even if the request only mentions one OS. Shipped programs target all three platforms; macOS is the one that cannot be tested locally, so its pitfalls must be handled proactively.
---

# Cross-Platform Rules (Windows / Ubuntu / macOS)

Dev/test happens on Windows 11 + Ubuntu; **macOS cannot be tested locally**. Use platform-neutral APIs by default and gate every OS branch explicitly with `sys.platform` (`win32`/`linux`/`darwin`). Every Windows branch needs a deliberate darwin branch, not a fallthrough into the Linux path.

## Paths & filesystem
- Always `pathlib.Path`; config/data dirs via `platformdirs` (Windows `%APPDATA%`, Linux XDG, macOS `~/Library/Application Support/<App>`).
- Case sensitivity: Windows and macOS-APFS insensitive, Linux sensitive — compare via `normcase`, never create files differing only in case. Ignore `.DS_Store`.

## Processes & shells
- Portable shutdown: `win32` → `CTRL_BREAK_EVENT` (process started with `CREATE_NEW_PROCESS_GROUP`), else `SIGTERM` then `SIGKILL` after timeout.
- `subprocess` with argument lists, never `shell=True`; find executables via `shutil.which()`.
- macOS ships BSD userland (`sed -i ''`, no `grep -P`, different `date`/`stat`/`readlink`) — prefer Python over shelling out. Install docs use Homebrew. Call `python3`, shebang `#!/usr/bin/env python3`.

## GUI (tkinter/CustomTkinter)
- macOS system Tk is often broken → document `brew install python-tk`; verify at startup, fail with a clear message.
- Bind `<Command-...>` accelerators additionally on darwin; `.ico` is Windows-only, provide `.png` via `iconphoto`; don't hardcode Segoe UI/Consolas fonts.

## GPU / AI workloads
- macOS has no Vulkan/ROCm/CUDA — GPU path is **Metal** (llama.cpp `-DGGML_METAL=ON`, PyTorch `mps`). Device-selection logic needs a darwin branch; AMD VRAM-sizing heuristics don't transfer (unified memory).
- Pin wheels per arch (`platform.machine()`); Rosetta-x86 Python + arm64 native libs fails silently.

## Packaging & distribution
- Repo line endings LF (`.gitattributes: * text=auto eol=lf`), CRLF only for `.bat`/`.ps1`; POSIX scripts need shebang + `chmod +x`.
- Gatekeeper blocks unsigned apps: document right-click → Open or `xattr -d com.apple.quarantine <file>`.
- The only practical macOS test without a Mac: a `macos-latest` GitHub Actions job.

## Review checklist
Hardcoded paths/drive letters? Windows-only APIs without darwin branch (winreg, CTRL_BREAK, msvcrt)? GNU-tool shell-outs? `encoding="utf-8"` everywhere? GPU fallback to Metal/CPU? Install docs cover brew + python3?
