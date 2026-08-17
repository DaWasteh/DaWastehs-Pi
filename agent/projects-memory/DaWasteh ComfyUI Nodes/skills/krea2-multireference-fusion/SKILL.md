---
name: "krea2-multireference-fusion"
created: "2026-07-24"
description: "Krea-2-Turbo-Workflows für kohärente Multi-Image-Fusion statt Mosaik in diesem Repo bauen und validieren. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Nutzen, wenn ein lokaler Krea-2-Turbo-Workflow mehrere Referenzbilder als Panels/Collage ausgibt, Referenzen ignoriert oder drei Motive in eine neue Szene integrieren soll.

## Procedure
1. Prüfe TextEncodeQwenImageEditPlus gegen die installierte Core-Version; lokal werden clip, prompt sowie optional vae und image1..image3 unterstützt.
2. Lade krea2_style_reference.safetensors mit LoraLoaderModelOnly bei Stärke 1.0 zwischen UNETLoader und Sampling.
3. Setze ModelSamplingFlux mit max_shift 1.15, base_shift 0.5 und denselben Zielmaßen wie das leere Latent.
4. Führe das Conditioning durch FluxKontextMultiReferenceLatentMethod mit index_timestep_zero; leite dessen Ausgang direkt positiv und über ConditioningZeroOut negativ weiter.
5. Verwende 8 Schritte, CFG 1, Euler, simple und denoise 1 für Krea-2 Turbo.
6. Ordne ein bereits szenisches Bild als image1/Kompositionsanker an; nutze image2 und image3 als klar beschriebene Identitätsreferenzen.
7. Beginne den Prompt mit der Rolle jedes Picture-Slots und verbiete ausdrücklich Collage, Mosaik, Split-Screen, Panels, Rahmen, Insets und sichtbare Quellen.
8. Validiere JSON-Links statisch, Node-Typen über /object_info und mindestens einen Full-Resolution-API-Render.

## Pitfalls
- Krea2 hat lokal default_ref_method=None; ohne Edit Model Reference Method werden VAE-Referenzlatents ignoriert.
- Die reine Krea-2-Turbo-Basis ist Text-to-Image; der Referenzpfad braucht die Style/Edit-LoRA.
- TextEncodeQwenImageEditPlus bietet keine per-reference Masken oder Stärken. Masken können nur zur Vorverarbeitung/Cropping dienen.
- Die Ostris-Style-LoRA ist primär für 1-2 Referenzen trainiert; drei Referenzen sind Best-Effort und saubere Einzelmotiv-Crops helfen.
- Wenn ein reines Personenporträt image1 ist, kann trotz Negativprompt ein großes Porträt/Panel dominieren. Das szenische Bild gehört an image1.
- AMD hipBLASLt kann Warnungen ausgeben und auf hipBLAS zurückfallen; erfolgreiche Completion ohne OOM ist dennoch gültig.

## Verification
1. Workflow-JSON lässt sich parsen, alle Link-IDs sind bidirektional konsistent und der Graph ist azyklisch.
2. Alle Node-Typen erscheinen im laufenden ComfyUI unter /object_info und alle vier Modeldateien existieren.
3. Ein API-Render bei Workflow-Zielauflösung endet mit status_str=success.
4. Das Testbild zeigt genau eine ununterbrochene Szene und keine Referenzkacheln oder separaten Panels.
