---
name: "html-golden-rules"
description: "Apply semantic, accessible, secure HTML to markup, forms, dialogs, navigation, and static apps. Use for HTML/template work; do not load for CSS-only, backend-only, Canvas/WebGL internals, or unrelated source files."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: low
---
## When to Use
Use when creating or reviewing HTML/templates or fixing accessibility semantics. Explicit task markup, framework conventions, and existing tests override examples here.

## Procedure
1. Keep the document skeleton appropriate to the artifact: doctype, language, charset, viewport, title, and a meaningful main landmark for full pages.
2. Choose native elements by meaning. Buttons perform actions, anchors navigate, labels bind controls, and heading levels remain logical.
3. Prefer native controls (`button`, `dialog`, `details`, `select`, `textarea`, popover) before custom ARIA widgets. ARIA supplements rather than replaces correct HTML.
4. Give meaningful images dimensions and alt behavior; lazy-load only non-critical media. Add preload/fetch priority only when measured/required.
5. Keep untrusted strings out of unsanitized `innerHTML`; use `noopener noreferrer` for appropriate external new-tab links.
6. Preserve framework-generated markup and repository style when it already meets the requirement; do not rewrite unrelated structure.

## Pitfalls
- Clickable `div`/`span`, missing labels, `tabindex > 0`, and custom widgets without keyboard behavior.
- Redundant alt text such as “image of”.
- Applying page-level skeleton requirements to partial components/fragments.
- Treating a Lighthouse score as proof of all accessibility behavior.

## Verification
1. For a local markup change, run the repository's targeted parser/lint/test if one exists.
2. Keyboard-test only the controls or flow changed; include visible focus and expected dialog/form behavior.
3. Run broader HTML validation or Lighthouse only for page-wide/accessibility/release work. A perfect score is not a mandatory gate for unrelated edits.
