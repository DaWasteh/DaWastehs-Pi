---
name: "validate-and-release-browser-games"
description: "Validate and publish Browser-Games-Collection releases with static, logic, browser, compatibility, and GitHub Pages checks. Manual-only: use only for an explicit matching task."
version: 9
created: "2026-07-14"
updated: "2026-09-03"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only because it can commit, tag, push, deploy, or touch persistent browser data, so run only the explicitly requested stages.

## When to Use
Use before committing, tagging, or pushing a Browser-Games-Collection release, especially after changing game logic, deterministic datasets, persistence, keyboard controls, dialogs, or the root launcher.

## Procedure
1. Confirm the root launcher has exactly 16 unique game cards, every target exists, every playable page links back to `../index.html`, and all local `src`/`href` references resolve.
2. Run `node --check` for every checked-in `.js`, `.mjs`, and `.cjs` file. Parse non-empty inline HTML scripts with `vm.Script` so syntax errors in standalone games are covered too.
3. Run every checked-in `smoke-test.cjs`, including Pahjong, Pandataire, Panndike, Panda Lemmings, Tetris, Minesweeper, Texttl, Pandakreuzwort, Sand Game, and Maulkorbraupen. Allow enough time for the larger Pandakreuzwort generator farm.
4. With Node.js 22+ and local Chrome/Edge/Chromium, run both `node browser-smoke-test.mjs` and `node classic-games-smoke.mjs`. Together they cover all 16 games across phone, landscape, tablet, and desktop viewports; styled games also run in Panda, Nacht, and Kontrast modes.
5. Run HTMLHint over every HTML file, then serve the repository locally and fetch the launcher plus all 16 game routes over HTTP. Fail on missing assets, runtime exceptions, console errors, horizontal overflow, broken modal focus, or inaccessible controls.
6. When a deterministic word bank changes, preserve the complete prior pool/order, pin it with a stable digest, test both sides of any dated schedule cutover, and load a real previous-version save fixture. Confirm seed, puzzle, board, hints, focus, timer, and status survive.
7. For multi-tab persistence, use two same-origin iframes/documents and force conflicting outcomes in both write orders. Store immutable events under non-colliding keys and reduce them deterministically; also verify a stale terminal save cannot downgrade the canonical result. Use reduced-motion emulation to keep animation-heavy tests fast.
8. Exercise real event targets: dispatch keyboard events on the focused tile/button/canvas rather than `document`, because document-targeted synthetic events can miss form-control guards. Test Escape focus restoration and ensure gameplay shortcuts do not fire behind dialogs.
9. Visually inspect Pahjong in Panda, Nacht, and Kontrast at desktop and mobile sizes. Check the wood/felt table, free/blocked tiles, controls, text contrast, scrolling, and focus states; remove temporary screenshots afterward.
10. Run `git diff --check`, conflict-marker checks, a release-blocking correctness review, and `git status --short`. Resolve every P0/P1 and applicable P2 finding, rerun affected suites, and ensure only intended files remain.
11. Fetch `origin`, ensure `HEAD...origin/main` is `0 0`, commit in English, create an annotated release tag, and atomically push branch plus tag. Verify the remote branch and dereferenced tag point to the same commit.
12. Watch the exact GitHub Pages run to success. Confirm the deployment SHA and fetch the live launcher plus representative changed game/CSS routes with release-specific content markers, not only HTTP 200.

## Pitfalls
- Injecting a storage fixture while leaving the same game page triggers its `pagehide` save and can overwrite the fixture. Navigate to the launcher first or write from a separate same-origin document.
- A dataset-version bump without the old ordered dataset silently destroys deterministic saves even when all old entries still exist in the new superset.
- One event key per daily puzzle is not multi-tab safe when tabs can finish with different outcomes; first-writer-wins remains arrival-order dependent.
- A test that focuses a tile but dispatches `keydown` on `document` does not prove real keyboard shortcuts work from that tile.
- Headless media/input behavior can differ after canvas replacement. Rebind listeners to the replacement canvas and verify focus, visible cursor, placement, erasing, and CPU fallback together.
- A Mahjong single-tile removal order does not prove pairwise solvability; both slots in every planned pair must be simultaneously free.
- Headless Chrome may request `/favicon.ico`; serve 204 so a harmless 404 does not fail console-error checks.
- Do not commit subagent artifacts, screenshots, browser profiles, or scratch scripts.

## Verification
1. Every syntax check, all checked-in logic smoke tests, both browser suites, HTMLHint, embedded-script parsing, static-link checks, and local HTTP route checks pass.
2. Browser coverage reports all 16 games with zero runtime/console errors and no unsupported viewport overflow.
3. Historical Texttl schedules and Pandakreuzwort v1.5 saves are protected by full-pool digests and boundary/fixture tests.
4. Conflicting same-day Texttl loss/win results reduce to one deterministic result and preserve the winning daily save regardless of tab arrival order.
5. Pahjong completes a full 144-tile solution, terminal undo succeeds, compact undo memory stays bounded, and all three visual modes are legible on desktop/mobile.
6. `git status --short` is clean after commit and push; local `main`, remote `main`, and the dereferenced annotated tag resolve to the release commit.
7. The exact `Deploy GitHub Pages` run completes successfully for that SHA, and live pages expose the new version/content markers.