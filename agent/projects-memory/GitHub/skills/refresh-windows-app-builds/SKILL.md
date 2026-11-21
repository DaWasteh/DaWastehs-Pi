---
name: "refresh-windows-app-builds"
description: "Sync L:/GitHub repos and rebuild/smoke-test Windows EXEs (LocalVoice, P-Viewer, SuperCalc, Tricorder, AutoTuner) after Ubuntu edits. Manual-only; do not use for single-repo edits."
version: 2
created: "2026-10-04"
updated: "2026-11-21"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Load manually when the user explicitly requests synchronizing local Windows apps and EXEs under `L:/GitHub` with changes made on another OS. Explicit user scope and repository status override this checklist.

## Procedure
1. Enumerate direct Git repositories under L:/GitHub; inspect status, fetch origins, fast-forward only clean behind branches. Compare EXE version resources, source/build history and documented hashes. Resolve desktop/taskbar/Start Menu .lnk targets through WScript.Shell; do not overwrite historical/versioned build archives.
2. LocalVoice: run powershell.exe -NoProfile -ExecutionPolicy Bypass -File Build.ps1. It uses project Python 3.14, tests, and replaces root LocalVoice.exe plus _internal and builds a release ZIP. Preserve runtime/models/state. Check ZIP with .venv/Scripts/python.exe scripts/check_portable.py --audio L:/VOICELAB/vendor/whisper.cpp/samples/jfk.wav --package dist/<current-zip>.
3. P-Viewer: npm run check:version; npm run check; npm test; npm run build:launcher; node scripts/smoke-local-launcher.mjs; cargo test --manifest-path src-tauri/Cargo.toml. Close preexisting app instances before build/smoke. Native smoke isolates session/documents.
4. SuperCalc Sicherheitsbenchmark: dotnet build SuperCalcBenchmark.slnx --configuration Release; dotnet run --project src/SuperCalcBenchmark.Tests --configuration Release --no-build; publish.bat. Both desktop-linked src/SuperCalcBenchmark.App/bin/Release/net10.0-windows output and artifacts/standalone/SuperCalcBenchmark-win-x64 matter. For native smoke set SUPERCALC_DATA_ROOT to a temporary directory and SUPERCALC_ASSET_ROOT to published assets; verify responsive window and graceful exit.
5. System Tricorder: tracked dist/system_tricorder.exe may already be current while release/SystemTricorder-windows-x86_64.exe is stale. Run project pytest, then copy/hash-verify only if needed. AutoTuner tracked dist/AutoTuner.exe can be compared with release-validation hashes and run --smoke-test with temporary AUTOTUNER_DATA_DIR.
6. Python-Games-Collection uses .venv/Scripts/python.exe -m unittest discover -s tests -v, not pytest. Tracked EXEs are psykanoid/dist/Psykanoid.exe and pytank/dist/PyTank.exe. Goauld Translator PC uses its own .venv and dist/GoauldTranslator.exe.
7. Recheck Git cleanliness/upstream equality and artifact versions; record paths, hashes, tests and explicit coverage limits in artifacts/windows-app-check-<date>.md.

## Pitfalls
- Git Bash: use MSYS_NO_PATHCONV=1 cmd.exe /d /c publish.bat.
- Tauri may rewrite Cargo.toml line endings with empty semantic diff; restore only verified build-generated changes, never user edits.
- Check actual test runner before installing missing pytest.
- Stop only owned test PIDs; preserve settings, models, sessions and unrelated running apps.

## Verification
1. All intended repositories match fetched upstreams without unintended tracked modifications.
2. EXE versions match source; shortcuts target current builds.
3. Native smoke tests pass and owned test processes are cleaned up.