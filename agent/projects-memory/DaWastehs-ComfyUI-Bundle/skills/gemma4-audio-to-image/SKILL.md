---
name: "gemma4-audio-to-image"
created: "2026-07-26"
description: "Gemma-4-Audio in diesem Repo zuverlässig in einen bereinigten FLUX.2-Bildprompt und ein Kontextbild umsetzen. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Bei neuen oder zu reparierenden Audio-to-Image-/Audio-Kontext-Workflows mit Gemma 4 TextGenerate und FLUX.2 in diesem Repository.

## Procedure
1. Den etablierten Gemma-4-Audiopfad `LoadAudio -> CLIPLoader(gemma4_e4b_it_fp8_scaled, stable_diffusion) -> TextGenerate` verwenden und einen englischen Einbild-Prompt anfordern.
2. Den `TextGenerate`-Output zuerst durch den Core-Node `RegexReplace` mit Muster `^.*?</think>\s*`, dotall=true und count=1 leiten; erst den bereinigten Text anzeigen und an `CLIPTextEncode` weitergeben.
3. Für FLUX.2 Klein 4B `flux-2-klein-4b`, `qwen_3_4b` mit Typ `flux2`, `flux2-vae`, 4 Schritte, CFG 1, Euler/Simple und `ConditioningZeroOut` verwenden.
4. `PixaromaResolution` an Breite/Höhe von `EmptyFlux2LatentImage` anschließen; `PixaromaPreview` im Save-Modus, `PixaromaNote` mit Bedienung/Downloads und genau einen Root-`PixaromaRunTimer` ergänzen.
5. README-Zählungen aktualisieren und den Workflow gegen den laufenden `object_info`-Endpoint sowie in einem echten 1024×1024-ComfyUI-Lauf prüfen.

## Pitfalls
- Gemma 4 kann trotz `thinking=false` einen internen Denktext bis `</think>` ausgeben; ohne Stripper gelangt dieser vollständig in die FLUX-Konditionierung.
- Bei ComfyUI-API-Prompts heißen dynamische TextGenerate-Parameter `sampling_mode.temperature`, `sampling_mode.top_k`, `sampling_mode.seed` usw.; flache Namen scheitern bei der Prompt-Validierung.
- `widgets_values`-Eintrag `"on"` gehört zum Sampling-Modus, nicht zum Thinking-Schalter; Thinking ist ein eigener boolescher Wert nahe dem Ende der Liste.
- PixaromaNote, PixaromaResolution und der RunTimer gehören in den Root-Graph; keine zusätzlichen Timer in Subgraphen setzen.

## Verification
1. JSON, IDs, Slots und bidirektionale Links sind konsistent; keine UI-Node-Überlappungen.
2. Live `object_info` enthält alle Node-Typen sowie ausgewählten Modelle und Medien.
3. Der bereinigte ShowText-Output enthält nur den finalen visuellen Prompt ohne Denktext.
4. Ein vollständiger ComfyUI-Lauf speichert ein visuell zum Audio passendes Bild über `PixaromaPreview`.
5. Repo-weit enthält jede Workflow-Datei genau einen Root-`PixaromaRunTimer`; `git diff --check` ist sauber.
