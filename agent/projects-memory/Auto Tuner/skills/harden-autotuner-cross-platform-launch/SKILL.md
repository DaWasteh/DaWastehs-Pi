---
name: harden-autotuner-cross-platform-launch
description: "Debug and harden Auto Tuner model-launch crashes across Windows/Linux/macOS. Use when Auto Tuner crashes or aborts while loading/launching a model, after changing llama.cpp builds, on Ubuntu/macOS, or with older/forked llama.cpp binaries."
version: 3
created: "2026-07-17"
updated: "2026-07-17"
---

# Auto Tuner — Cross-Platform Launch Hardening

## Diagnosis workflow
1. Inspect `auto_tuner.py` and `qt_launcher.py` binary discovery first: native POSIX builds are extensionless and executable; Windows builds are `.exe`. Never let Linux/macOS auto-select a Windows `.exe` from a shared build folder.
2. Check the final argv built by `tuner.build_command` / `build_diffusion_*` and pass it through `tuner.prepare_command_for_binary(cmd)` before launch. That helper probes the selected binary's `--help` and prunes unsupported flags (e.g. `--fit`, `--cache-ram`, `--metrics`) that older/forked binaries would reject before model load.
3. For GUI launches on POSIX, read `app_data_dir()/logs/llama-server-*.log` — server stdout/stderr is redirected there, not to a terminal.
4. For frozen update/release work, keep platform assets distinct: Windows matches Windows/`.exe`, Linux matches Linux, and macOS/Darwin only matches macOS/darwin/osx assets (never Linux fallback).
5. When adding new llama.cpp flags, update `tuner._ARG_FLAGS_WITH_VALUES` and `_FLAG_ALIAS_GROUPS` if the flag takes a value or has short/long aliases, then add/adjust smoke tests.
6. Vision prompt caching is build-gated: probe `llama-server --version`, enable `--cache-ram` with `--mmproj` only for numeric builds >= b10045, and use `--cache-ram 0` for older/unprobeable binaries. b10058 was runtime-verified with Gemma 4 + a real image (`cached_tokens` 0→279).
7. Current mainline defaults `/slots` on. Emit `--slots` or `--no-slots` explicitly so AutoTuner's toggle is authoritative; let `prepare_command_for_binary` prune an unsupported negative flag on old forks.
## Pitfalls
- Do not re-add `.exe` candidates to POSIX auto-discovery; it recreates Ubuntu Exec-format/PermissionError launch crashes.
- Do not blindly strip command arguments without a usable `--help` parse; `prepare_command_for_binary` keeps commands unchanged if probing fails or core flags like `-m/--model` are absent.
- Avoid multiple readers on stdout and stderr pipes in `ServerProcess`; use `stderr=STDOUT` or concurrent readers to prevent deadlocks.

## Verification
```bash
python3 -m pytest -q
.venv_linux/bin/python -m ruff check .
python3 -m py_compile <changed files>
```

- Smoke tests cover resolver behavior, unsupported-flag pruning, `--slots`/`--no-slots`, build-number parsing, and the Vision prompt-cache cutoff.
- A POSIX GUI launch logs the exact server output path after starting.
- For Vision cache changes, run two identical real image requests and confirm the second reports nonzero `cached_tokens` without corruption.
- For a frozen Windows release, `ExtractIconEx` must find the embedded icon, the app must stay alive for at least 5 seconds, and the HWND must return a nonzero `WM_GETICON`; Qt 6 + PyInstaller may require explicit `WM_SETICON` after `show()`.