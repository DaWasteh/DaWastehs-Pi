---
name: "autotuner-cross-platform-app-settings"
created: "2026-07-10"
description: "Add or maintain AutoTuner application settings that integrate with Windows, Linux, and macOS desktop startup/window behavior. Do not use for unrelated project work or to broaden a smaller task."
version: 5
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when adding AutoTuner GUI-level preferences such as login autostart, close/minimize behavior, title-bar integration, or other settings that must work in source and PyInstaller builds across Windows, Linux, and macOS.

## Procedure
1. Persist simple opt-in GUI behavior in app_settings.py with a safe false default; keep autotuner_settings.json user-local and ignored.
2. Put OS integration in a separate platform-gated module. Use HKCU Run on Windows, XDG autostart .desktop on Linux, and a per-user LaunchAgent plist on macOS. Build launch arguments from sys.executable and qt_launcher.py for source runs, or sys.executable alone when sys.frozen.
3. Expose the dialog from the cross-platform toolbar. For Windows title-bar system-menu integration, insert the item only after window.show() so the HWND is realized, and retain the toolbar as a fallback.
4. For X-to-notification-area behavior, lazily create QSystemTrayIcon with the bundled PNG fallback, retain the QMenu reference, hide (do not minimize) the main window, and provide Show + Quit actions. Treat Windows/macOS tray hosting as native even if Qt transiently reports false; trust Qt's availability probe on Linux.
5. Ensure explicit Quit and signal shutdown bypass optional X-to-tray behavior; if tray Quit needs a running-server confirmation, restore the hidden window first so the dialog has a visible parent.
6. Add pure tests using isolated files and a mocked winreg module; avoid modifying the real registry or real autostart directories.
7. Run focused settings/platform tests first. Add Ruff/compile checks for changed files and a live HWND/tray check only when native menu or tray behavior changed; reserve the full smoke suite for cross-cutting/release work.
## Pitfalls
- In PyQt 6.11 on Windows, calling super().nativeEvent after reading the Win32 MSG can access-violate. Return (False, 0) for unhandled events and (True, 0) for the handled custom command.
- Do not call GetSystemMenu before window.show(); an unrealized HWND can crash native code.
- Do not use showMinimized() for an Infobereich/system-tray request: create QSystemTrayIcon and hide() the main window.
- QSystemTrayIcon.isSystemTrayAvailable() can transiently return False on Windows while Explorer initializes/restarts, even though Windows provides a native notification area. Allow tray creation on win32/darwin; use the runtime probe to gate Linux desktops.
- Always provide a non-null tray icon: use the QApplication/window icon first, then bundled assets/AutoTuner.png. Keep a Python reference to the QMenu so it is not garbage-collected.
- Do not let Quit actions use self.close directly when X-to-tray is enabled; set an explicit force-quit flag first.
- Quote Linux Desktop Entry Exec arguments according to the freedesktop format; do not use shell=True.
- Do not test Windows autostart against the user's real HKCU registry—mock winreg.
## Verification
1. Run the focused test(s) covering the changed setting/platform branch; use full `test_smoke.py` only for cross-cutting changes.
2. Ruff and compile checks pass for changed Python files.
3. For Windows native-menu changes, confirm the Settings item is placed correctly after `show()`.
4. For tray changes, verify hide/show and explicit Quit, including a reachable running-server confirmation.
5. Test only the OS branches changed locally; rely on the existing CI matrix for untouched platforms.
