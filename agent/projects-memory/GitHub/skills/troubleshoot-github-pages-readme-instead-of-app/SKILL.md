---
name: troubleshoot-github-pages-readme-instead-of-app
description: "Diagnose and fix GitHub Pages showing README/Jekyll output instead of an HTML app. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# GitHub Pages — README Instead of App Troubleshooting

## Scope
Use when a GitHub Pages project URL renders the repository README or default Jekyll theme instead of the intended static app/game.

## Workflow
1. Check the repo for a Pages entrypoint: root index.html for branch-root publishing, docs/index.html for branch-docs publishing, or a workflow that uploads an artifact containing index.html.
2. Fetch the live Pages URL and inspect the title/content; GitHub/Jekyll README output usually has the repo name in the title and README headings, while the app has the app title and markup.
3. Inspect .github/workflows for actions/configure-pages, upload-pages-artifact, and deploy-pages. If present, confirm the workflow creates/copies the intended app as index.html in the uploaded artifact.
4. Explain the settings distinction: Settings → Pages → Build and deployment → Source = GitHub Actions for deploy-pages workflows; Source = Deploy from a branch requires index.html in the selected branch/folder.
5. For a robust code-side fix when branch source may remain enabled, add a small root index.html redirecting to the actual app file, or rename/copy the app to index.html if the URL must stay at the root path.
6. After edits, verify every redirect target exists and check git status per repo; tell the user to commit/push and wait for Pages cache/rebuild.

## Pitfalls
- A Pages workflow can exist but not affect the live site if the repo Pages source is still set to Deploy from a branch.
- push triggers that include both main and master may still have a pages job hardcoded to refs/heads/main; check branch conditions when deploying from Actions.
- README-only pushes may be ignored if workflow paths-ignore excludes Markdown, so use a real code/config change or manually rerun the workflow.
- GitHub Pages can cache for several minutes after a push.

## Verification
1. Live URL no longer has the README/Jekyll title and shows or redirects to the intended app.
2. The published source contains an index.html at its root.
3. Git status shows only intended files were changed.
