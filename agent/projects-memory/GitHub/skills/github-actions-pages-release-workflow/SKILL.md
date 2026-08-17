---
name: github-actions-pages-release-workflow
description: "Add/fix GitHub Actions auto-release + Pages deploy in HTML game repos; diagnose deploy-pages failures without log access. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# GitHub Actions — Pages Deploy + Release Workflow

## Scope
Use when adding an automatic GitHub Release job (on push to main) to a repo that already has a Pages deploy, OR when diagnosing a failing actions/deploy-pages / release-creation step where you cannot read the step logs directly (no admin API token). Common in the DaWasteh HTML-game repos (GameOfLife, Pong, Snake Ultimate, Tetris, SandGame, SuperCalc).

## Workflow
1. Trigger architecture: `on: [push: main, pull_request, workflow_dispatch]`. Remove any `on: release: published`. Add a `release` job: `needs: build`, `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`, `permissions: contents: write`, `concurrency: group: release-${{ github.ref }}`.
2. Release job steps: checkout (fetch-depth: 0) -> download-artifact -> 'Create release archive': `cd release-artifacts && zip -r "$archive" .` then `echo "ARCHIVE=$archive" >> $GITHUB_ENV` (BARE filename, NOT '../$archive') -> 'Create GitHub Release' using `gh release create "$RELEASE_TAG" "$ARCHIVE" --repo ${{github.repository}} --target main --title ... --notes ...`. Use GH_TOKEN: ${{ github.token }}.
3. Tag format: `v${{ env.GAME_VERSION }}.${{ github.run_number }}` (e.g. v2.1.15). For repos without a GAME_VERSION env, use `v${{ github.run_number }}`.
4. Make the release idempotent: check `gh release view "$TAG"` first; if exists, use `gh release upload "$TAG" "$ARCHIVE" --clobber`, else `gh release create`. Avoids duplicate-tag failures on re-runs.
5. Pages job stays separate (`needs: build`, `if: ...main && push`); keep its own `concurrency: group: pages` to avoid deploy conflicts. SuperCalc-style repos (no build artifact): split monolithic deploy into `build` (generates + upload-artifact) -> parallel `deploy` (Pages) and `release` (zip the artifact).
6. Validate locally before push: `python -c "import yaml; yaml.safe_load(open(f))"` for every workflow (note: PyYAML parses top-level `on:` as boolean True — check `data[True]`). Run repo-specific smoke tests (e.g. Tetris `node smoke-test.cjs` asserts SHA-pinned actions + top-level `permissions: contents: read`).
7. To read a FAILED step's error WITHOUT admin API token: GET https://api.github.com/repos/{owner}/{repo}/check-runs/{job_id}/annotations — public-readable for public repos, surfaces `::error::`/`::warning::` workflow-command text. Get job_id from GET /actions/runs/{run_id}/jobs. This is how you read step output when logs return 403.

## Pitfalls
- ARCHIVE path bug: if archive step does `cd release-artifacts` and `zip -r '../$archive'` BUT sets `ARCHIVE=../$archive`, the next step (CWD=repo-root) resolves `../` ABOVE the repo -> `gh` fails with 'no matches found for ../X.zip'. FIX: `echo "ARCHIVE=$archive" >> $GITHUB_ENV`.
- Do NOT use `rerun-failed-jobs` API on a Pages pipeline whose `upload-pages-artifact` already succeeded: it re-runs upload again -> 2 same-named 'github-pages' artifacts -> deploy-pages aborts with 'Multiple artifacts named github-pages'. Use a fresh `workflow_dispatch` run instead (POST /actions/workflows/{wf_id}/dispatches {"ref":"main"}).
- 'Timeout reached, aborting!' from deploy-pages is often transient (concurrent deploys from rapid successive pushes); a fresh workflow_dispatch usually fixes it.
- Tetris smoke-test.cjs asserts NO unpinned `uses: ...@vN` (all must be SHA-pinned) AND top-level `permissions: contents: read`. Put release job's `contents: write` ONLY at job-level, never top-level, or smoke-test breaks.
- Local folder name may differ from GitHub repo name (e.g. 'Snake Ultimate' vs 'Snake-Ultimate'). Do NOT use remote-name as Python subprocess cwd -> NotADirectoryError.
- The git credential (gho_ token) works for REST API but `printf|git credential fill` in bash returns garbled token; use Python subprocess with text=True and a real repo dir as cwd.

## Verification
1. After push, poll GET /actions/runs?per_page=1 until status=completed. Check conclusion=success.
2. GET /releases confirms a release exists with the expected tag AND `assets` array non-empty (asset upload is the step most likely to silently fail).
3. GET /actions/runs/{id}/jobs: every job (lint, build, pages, release) conclusion=success.
4. HEAD the public Pages URL https://{owner}.github.io/{repo}/ -> HTTP 200 (independent of releases; confirms Pages still live).
5. Delete any orphaned tag/release created during debugging via DELETE /releases/{id} then DELETE /git/refs/tags/{tag}.
