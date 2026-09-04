---
name: "autotuner-ocr-integration"
created: "2026-08-08"
description: "Maintain and validate AutoTuner's shared GUI/TUI document OCR workflow against llama.cpp MTMD. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when changing OCR model detection/profiles, document preprocessing, GUI/TUI OCR controls, llama.cpp multimodal requests, or OCR packaging/tests in Auto Tuner.

## Procedure
1. Keep document conversion and rendering in `ocr_workflow.py`; both `auto_tuner.py` and `qt_launcher.py` must call the same runner/options.
2. Distinguish Unlimited-OCR by checkpoint name. DeepSeek-OCR v1/v2 and Unlimited all report `deepseek2-ocr`, but v1/v2 use `Free OCR.` while Unlimited uses `document parsing.`.
3. For Unlimited-OCR, require b10287+ and inspect the mmproj for `clip.vision.preproc_max_tiles=32`; a newer server cannot repair stale projector metadata and otherwise falls back to 9 tiles.
4. Prepare Office inputs before loading llama-server. Convert via argument-vector headless LibreOffice with a short private temp profile, render PDFs with PyMuPDF, and normalize images with Pillow; never use PyQt6.QtPdf in this environment.
5. Send multimodal chat content in canonical OCR order: image first, then task text, through `/v1/chat/completions`. Verify the spawned process and expected `/v1/models` alias before document upload.
6. Hash sources before conversion, revalidate them before every page and finalization, write results atomically, and terminate the whole LibreOffice process tree/job-owned server on cancellation.
7. Bundle `ocr_workflow`, `pymupdf`, `PIL.Image`, and `PIL.ImageOps` in PyInstaller and keep Pillow/PyMuPDF in `requirements.txt`.
8. Run focused OCR/TUI tests first. Add changed-file lint/compile checks, a live OCR request, frozen-EXE smoke, or release matrix only when that corresponding surface changed.

## Pitfalls
- Do not use architecture alone to classify Unlimited-OCR; it would assign the wrong prompt/profile to DeepSeek-OCR v1/v2.
- Do not place LibreOffice's private profile deep inside the OCR output tree on Windows; internal paths can trigger soffice.com exit 0xC0000409.
- Do not put text before the image for Unlimited-OCR; canonical `<image>document parsing.` ordering materially improves output.
- Do not accept `/health` alone on a requested port; an unrelated local service could receive sensitive document bytes.
- Do not assume a b10287+ binary gives 32 tiles when the projector lacks the metadata key.
- Do not mutate or generate artifacts inside `L:/RAW_ARCHIVE`; use ignored `logs/` output folders.

## Verification
1. Run `python -m pytest test_ocr_workflow.py test_tui.py -q` for shared OCR behavior; narrower cases may run the directly affected test first.
2. Ruff/compile checks cover changed Python files.
3. Run one bounded live OCR request only for model/request/conversion changes; verify alias, nonempty output, atomic manifest, and port cleanup.
4. Run the frozen EXE/icon smoke only for packaging/resource changes.
5. Require the full cross-platform CI/release matrix only for an explicit release.
