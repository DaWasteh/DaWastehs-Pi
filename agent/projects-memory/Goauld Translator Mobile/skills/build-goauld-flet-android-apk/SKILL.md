---
name: build-goauld-flet-android-apk
description: "Build and debug the Goauld Translator Mobile Flet Android APK on Linux or Windows. Use for APK packaging, blue-screen/startup issues, Flet cache problems, Gradle locks, phone-vs-emulator architecture mismatches, or release handoff. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

# Goauld Translator Mobile — Flet Android APK Build

## Environment
- Final APK: `build/apk/goauld-translator-mobile.apk`.
- Canonical project folder is apostrophe-free: `Goauld Translator Mobile`.
- Keep `pyproject.toml` and `requirements.txt` pinned/synchronized for the chosen Flet version; `[tool.flet.app] module = "main"`.

## Linux build procedure
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
export FLET_HOME=/tmp/goauld-flet-home
export HOME=$FLET_HOME
export JAVA_TOOL_OPTIONS="-Duser.home=$FLET_HOME"
export ANDROID_HOME=$FLET_HOME/Android/sdk
export ANDROID_SDK_ROOT=$ANDROID_HOME
export JAVA_HOME=$FLET_HOME/java/17.0.13+11
.venv/bin/flet build apk --arch arm64-v8a --clear-cache --verbose --yes
```

Use writable cache paths outside `/home/dawasteh` if sdkmanager/Flet tries to write Android/Java caches there.

## Windows build procedure
```powershell
$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONPATH = "."
python -m pytest -q
python -m compileall -q app goauld_engine main.py app.py
flet build apk --arch arm64-v8a --clear-cache --verbose --yes
```

If stale generated output must be removed, first confirm `build/` contains no user-authored files and obtain approval; prefer moving it to a timestamped backup or Recycle Bin. If Gradle/Lint files are locked, close Android Studio and stop only the identified Gradle/Kotlin daemon before retrying.

## Device startup debugging
- `adb logcat | findstr /i "goauld python flutter serious"` on Windows.
- Direct Gradle/Android Studio builds from `build/flutter` need `SERIOUS_PYTHON_SITE_PACKAGES=<repo>\build\site-packages`; prefer Flet CLI unless diagnosing.

## Pitfalls
- Paths with spaces can break sdkmanager/Flet cache handling.
- Stale `build/` can reuse x86_64 emulator site-packages for an ARM64 phone build.
- Phone APK must contain `lib/arm64-v8a/libpythonsitepackages.so`; emulator success is not proof.
- Dotted module names can be reduced by Flet; keep module name `main` to avoid collision with `app/` package.
- Do not commit APK/build artifacts unless explicitly requested.

## Verification
- Tests and compileall pass before packaging.
- APK contains `assets/flutter_assets/app/app.zip` with `main.py`, `app/`, `goauld_engine/`, and required assets.
- APK contains `lib/arm64-v8a/libpythonsitepackages.so` and `lib/arm64-v8a/libyaml.so`.
- `sha256sum build/apk/goauld-translator-mobile.apk` recorded for handoff.
- Optional: `adb install -r build/apk/goauld-translator-mobile.apk` succeeds on the target phone.
