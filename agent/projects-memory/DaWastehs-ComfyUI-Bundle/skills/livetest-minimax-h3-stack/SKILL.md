---
name: "livetest-minimax-h3-stack"
created: "2026-08-08"
description: "Alle neun MiniMax-H3-Workflows inklusive Complete-Song, Identity-Lock, Originalaudio und Repo↔ComfyUI-Synchronität real validieren. Manual-only; do not use for unrelated work."
version: 3
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Für vollständige Regressionen der neun `workflows/Reference to Video/MiniMax_H3_*.json`, der DaWasteh-H3-AutoLength-/MusicVideo-Nodes oder nach Änderungen an Spectrum/native H3. Insbesondere bei echter R9700-Inferenz, Complete-Song-Segmentketten, Sängerinnen-Identity-Lock, erzwungenem Frame 1 oder Original-Audio-Stream-Copy.

## Procedure
1. Vor Start Repo `L:/GitHub/DaWastehs-ComfyUI-Bundle` und Runtime `L:/ComfyUI/ComfyUI` vergleichen; betroffene H3-Workflows und DaWasteh-H3-Pakete gezielt synchronisieren und SHA-256 prüfen. Fremde ComfyUI-Core-Änderungen nicht berühren.
2. ComfyUI über `L:/ComfyUI/start-R9700.ps1` auf Port 8188 starten, `/queue` auf 0/0 prüfen und native, Spectrum-, AutoLength- und MusicVideo-Klassen über `/object_info/<Node>` verifizieren.
3. Für kurze Einzeltests 864×480, 24 FPS und gültige H3-Rasterlängen verwenden. Pro Workflow echte Inferenz statt Cache bestätigen und Ausgaben mit PyAV auf Frames, Dauer, Auflösung und Audiostream prüfen.
4. Für die allgemeine Complete-Song-Regression `Intro-Song.mp3` plus `Intro-Song.md` seriell mit `max_scene_seconds <= 15`, `system_ram` und eindeutiger Projekt-ID ausführen.
5. Für Identity-Lock `Outro-Song.mp3`, `Outro-Song.md` und `liveavatar-img-00031.png` mit 480×864, 20 Steps, festem Seed, `identity lock (recommended)` und `force_reference_as_first_frame=true` verwenden. Das Originalbild muss in jeder Szene die einzige Bildreferenz bleiben.
6. Manifest bis zu vollständigen Segmenten und Finalizer überwachen. Kontaktbögen mit Start/Mitte/Ende jeder Szene erzeugen und Sängerin, Gesicht, Haare, Shirt, Location, Stil, Personenanzahl, Arme und Hände manuell prüfen.
7. Quelle, Projekt-`joined_video.<container>` und Finaldatei paketweise vergleichen: SHA-256 über verkettete demuxte Payloads, Paketanzahl und Payload-Bytes müssen übereinstimmen. Projekt-Joined und Finaldatei müssen byte-identisch sein; `joined_video_silent.mp4` darf keinen Audiostream besitzen.
8. Frame 1 gegen `first_frame_reference.png` prüfen; wegen H.264 nicht Bytegleichheit verlangen, sondern erzwungenes Manifest-Flag plus hohe dekodierte PSNR/geringe MAE.
9. Nach Fixes Repo→Runtime erneut synchronisieren, Server neu starten und einen Resume-Smoke-Test durchführen. Spectrum-Tests, vollständige Repo-Unittests, Pixaroma-Check, `validate_workflows.py --against-head`, Diff-Check, Queue 0/0 und finale Hashmatrix sichern.
10. Erst nach unabhängiger Diff-Prüfung committen, annotierten Versionstag setzen, `main` und Tag zum kanonischen Origin pushen und `origin/main` sowie den dereferenzierten Tag-Commit verifizieren.

## Pitfalls
- `joined_video.mp4` war früher absichtlich tonlos und irreführend benannt. Nur `joined_video_silent.mp4` ist ein stummer Zwischenstand; das öffentliche Projekt-Deliverable heißt `joined_video.<container>` und enthält Originalaudio.
- `-shortest` beim Complete-Song-Finalmux kann den letzten MP3-Paketpayload abschneiden; normales Originalaudio ohne `-shortest` muxen.
- Basisbild plus rekursiv gedriftetes Endbild als zwei H3-Referenzen kann zweite Personen, Identitätsmischung und kumulative Drift erzeugen. Identity-Lock nutzt bei vorhandenem Basisbild ausschließlich dieses Original.
- Ein Referenzbild allein garantiert keine perfekte Anatomie. High-impact-Choreografie, extreme Handbewegungen, Standort- und Lichtstilwechsel vermeiden; problematische Szenen bei Bedarf gezielt neu rendern.
- ComfyUI fügt nach Integer-Seed-Widgets ein control-after-generate-Widget ein. Der gespeicherte Kontrollwert muss direkt nach dem Seed stehen.
- Neue Director-Widgets niemals mitten in die list-style Widgetfolge einfügen. Sie müssen hinter allen v0.8.3-Werten angehängt werden, sonst werden bestehende Workflows positionsverschoben geladen.
- H.264 ist verlustbehaftet. Erzwungenes Frame 1 per Pre-Encode-Substitution und PSNR/MAE prüfen, nicht per dekodiertem Pixel-Hash.
- History-Erfolg allein reicht nicht: Ausgabedatei, uncached Sampler, Frames, Dauer, Audio-Payloads, Kontaktbögen und Queue-Zustand prüfen.

## Verification
1. Alle betroffenen Workflow-Histories sind `success/completed`; kurze Inferenzpfade sind nicht vollständig aus dem Cache gekommen.
2. Complete-Song-Manifest enthält mehrere erfolgreiche Segmente mit höchstens 15 Sekunden und verifizierten Ziel-Frames.
3. Identity-Lock-Childprompts enthalten pro Szene genau das Original-`ref_image_0`, niemals zusätzlich den vorherigen Endframe; fixer Seed und einheitliche Visual-Bible-Prompts sind im Manifest sichtbar.
4. Finales Identity-Lock-Video hat 480×864, 24 FPS, exakt die Summe der Ziel-Frames; Frame 1 entspricht der kanonischen Referenz mit plausibel hoher PSNR.
5. Quelle, Projekt-Joined und Finaldatei haben identischen Audio-Payload-Hash, Paketanzahl und Payload-Bytes; Projekt-Joined und Finaldatei sind byte-identisch.
6. Kontaktbögen zeigen dieselbe erwachsene Sängerin, Kleidung und Bildsprache ohne sichtbare zweite Person oder zusätzliche Arme.
7. Spectrum-H3-Tests, Repo-Unittests, Pixaroma-Check, Workflow-Validator und `git diff --check` sind grün.
8. Repo und Runtime sind für alle ausgelieferten Custom-Node-/Workflow-Dateien SHA-256-identisch, `/queue` ist 0/0, `origin/main` und der dereferenzierte Release-Tag zeigen auf den lokalen Release-Commit.
