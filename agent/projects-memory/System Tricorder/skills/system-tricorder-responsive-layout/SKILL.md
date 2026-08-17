---
name: "system-tricorder-responsive-layout"
created: "2026-08-14"
description: "Validate System Tricorder scaling, compact/fullscreen/edit layouts, high DPI, and frozen behavior. Manual-only: invoke for cross-mode layout validation; do not use for a narrow widget or copy edit."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and current Qt geometry evidence override this skill. It is manual-only because it spans multiple window modes, DPI fixtures, analyzers, and frozen validation. Select only the requested modes/checks.

## When to Use
Use when System Tricorder tiles leave vertical gaps, clip during resize, flicker, show scrollbars, misbehave at high DPI, or fail to fit in normal/maximized/fullscreen/edit modes.

## Procedure
1. Snapshot and hash ~/.tricorder_layout.json before every UI test; redirect CONFIG_FILE to a temporary path and close/delete test dashboards in try/finally.
2. Treat Qt 6 widget coordinates as device-independent; do not multiply geometry or minimum window size by devicePixelRatio a second time.
3. Keep the dashboard content explicitly synchronized to the QScrollArea viewport in fill mode and disable both scrollbars.
4. Use expanding rows with no maximum-height pins; dynamically reduce row/grid/drop-zone spacing before it can displace active widgets.
5. Coalesce expensive settle work with a single-shot timer, but synchronously update content bounds during resize and window-state transitions.
6. Run offscreen regression tests at 640x360 with artificial 200% scaling, multiple GPUs/drives, a high CPU-widget count, edit mode, maximize/fullscreen, and restored geometry.
7. Rebuild dist/system_tricorder.exe from system_tricorder.spec and run the frozen --self-test with isolated HOME, USERPROFILE, and TEMP.

## Pitfalls
- A fixed row maximum creates blank vertical bands in stretched QVBoxLayout sections.
- Hiding scrollbars alone only hides overflow; force content to viewport size and verify every active tile, sparkline, and CPU widget stays within both x and y bounds.
- Fixed label widths and DPI-scaled spacing can still clip internals even when the outer tile frame is visible.
- Nested QApplication.processEvents calls make resize handling re-entrant and can cause flicker.
- If an offscreen assertion fails before a dashboard closes, monkeypatch teardown can restore the real CONFIG_FILE before closeEvent runs and overwrite the user's geometry.
- Auto-fit clamped by screen height must fall back to fill mode because scrollbars are intentionally unavailable.

## Verification
1. python -m pytest tests/test_smoke.py -q passes and the real config hash/mtime is unchanged.
2. Ruff, Pyflakes, and Pyright pass with the same policy as .github/workflows/ci.yml.
3. At 640x360, both scrollbar policies are AlwaysOff and all active outer widgets plus sparklines remain within the viewport in normal and edit modes.
4. The rebuilt EXE --self-test exits successfully, carries file/product version metadata, and its CArchive contains the expected version and responsive-layout methods.
5. Run branch/tag/release CI only when an explicit release is in scope; otherwise stop after the focused source/frozen layout evidence.
