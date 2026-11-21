---
name: "troubleshoot-github-pages-readme-instead-of-app"
description: "Diagnose and fix GitHub Pages rendering README/Jekyll instead of a static HTML app. Do not use for unrelated web or CI work."
version: 3
updated: "2026-11-21"
skill-governor-tier: auto
skill-governor-risk: low
---
## When to Use
Use when a GitHub Pages project URL renders the repository README or default Jekyll theme instead of the intended static app/game. Explicit task requirements and repository evidence override this checklist.

## Procedure
1. Check the repo's Pages entrypoint: root `index.html` (branch root), `docs/index.html` (branch docs), or a workflow artifact containing `index.html`.
2. Fetch the live Pages URL and inspect the `<title>` and body; Jekyll/README output shows the repo name and README headings rather than the app markup.
3. Inspect `.github/workflows` for `actions/configure-pages`, `upload-pages-artifact`, and `deploy-pages`; confirm the uploaded artifact contains `index.html` at its root.
4. Clarify GitHub Pages source settings: `Source = GitHub Actions` is required for `deploy-pages` workflows; `Source = Deploy from a branch` requires `index.html` in the configured branch/folder.
5. If branch publishing may remain enabled, add a small root `index.html` redirecting to the actual app file, or place the app at `index.html` if it must stay at root.
6. Verify every redirect target exists, inspect `git status`, and inform the user when changes are ready to publish (wait a few minutes for Pages cache refresh).

## Pitfalls
- A Pages workflow has no live effect while repository Pages source is still set to `Deploy from a branch`.
- Triggers covering both `main` and `master` may still have a job condition hardcoded to `refs/heads/main`.
- Markdown-only commits may be skipped by `paths-ignore`; trigger a real code/config edit or manual `workflow_dispatch`.
- GitHub Pages CDN caches responses for several minutes after updates.

## Verification
1. Published source contains `index.html` at its root and every redirect target exists.
2. Live URL shows or redirects to the intended app rather than the README/Jekyll title.
3. `git status` shows only intended files changed.
