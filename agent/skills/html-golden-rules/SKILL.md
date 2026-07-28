---
name: html-golden-rules
description: "Modern semantic and accessible HTML rules. Use whenever writing or reviewing markup, templates, forms, dialogs, navigation, static HTML apps, or accessibility fixes."
---

# HTML Golden Rules

## Skeleton
`<!doctype html>`, `<html lang="…">`, `<meta charset="utf-8">`, viewport meta, real `<title>`, content in `<main>`.

## Semantics & native APIs
- Elements by meaning: `header/main/footer/nav/article/section/aside`. Buttons for actions, anchors for navigation — no clickable `div`/`span`. Logical heading levels.
- Prefer native `button`, `label`, `select`, `textarea`, `details/summary`, `dialog`, `popover` before custom ARIA widgets. Every form control gets an explicit label (`for`/`id`). ARIA supplements native HTML, never replaces it.

## Images & performance
- Always set width/height (prevents layout shift); `loading="lazy" decoding="async"` below the fold; `fetchpriority="high"`/`preload` only for critical assets; AVIF via `<picture><source type="image/avif">`.

## Security
- External new-tab links need `rel="noopener noreferrer"`; never inject untrusted strings through `innerHTML` unsanitized.

## Pitfalls
Div soup instead of landmarks; `tabindex > 0`; form fields without labels; custom controls without keyboard support; redundant alt text ("image of…").

## Verification
W3C validator clean; Lighthouse accessibility 100; keyboard-only test reaches every control with visible focus.
