---
name: "validate-and-release-browser-games"
created: "2026-07-14"
description: "Validate and publish Browser-Games-Collection releases with static, logic, browser, and GitHub Pages checks. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 8
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use before committing, tagging, or pushing a Browser-Games-Collection release, especially after adding or changing games.

## Procedure
1. Confirm each root launcher card resolves to an existing HTML entry and every playable game page links back to `../index.html`.
2. Run JavaScript syntax validation across the repository and the checked-in smoke tests: `node tetris/smoke-test.cjs`, `node minenraeumkommando-foxtrott/smoke-test.cjs`, `node texttl/smoke-test.cjs`, `node maulkorbraupen-das-spiel/smoke-test.cjs`, and `node pandakreuzwort/smoke-test.cjs`.
3. With Node.js 22+ and local Chrome/Edge/Chromium, run `node browser-smoke-test.mjs`. It validates Panda Spider, PandaCell, Pandadoku, Pandakreuzwort, Pandataire, Panndike, and Texttl at 320/375/414 px in Panda hell/Nacht/Kontrast, including navigation, visual contrast, focus/modal behavior, style persistence, language switching, generator races, and restart behavior.
4. Run HTMLHint over the root launcher and all playable game HTML files with `npx --yes htmlhint@1.9.2 ...`.
5. For a full release, serve the repository locally and use headless Chrome/CDP to load the root plus all 16 games; fail on runtime exceptions or console errors and assert each game's boot/state invariants. For Maulkorbraupen, complete the full adventure and fetch every WebP/MP3 asset.
6. Run focused generated-state checks: Sudoku uniqueness across all difficulties, Pahjong pair-plan validation over many rounds, Pandataire 52-card uniqueness, deterministic PandaCell deal replay, and Pandakreuzwort validity/variance for both languages and all difficulties.
7. Run `git diff --check`, remove `.pi-subagents/` artifacts or scratch files, and verify `git status --short` contains only intended source changes.
8. Commit in English, create an annotated release tag, push the branch and tag, verify remote refs, watch the GitHub Pages workflow to success, and confirm the live root/game URLs return HTTP 200.
## Pitfalls
- The Tetris smoke test must resolve paths from `__dirname`; running subtree-era tests from the repository root otherwise fails.
- Do not commit `.pi-subagents/` run artifacts or temporary `_scratch.js` files.
- A Mahjong single-tile removal order does not prove pairwise solvability; both slots in every planned pair must be simultaneously free.
- Headless Chrome may request `/favicon.ico`; serve a 204 response so that a harmless 404 does not fail console-error checks.

## Verification
1. All five checked-in logic smoke tests print `smoke ok`.
2. `node browser-smoke-test.mjs` prints `browser smoke ok` for all seven targeted games, three mobile widths, and three styles.
3. HTMLHint reports no errors for all playable HTML files.
4. Full-release headless browser smoke reports all 17 pages passed (launcher plus 16 games), and the Maulkorbraupen full playthrough reaches the epilogue with 100% progress.
5. Pandakreuzwort seed farms produce only validator-approved connected grids and demonstrate high layout/entry variance in both Deutsch and Bairisch.
6. `git status --short` is clean after commit and push.
7. Remote `main` and the dereferenced release tag resolve to the same commit.
8. The `Deploy GitHub Pages` run completes successfully for that commit.
9. The live collection, new game route, and a representative narration MP3 return HTTP 200.
