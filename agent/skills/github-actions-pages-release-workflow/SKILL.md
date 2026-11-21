---
name: "github-actions-pages-release-workflow"
description: "Add or fix GitHub Actions auto-release and Pages deploy in HTML game repos, or diagnose deploy-pages failures via annotations. Manual-only; do not use for unrelated CI or app edits."
version: 3
updated: "2026-11-21"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Load manually when adding an automatic GitHub Release job (on push to `main`) to a repo with a Pages deploy, or diagnosing a failing `actions/deploy-pages` / release step without log access (403). Explicit task requirements and repository evidence override this checklist.

## Procedure
1. Trigger on `push` (`main`), `pull_request`, and `workflow_dispatch`; remove any `on: release: published`. Add a `release` job with `needs: build`, `if: github.ref == 'refs/heads/main' && github.event_name == 'push'`, job-level `permissions: contents: write`, and `concurrency: group: release-${{ github.ref }}`.
2. In `release`: checkout (`fetch-depth: 0`), download artifact, zip inside `release-artifacts` (`cd release-artifacts && zip -r "$archive" .`), export bare `echo "ARCHIVE=$archive" >> $GITHUB_ENV` (never `../$archive`), and create/update the release via `gh release` using `GH_TOKEN: ${{ github.token }}`.
3. Tag format: `v${{ env.GAME_VERSION }}.${{ github.run_number }}` (or `v${{ github.run_number }}` when no `GAME_VERSION` exists).
4. Make releases idempotent: check `gh release view "$TAG"` first; if present run `gh release upload "$TAG" "$ARCHIVE" --clobber`, else `gh release create`.
5. Keep the Pages job separate (`needs: build`, `concurrency: group: pages`). For repos without a build artifact (SuperCalc-style), split into `build` -> parallel `deploy` and `release`.
6. Validate YAML locally with `python -c "import yaml; yaml.safe_load(open(f))"` (PyYAML parses `on:` as key `True`) and run any repo smoke test (e.g. Tetris `node smoke-test.cjs` checks SHA-pinned actions and top-level `permissions: contents: read`).
7. To read a failed step's error without log access, query `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs` and `GET /repos/{owner}/{repo}/check-runs/{job_id}/annotations`.

## Pitfalls
- Setting `ARCHIVE=../$archive` after `cd release-artifacts` makes the next step (repo root cwd) look above the repo and fail.
- Never use `rerun-failed-jobs` after `upload-pages-artifact` succeeded: it creates duplicate `github-pages` artifacts and breaks `deploy-pages`. Dispatch a fresh `workflow_dispatch` instead.
- Transient `deploy-pages` timeouts usually stem from rapid concurrent pushes; retry via `workflow_dispatch`.
- Putting `contents: write` at top-level breaks repos whose smoke tests assert top-level `permissions: contents: read`.
- Local folder names may differ from GitHub repo names (e.g. `Snake Ultimate` vs `Snake-Ultimate`); use the real local directory as cwd.

## Verification
1. Poll `GET /actions/runs?per_page=1` until `status=completed` and `conclusion=success`, and confirm every job succeeded.
2. Confirm `GET /releases` has the expected tag with non-empty `assets`.
3. `HEAD https://{owner}.github.io/{repo}/` returns HTTP 200.
4. Remove any temporary debugging tag/release via API if created.
