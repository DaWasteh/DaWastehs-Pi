---
name: "autotuner-model-browser-tree"
created: "2026-08-17"
description: "Validate AutoTuner's model list/tree, filtering, favorites, and Qt delegate interaction across source and frozen builds. Manual-only: invoke for matching cross-view/runtime validation; do not use for a small local UI edit."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and current Qt behavior override this skill. It is manual-only because it spans list/tree state plus source and frozen runtime interaction. Run only the requested views/smokes; do not broaden a local UI edit into release validation.

## When to Use
Use when changing AutoTuner's model list/tree switch, folder expansion, filtering, selection, favorites, or Qt item delegates in qt_launcher.py.

## Procedure
1. Keep QListWidget and QTreeWidget views populated from the same ModelEntry set and preserve the selected model when switching or filtering.
2. Derive tree folders from each model's real path relative to active scan roots; distinguish multiple roots and keep favorites in a separate top section while retaining models in their original folders.
3. Default folders to expanded by tracking explicitly collapsed keys rather than tracking expanded keys; filtering may temporarily expand paths without overwriting collapse state.
4. Never clear/rebuild QTreeWidget synchronously inside _FavoriteStarDelegate.editorEvent. Persist the favorite immediately, then coalesce a QTimer.singleShot(0, ...) refresh so Qt can finish using the active QModelIndex.
5. Run the production-path source smoke command and the same command from the freshly built frozen executable before release.

## Pitfalls
- Synchronous tree rebuilding during a delegate mouse event invalidates Qt's QModelIndex and can terminate the entire Python or frozen process.
- A QListWidget favorite flow can appear safe while the same delegate flow crashes QTreeWidget; test the tree specifically.
- Do not let interaction smoke tests modify portable user settings; temporarily replace the favorite persistence callback and restore it in finally.
- New folders cannot default expanded if expansion state is represented only by a set of expanded keys; track collapsed keys instead.

## Verification
1. python -m pytest -q passes, including test_model_tree_favorite_interaction_is_deferred_and_crash_safe.
2. python qt_launcher.py --model-tree-smoke-test --settings-path settings exits 0.
3. dist/AutoTuner.exe --model-tree-smoke-test --settings-path settings exits 0 after rebuilding.
4. The real frozen GUI remains alive, shows the expected version title, and has nonzero embedded/window icon handles.
