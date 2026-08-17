---
name: "build-llm-lyrics-music-workflows"
created: "2026-07-30"
description: "Qwen-/Gemma-Idee-zu-Lyrics-Workflows für ACE-Step und HeartMuLa in diesem Repo bauen, bereinigen und releasen. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when adding or changing ComfyUI workflows that turn a rough song idea into structured lyrics and feed them into ACE-Step 1.5 or HeartMuLa in this repository.

## Procedure
1. Start from the existing validated ACE-Step XL SFT or HeartMuLa workflow; preserve model, sampler/decoder, RDNA4, timer, and audio-save branches.
2. Build the text front end as PixaromaPrompt idea → StringConcatenate (fixed songwriter formula plus editable idea) → CLIPLoader → TextGenerate with 1536 output tokens.
3. Use Qwen 3.5 4B or Gemma 4 e4B via the native ComfyUI TextGenerate node. Route the generated STRING through Core RegexReplace, then PixaromaShowText, then directly into the music node's lyrics input. Keep music-style tags on a separate PixaromaPrompt.
4. For Qwen, strip only text before the first standalone bracket-label line. For Gemma, first greedily strip through the last `</think>` and otherwise use the same standalone-label fallback. Match arbitrary `[...]` lines rather than a narrow label allowlist.
5. Run `python tools/refine_workflows.py --workflows workflows` only after new graphs are unmarked; the tool now avoids rewriting semantically unchanged compact JSON. Update validator and README collection totals from actual output.
6. Run live Qwen and Gemma TextGenerate smokes only when `/queue` is empty. API child keys must be fully prefixed, e.g. `sampling_mode.temperature` and `sampling_mode.seed`.
7. Copy validated repo workflows to `L:/ComfyUI/ComfyUI/user/default/workflows/DaWasteh/Music Generation/` and compare SHA-256 hashes.
8. Before release, run all unit tests, Pixaroma integration check, workflow validator against HEAD, refinement check, `git diff --check`, and an independent read-only review.

## Pitfalls
- Gemma 4 may emit internal reasoning and a closing `</think>` even with `thinking=False`; sending raw output to the music model can vocalize the reasoning.
- Do not recognize only labels such as Verse/Chorus in cleanup regexes; this deletes legitimate openings like `[Instrumental Intro]` or `[Hook]`.
- The historical Pixaroma manifest covers the original 186-file migration, not later workflows authored with Pixaroma nodes already present.
- Do not broadly allow all historical skip-workflow deltas in `--against-head`; authorize exact node/widget indices for intentional fixes.
- Do not run GPU smokes while ComfyUI has running or pending jobs, and do not force-push when origin advanced; fetch/rebase and recreate an unpushed annotated tag instead.

## Verification
1. The four idea-to-lyrics workflows each contain exactly one timer, two PixaromaPrompt nodes, one RegexReplace, reciprocal STRING links, generated notes, and no overlaps.
2. Regex unit cases preserve `[Hook]` and `[Instrumental Intro]` while removing a Qwen preamble or Gemma reasoning through `</think>`.
3. Live Qwen and Gemma smokes produce clean structured lyrics beginning with a bracketed section and containing Verse, Chorus, and Bridge.
4. `python -m unittest discover -s tests -v` passes.
5. `python tools/validate_workflows.py --workflows workflows --against-head`, `python tools/integrate_pixaroma_prompts.py --check`, `python tools/refine_workflows.py --workflows workflows --check`, and `git diff --check` all pass.
6. Local `main`, `origin/main`, and annotated release tag resolve to the intended release commit, and the working tree is clean.
