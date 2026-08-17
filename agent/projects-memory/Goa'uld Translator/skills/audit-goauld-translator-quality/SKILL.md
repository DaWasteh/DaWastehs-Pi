---
name: audit-goauld-translator-quality
description: "Audit dictionaries and translation quality in the Goa'uld Translator repo. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# Goa'uld Translator — Dictionary & Quality Audit

## Scope
Use when reviewing or debugging translation quality, dictionary conflicts, or lexicon behavior in this Goa'uld Translator repository.

## Workflow
1. Inspect dictionary/table counts with `wc -l` and a small Python parser over `Goauld-Dictionary.md`, `Goauld-Woerterbuch.md`, `Goauld-Fictionary.md`, and `Goauld-Neologikum.md`.
2. Load `goauld_lexicon.yaml` through `yaml_loader.load_lexicon_yaml()`; remember this merges `goauld_overrides.yaml` when present. Summarize flat entries, DE/EN primary maps, secondary maps, register/tier counts, and top gloss conflicts.
3. Treat `goauld_overrides.yaml` as the curated runtime/language-development overlay. For language expansion work, add reviewed entries there with DE+EN glosses, `review_status`, derivation/morphology, source tier, and examples; do not hard-code runtime vocabulary in `_GAP_FILL`.
4. Keep `GOAULD_GRAMMAR.md` as the grammar specification and `goauld_root_registry.yaml` as the stable root registry. Update both when new productive roots, grammar decisions, or Egyptian-substrate policy changes are introduced.
5. Import `goauld_translator`, call `_load_lexicon()`, instantiate `SearchEngine` and `SentenceAnalyzer`, then test representative sentences such as `Ich bin nicht Jaffa`, `You are a traitor`, `Ich liebe dich`, `human slave`, `wer/what/where`, and modal cases like `Ich muss hören`.
6. Check whether YAML mode bypasses `_load_mds()` and `_GAP_FILL`; if a lookup fix is needed, put it in `goauld_overrides.yaml` or the base YAML, not only in the MD fallback path.
7. For implemented translation-quality or language-expansion changes, update `tests/golden_translations.yaml` and run `python validate_translation_quality.py`, `python -m pytest -q tests`, `python -m ruff check .`, and `python -m mypy goauld_translator.py yaml_loader.py validate_translation_quality.py tests/test_translation_quality.py`.
8. If a `plans/*.md` implementation plan is completed and the user explicitly asked for deletion after implementation, delete that plan only after all validation commands pass.
## Pitfalls
- Do not judge translation quality only from interactive fuzzy search; sentence translation needs stricter exact phrase and grammar behavior.
- Do not add the full Ancient Egyptian dictionary as direct runtime vocabulary; use curated substrate roots with low priority instead.
- Do not store temporary audit progress in memory; only durable repo facts such as source-of-truth behavior should be saved.

## Verification
1. The audit reports dictionary counts, YAML counts, conflict categories, and concrete failing sentence examples.
2. Plans clearly distinguish search behavior from translation behavior and canonical terms from fanon/substrate terms.
3. Any proposed lexicon fix targets the runtime YAML path (`goauld_lexicon.yaml` or `goauld_overrides.yaml`), not only Markdown fallback behavior.
4. Translation-quality implementation is considered validated when `python validate_translation_quality.py`, `python -m pytest -q tests`, `python -m ruff check .`, and the project mypy command all pass.
