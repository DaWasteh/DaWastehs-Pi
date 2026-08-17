---
name: smoke-test-flora-ui-interactions
description: "Smoke-test interactive UI behavior in the flora-bellydance Astro site. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# Flora Bellydance — UI Interaction Smoke Test

## Scope
Use after changing client-side interactions in this Astro repo, especially dialogs, gallery lightboxes, outfit selectors, or contact form behavior.

## Workflow
1. Run `npm run build` first to catch Astro/Vite errors.
2. Start a local static server with `npm run preview -- --host 127.0.0.1 > /tmp/flora-preview.log 2>&1 & echo $!` and keep the printed PID.
3. Use Playwright from Node to visit `http://127.0.0.1:4321/`. Launch Chromium with `chromium.launch({ channel: 'chrome', headless: true })` because bundled Playwright browsers may be missing in this environment.
4. Assert key interactions with locators, e.g. open/close dialogs, arrow-key gallery navigation, manual outfit selection pauses autoplay, and contact hidden input values update.
5. Kill the preview process with `kill <PID>` after the smoke test.

## Pitfalls
- Default `chromium.launch()` can fail if Playwright's bundled Chromium is not installed; use the installed Chrome channel.
- Do not leave the preview server running in the background.
- For contact-form outfit tests, read the hidden `#outfit` input value after selecting options to verify submitted data.

## Verification
1. `npm run build` exits successfully.
2. The Playwright smoke script exits 0 and prints expected state values for the changed interactions.
3. The preview process is stopped afterwards.
