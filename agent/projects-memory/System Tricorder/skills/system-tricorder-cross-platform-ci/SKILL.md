---
name: "system-tricorder-cross-platform-ci"
created: "2026-07-17"
description: "Extend and validate System Tricorder CI, PyInstaller packages, frozen self-tests, and releases across Windows, macOS, and supported Linux distributions. Manual-only; do not use for unrelated work."
version: 5
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when changing `.github/workflows/ci.yml`, cross-platform dependencies, PyInstaller release packaging, frozen startup behavior, or the Windows/macOS/Linux support matrix for System Tricorder.

## Procedure
1. Keep native GitHub-hosted jobs for `windows-latest`, `ubuntu-latest`, and `macos-latest`; test Fedora, Arch, Mint, CachyOS, Kali, and Debian through Docker on an Ubuntu hosted runner.
2. Put Windows-only dependencies behind PEP 508 markers in `requirements.txt` rather than filtering requirements in shell scripts.
3. Run every platform against the committed `tests/test_smoke.py` with `QT_QPA_PLATFORM=offscreen`; include a headless dashboard-construction check for macOS generic platform dispatch.
4. Use `.github/scripts/test_linux_distro.sh` for apt/dnf/pacman prerequisites and `.github/scripts/build_release.py` for portable PyInstaller data separators, Windows icons/version metadata, architecture naming, frozen `--self-test`, and tarball packaging.
5. Run each newly frozen executable or app-bundle binary with `--self-test` before packaging. Give that process isolated HOME and USERPROFILE directories, and let the app use a temporary layout config so developer settings are never overwritten.
6. Keep the reproducible local Windows `system_tricorder.spec` tracked even though generated `*.spec` files remain ignored; rebuild `dist/system_tricorder.exe` only after source freeze and verify its timestamp/hash/version metadata.
7. Upload one uniquely named `release-*` artifact per matrix leg and merge those artifacts only in the tag-gated release job. Push the branch first, wait for its complete matrix, and only then create/push the release tag.

## Pitfalls
- GitHub only provides hosted runners for Ubuntu, Windows, and macOS; named Linux distributions need containers or self-hosted runners.
- Container jobs create root-owned files in the mounted workspace; run an `if: always()` ownership-restoration step before artifact upload/cleanup.
- Do not pass the Windows `.ico` or version resource to non-Windows PyInstaller builds; the runtime PNG remains bundled on every platform.
- When PyInstaller uses `--specpath` outside the repository root, relative script/data/icon/version paths are resolved from the generated spec directory and builds fail. Pass absolute paths for every input while keeping the bundled destination relative.
- Minimal PyQt6 Linux images need native EGL, fontconfig, GLib, DBus, GL/XKB/XCB libraries before `QtWidgets` can import; installing the wheel alone is insufficient.
- Linux PyInstaller builds need `binutils` and a matching shared `libpythonX.Y`. Apt distributions do not reliably expose a generic `libpython3` package: install Python first, derive `libpython{major}.{minor}` from `python3`, then install that versioned package.
- CachyOS and Arch require a full `pacman -Syu` before installing packages; Debian-family images require `python3-venv`.
- A frozen self-test that inherits the real HOME can overwrite `~/.tricorder_layout.json` through closeEvent and append to the real log; isolate both HOME/USERPROFILE and the config path, hash the real config before/after, and restore immediately if any delegated test changes it.
- PyInstaller `--clean` does not guarantee that differently cased stale executables disappear from `dist` on Windows; verify the directory contains only the intended final artifact.
- Local Docker validation is unavailable when Docker Desktop's Linux engine is stopped; rely on syntax/unit checks and let the hosted matrix provide the final distro proof.
## Verification
1. Run `python -m pytest tests/test_smoke.py -q`.
2. Run Ruff, Pyflakes, and Pyright with the same policy as `.github/workflows/ci.yml`.
3. Run `bash -n start_linux.sh` and `bash -n .github/scripts/test_linux_distro.sh`.
4. Parse `.github/workflows/ci.yml` as YAML and verify the intended native and container distro matrices.
5. Run `.github/scripts/build_release.py` from a temporary copied checkout to prove the native package and its frozen self-test succeed without overwriting the tracked local EXE or developer config.
6. Build `dist/system_tricorder.exe` from `system_tricorder.spec`, run `--self-test`, confirm it is newer than the source, PE32+ x86-64, non-empty, and carries the expected file/product version.
7. Confirm a branch-push GitHub Actions matrix passes before tagging; after tag push, confirm the tag matrix, GitHub Release job, release URL, and all expected assets succeed.
