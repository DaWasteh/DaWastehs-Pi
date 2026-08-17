---
name: validate-flora-astro-content-migration
description: "Compare and migrate content from the legacy Flora Bellydance site into this Astro repo. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# Flora Bellydance — Astro Content Migration Validation

## Scope
Use when updating this repo from the legacy flora-bellydance.de content or checking whether the new Astro pages contain all old website information.

## Workflow
1. Fetch the legacy URL(s), especially `/bellydance-bauchtanz-muenchen/` and `/bellydance-bauchtanz-muenchen/bauchtanz`, and extract visible text, links, image/video counts, meta title/description, legal sections, reviews, FAQs, events, and contact data.
2. Compare the extracted content against `src/pages/index.astro`, `src/pages/shows/index.astro`, `src/pages/tanzkurse/index.astro`, `src/pages/ueber-flora/index.astro`, `src/pages/galerie/index.astro`, `src/pages/impressum/index.astro`, `src/pages/datenschutz/index.astro`, and navigation components.
3. Keep gallery/media as placeholders unless the user provides final Flora-approved files, but preserve reachable structure and accurate descriptions/count intent where needed.
4. For contact form changes, keep the optional `PUBLIC_WEB3FORMS_ACCESS_KEY` Web3Forms path and mailto fallback intact unless the user explicitly chooses another backend.
5. Use the repository's existing dependency state and run `npm run build`. If dependencies are missing, inspect the declared lockfile/package manager and obtain approval before installing. Keep generated/temp scrape/build artifacts out of the intended diff; do not delete user data or dependency trees as automatic cleanup.

## Pitfalls
- Do not invent legal facts. If hosting or form provider changes, update Datenschutz accordingly and flag that final legal review is still needed.
- Do not replace placeholder photos/videos unless Flora has approved the media selection.
- Do not leave placeholder secrets such as `DEIN-WEB3FORMS-KEY` in production code.

## Verification
1. `npm run build` completes successfully and includes all expected static routes.
2. `rg` finds no stale placeholders like `DEIN-WEB3FORMS-KEY`, `Cloudflare Pages`, or `Netlify` unless intentionally present.
3. `git status --short` shows only intentional source changes and no temp scrape/build artifacts.
