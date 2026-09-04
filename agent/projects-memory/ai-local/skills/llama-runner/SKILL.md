---
name: llama-runner
description: "Working on llama_runner.py, the unified self-healing launcher for llama-server (OOM recovery, repetition detection, benchmark mode). Use for ANY change to model presets, start scripts, escalation logic, benchmark grids, or when a local model crashes/loops/OOMs. Project-local skill for C:\\LAB\\ai-local. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

# llama_runner.py — Self-Healing llama-server Launcher

## Location & usage
- File: `L:\LAB\ai-local\llama_runner.py` (~900 lines). Deps: `pip install psutil requests`.
- `python llama_runner.py run [--preset <name>]` — self-healing run (default preset: mistral-medium-128b)
- `python llama_runner.py benchmark --preset <name>` — config matrix (6 configs × 4 prompts: chat/code/reasoning/long-context); realistic duration for 128B: 45–60 min (load time dominates). Output: JSON + Markdown table.
- Server port: 1234 — must be free; legacy scripts `start_llama.py` / `start_llamaMM.py` remain untouched.

## Architecture invariants (do not "improve" these away)
1. **OOM detection**: reader thread + 11 regex patterns (Vulkan/HIP/ROCm/CUDA) in real time, plus exit-code monitoring. No polling.
2. **12-step escalation** alternates across axes: ubatch → ctx → KV precision → ngl → cache_ram. Never exhaust one axis first.
3. **KV cache quant cannot change live** — repetition collapse sets a `needs_kv_upgrade` flag; the NEXT restart raises KV precision.
4. **Repetition detection**: 5-gram sliding window, score 0–1; >= 0.6 → raise `repeat_penalty`/`min_p` live via API; 3 loops in a row → recommend KV restart. Coherence score = unique/total tokens. No fake "hallucination detection".
5. **Shutdown**: `CTRL_BREAK_EVENT`, single Ctrl+C.
6. **No rocm-smi on Windows** — conservative presets instead of fake VRAM autodetection.

## Presets
- `mistral-medium-128b`: 49 GB GGUF on 48 GB RAM → `mlock=False` MANDATORY, `cache_ram_mb=20000`, conservative ctx. First load takes 2–4 min (health timeout 5 min).
- `devstral-24b`: pipeline smoke-test preset — always verify changes with this before touching 128B runs.
- `--cache-ram` requires a recent build; if "unknown argument", set `cache_ram_mb=None` in the preset.

## Model store layout (planned auto-discovery)
- Models in `I:\models\<Family>\...` subfolders (Mistral, Gemma, Qwen, 1Bit-Bonsai, Frankenmerger, ...). Keep subfolders.
- Two builds: `L:\LAB\ai-local\llama.cpp` (standard) and `L:\LAB\ai-local\1bllama.cpp` (Bonsai/1-bit). Folder name is the build-selection signal.
- Open design goals: fuzzy mmproj matching (quant suffixes differ between model and mmproj), family-based default sampling params, size heuristics, `--model <path>` for arbitrary GGUFs so most models need no explicit preset.

## Verification
1. For parser/preset changes, run focused unit/config tests without starting a large model.
2. For process/OOM/repetition changes, use the `devstral-24b` smoke preset first and verify shutdown plus port cleanup.
3. Run the multi-configuration benchmark only when tuning/benchmark behavior is the explicit task; do not load the 128B model for an unrelated launcher edit.
