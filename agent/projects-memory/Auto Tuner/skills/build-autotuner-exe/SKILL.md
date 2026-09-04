---
name: "build-autotuner-exe"
created: "2026-07-05"
description: "Build the noconsole AutoTuner .exe / Linux binary and publish a self-updating GitHub Release. Manual-only; do not use for unrelated work."
version: 21
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Releasing a new AutoTuner version (compiled noconsole binary), refreshing the self-update release asset, or diagnosing frozen-build path/state issues (settings vs user state).

## Procedure
1. For a real release, bump VERSION only in autotuner_version.py and keep the tag exactly v<VERSION>.
2. Before a local build, back up dist/autotuner_settings.json because build_exe.py deletes dist/. Confirm no AutoTuner.exe process is running; if it owns an active llama-server, get permission and stop it cleanly before closing both PyInstaller bootloader processes.
3. Run python build_exe.py on the target OS (no cross-compilation), then immediately restore the backed-up settings beside the binary.
4. Run the fresh frozen binary with --smoke-test and require exit code 0. This validates the bundled profiles, themes, and frozen resource paths without entering the GUI event loop.
5. Launch the fresh Windows EXE and allow up to 45 seconds for PyInstaller extraction/startup. Find every AutoTuner.exe PID by process name/path rather than relying only on parent-child relationships, because the GUI process can be reparented. In pywin32 window enumeration, obtain HWND process IDs with win32process.GetWindowThreadProcessId(hwnd), not win32gui. Once visible, keep the window alive for at least 5 seconds; verify embedded icons and nonzero WM_GETICON handles. Close all bootloader/GUI processes and restore tester settings again because launch may update UI state.
6. Include the tracked dist/AutoTuner.exe in the release commit when the user requests the EXE to be pushed.
7. Before committing, run the full pytest suite, compileall, and the exact Ruff version pinned in .github/workflows/ci.yml. Ruff check is blocking; require ruff format --check cleanliness for every changed Python file. Ensure ruff.toml is tracked.
8. Commit and push main first. Watch the main CI run with gh run watch <run-id> --exit-status and do not create the release tag until CI, including every Windows/Linux/macOS Python matrix job and Ruff, passes.
9. Create and push the annotated tag v<VERSION>. The release workflow enforces an exact tag/version match.
10. The tag workflow builds AutoTuner-Windows-x64.zip, AutoTuner-Linux-x64.zip, and AutoTuner-macOS-arm64.zip. It asserts PE/ELF/Mach-O architecture and runs --smoke-test on every frozen artifact before staging.
11. Before publishing, the exact generic Linux ZIP is launched on Ubuntu, Fedora, Arch Linux, Linux Mint, CachyOS, Kali Linux, and Debian; source CI also covers those containers.
12. Watch the release run with gh run watch <run-id> --exit-status; do not claim success before all platform builds, frozen smoke tests, distro verification jobs, and publishing pass.
13. Replace the generated release body with concrete notes via gh release edit v<VERSION> --notes-file <notes.md>. Include unsigned/unnotarized macOS Gatekeeper guidance.
14. Verify gh release view v<VERSION> --json assets,isDraft,isPrerelease,url reports all three architecture-qualified assets and a public non-draft release. Download the ZIPs and inspect their executable headers (PE AMD64, ELF x86-64, Mach-O arm64), executable mode bits, sizes, and published SHA-256 digests.
15. Use workflow_dispatch only when a draft release is intentionally desired.
16. Users unzip and launch; the update button selects an asset by both OS and CPU architecture and swaps the binary through the zip-aware shim while preserving settings.
## Pitfalls
- ALL user-writable state MUST go through app_settings.app_data_dir() (= EXE folder when frozen); Path(__file__).parent in a frozen onefile build lands in _MEIPASS (temp, wiped on exit).
- build_exe.py currently deletes the whole dist/ directory. Back up and restore dist/autotuner_settings.json around every local build so a tester's model paths and UI settings are not erased.
- Windows locks a running dist/AutoTuner.exe: stop both PyInstaller bootloader processes before rebuilding, or _clean() fails with PermissionError: [WinError 5]. The same lock is why self-update uses the .bat swap shim.
- Runtime icon = bundled assets/AutoTuner.png; Explorer/EXE icon = multi-resolution assets/AutoTuner.ico via PyInstaller --icon. Keep both files and the --add-data assets argument.
- noconsole (--windowed) sets stdout/stderr to None; frozen startup redirects them to autotuner_console.log.
- If a release has no asset for the host OS/architecture, _pick_asset must report that cleanly instead of selecting a different architecture or crashing.
- Distro containers start as root so package installation works, but AutoTuner tests and GUI smoke launches must run unprivileged. The helper drops to UID/GID 65534 with setpriv; otherwise root/admin-specific mlock behavior makes the desktop-user test suite fail and tests the wrong runtime mode.
- Keep one generic AutoTuner-Linux-x64.zip; publishing distro-named Linux assets would make the current updater's Linux asset selection ambiguous.
- The macOS asset must remain AutoTuner-macOS-arm64.zip and run on an explicitly arm64 GitHub runner. The community app is only ad-hoc signed by the build tool, not Apple Developer ID-signed or notarized, so release notes must explain Finder Right-click → Open / Privacy & Security → Open Anyway.
- The Windows release ZIP intentionally contains only AutoTuner.exe and LiesMich - AutoTuner.txt; themes/defaults are embedded in the one-file executable and portable settings are created beside it at runtime.
- When a test monkeypatches shared shutil.get_terminal_size, return a real os.terminal_size((columns, rows)), not a SimpleNamespace; pytest's progress reporter imports the same module object and must unpack both values in CI.
- Cross-platform display tests must account for the intentional MEM: label on unified-memory Apple hosts versus RAM: on dedicated-memory hosts; otherwise every macOS Python matrix job fails despite correct runtime output.
- This pywin32 build has no win32gui.GetMenuString; use user32.GetMenuStringW via ctypes to inspect native system-menu text. PyQt6 QMessageBox label text is not exposed reliably as Win32 child captions, so verify the titled dialog opens at the HWND level and test its static text through Qt/unit tests.
- Several historical repository blobs use CRLF (currently auto_tuner.py, diagnostics.py, performance_target.py, and models_metadata.md) while most files use LF. With core.autocrlf=true, line-ending conversion can stage an all-lines rewrite. Compare raw HEAD/worktree newline counts, preserve each existing blob convention, stage with git -c core.autocrlf=false add, and use git -c core.whitespace=cr-at-eol diff --cached --check for the final whitespace gate.
- `gh run watch <id> --exit-status` may abort on a check-run annotation subrequest with HTTP 401 while the workflow itself remains healthy. Confirm via `gh run view <id> --json status,conclusion` or the Actions run API; do not misreport the annotation-fetch failure as a CI/release failure.
## Verification
1. python build_exe.py exits 0 and prints OK — dist/AutoTuner.exe (NN MB) (or the target-OS artifact).
2. The frozen binary exits 0 with --smoke-test and reports the expected VERSION plus a nonzero bundled-profile count.
3. Windows: win32gui.ExtractIconEx("dist/AutoTuner.exe", 0) returns icon handles; the app starts and stays alive at least 5 seconds with a nonzero WM_GETICON handle.
4. First run writes settings/logs next to the binary, not into _MEIPASS, and the pre-build portable settings backup is restored byte-for-byte after testing.
5. pytest, Ruff check, Ruff format --check for changed Python files, compileall, YAML parsing, and whitespace checks stay green.
6. Main CI passes every Python 3.10-3.14 Windows/Linux/macOS job before tagging.
7. The tag workflow passes native Windows x64, Linux x64, and macOS arm64 build/smoke jobs, every Linux distro launch, and the publish job.
8. Downloaded release ZIPs contain PE AMD64, ELF x86-64, and Mach-O arm64 executables with expected mode bits; their SHA-256 values match GitHub's asset digests.
9. gh release view reports exactly the three architecture-qualified ZIPs, a non-draft/non-prerelease release, detailed notes, and a tag peeled to the intended origin/main commit.
