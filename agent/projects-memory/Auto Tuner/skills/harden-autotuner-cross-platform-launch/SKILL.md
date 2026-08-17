---
name: "harden-autotuner-cross-platform-launch"
description: "Debug AutoTuner model-launch crashes across Windows, Linux, and macOS, including binary discovery and unsupported llama.cpp flags. Do not use for ordinary UI work, release packaging, or unrelated llama.cpp builds."
version: 5
created: "2026-07-17"
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override historical defaults. Use only the launch path implicated by current evidence. Do not add release, packaging, dependency, or full-suite work unless that surface changed. Historical build cutoffs and measured values must be rechecked against the selected binary.

## When to Use
Use when AutoTuner crashes or aborts while discovering or launching a model, when POSIX selects a Windows executable, when an older/forked llama.cpp rejects flags, or when build-number-gated runtime behavior is wrong.

## Procedure
1. Inspect `auto_tuner.py` and `qt_launcher.py` discovery first. Native POSIX binaries are extensionless/executable; Windows binaries use `.exe`. Never let Linux/macOS auto-select a Windows executable from a shared folder.
2. Inspect the final argv from `tuner.build_command`/`build_diffusion_*` and pass it through `tuner.prepare_command_for_binary(cmd)`. That helper probes `--help` and removes only known unsupported optional flags.
3. Keep commands unchanged when probing fails or core model flags are missing; do not strip arguments speculatively.
4. For POSIX GUI launches, read the user-local `app_data_dir()/logs/llama-server-*.log`; stdout/stderr is redirected there.
5. When adding value-taking flags or aliases, update `_ARG_FLAGS_WITH_VALUES` and `_FLAG_ALIAS_GROUPS` plus focused command tests.
6. Gate Vision `--cache-ram` behavior on a correctly parsed numeric llama.cpp build. Parse current output such as `version: 0.1.0-dev (build 10423, ...)` before legacy `version: bN`; never misread semantic `0.1.0` as build 0.
7. Emit `--slots`/`--no-slots` explicitly when the UI setting must be authoritative, while allowing compatibility pruning on old forks.
8. Keep platform release-asset selection separate; load the manual release skill only when packaging/releasing is explicitly requested.

## Pitfalls
- Re-adding `.exe` candidates on POSIX recreates Exec-format/permission failures.
- Multiple blocking readers on separate stdout/stderr pipes can deadlock; combine streams or read concurrently.
- A parser accepting a flag does not prove the fork applies it.
- Build cutoffs such as the historical Vision cache threshold are evidence to verify against source/runtime, not permanent truth.

## Verification
1. Run focused resolver/argv tests for the changed discovery, alias, build-parser, or flag-pruning path.
2. For a launch bug, perform one bounded launch with the exact affected binary and inspect its dedicated log.
3. For Vision cache behavior, use two identical image requests only when that cache path changed.
4. Run the full cross-platform/release matrix only through the explicit release workflow, not for an isolated launch fix.
