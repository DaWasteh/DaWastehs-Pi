---
name: "build-full-character-live-avatar-rdna4"
created: "2026-08-01"
description: "Build and validate the v0.7.2 VRM Live, buffered AI Mirror, and DirectML RVC companion paths in this repo. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding, repairing, installing, benchmarking, or releasing the full-character Live Avatar 06/07 paths or their external live microphone RVC companion on the dual-RDNA4 Windows system.

## Procedure
1. Keep three paths distinct: Workflow 06 browser VRM is the true live full-character path; Workflow 07 is a buffered diffusion AI Mirror; Workflows 03/05 remain face-only LivePortrait.
2. For VRM, build the local frontend under `custom_nodes/ComfyUI-DaWasteh-LiveAvatar/frontend`, ship all MediaPipe assets locally, load `mediapipe/holistic.js` as a classic script and use `globalThis.Holistic`, and use DirectionalLight only with three-vrm 0.6.10/Three r137.
3. Install VRM presets with `python tools/install_live_avatar_vrm_models.py --comfy-root L:/ComfyUI/ComfyUI`. Verify source and installed hashes. Lady Koi requires pinned GLB chunk normalization; Panda Bear is the deterministic CC0 Teddy texture derivative.
4. Serve VRM files only from `folder_paths.models_dir/live-avatar-vrm`, enforce loopback routes, fit the camera from each loaded model's bounding box, await tracker shutdown, serialize camera restarts, and provide presentation mode before OBS capture.
5. Install AI assets only after stopping Run (Instant) and confirming empty queues. Use `tools/install_live_avatar_ai_assets.py`; restart the target server and recheck exact model combo names in `/object_info`.
6. Run Workflow 07 on 8188/R9700 for the best measured throughput. Keep OpenPose body/hands/face, SD1.5 LCM 4-step img2img, explicit IPAdapter Plus/CLIP Vision, and fixed seed for temporal consistency. Call it Buffered AI Mirror because warm throughput is only about 0.36–0.50 FPS; 8189 is around 0.125 FPS.
7. For Spout validation, start the receiver before the prompt. Call `receiveImage` once even with an empty buffer, then wait for `isUpdated()`, read width/height, allocate RGBA storage, and receive the next frame. Verify non-empty pixels and alpha, not merely sender discovery.
8. Install the pinned b2332 DirectML voice backend with `tools/install_live_voice_converter.py` and start/stop with the identity-checking PowerShell scripts. The app performs additional first-run weight downloads outside the pinned ZIP tree.
9. Use only owned/licensed RVC voices. For b2332 compatibility, import a trusted PTH/safetensors model and use the app's own ONNX exporter when arbitrary legacy ONNX files reject the required `skip_head` input. On this system DirectML device 0 is RX 9070 XT and device 1 is R9700.
10. Start voice conversion with RX 9070 XT DirectML and `rmvpe_onnx`; warm 100-ms chunks measured roughly 36–41 ms compute. Keep heavy 8189 jobs stopped while using this profile and route converted audio through a separately installed virtual cable into OBS.
11. Generate both Workflows 06/07 only with `tools/generate_live_avatar_v072_workflows.py`, which uses checked templates and pinned object-info rather than live server schemas. Refine and validate the complete collection afterward.
12. Before release, sync the node/workflows to the live install, restart both servers, verify launcher/routes/model combos, run browser/WebGL/camera smokes, run AI API/Spout measurements, run voice conversion tests, then complete any remaining visible OBS/manual audio gates.

## Pitfalls
- Do not add HemisphereLight to the pinned MToon stack; it compiles to a broken fragment shader and renders a blank canvas.
- Do not use a named ESM import for the legacy MediaPipe Holistic package; it can build successfully yet fail as a constructor at runtime.
- Do not call Workflow 07 live or realtime. Full graph warm latency is multiple seconds per frame even on the R9700.
- Two ComfyUI processes cannot reliably own the same OpenCV camera with `release=false`; stop/release one path before testing the other.
- Spout sender presence with width zero is not proof of a frame. Perform the empty-buffer receive handshake and validate pixels.
- Older upstream `*_simple.onnx` RVC test exports are incompatible with b2332's expected inputs; use the app exporter or a known-compatible model.
- The RVC ZIP pin does not pin first-run upstream weights or user models. Keep those trust boundaries explicit.
- Do not commit downloaded VRM/RVC/AI model binaries or `tmp/`; only manifests, deterministic small derivative assets, frontend runtime, tools, workflows, tests and notices belong in Git.

## Verification
1. `npm test --prefix custom_nodes/ComfyUI-DaWasteh-LiveAvatar/frontend` passes and two consecutive builds have identical tree hashes.
2. `python -m unittest discover -s tests` and the Comfy venv `test_live_avatar*.py` discovery pass.
3. `python tools/generate_live_avatar_v072_workflows.py` reports both files and a second run is byte-identical.
4. `python tools/refine_workflows.py --workflows workflows --check`, `python tools/integrate_pixaroma_prompts.py --check`, and `python tools/validate_workflows.py --workflows workflows --against-head` pass.
5. Both 8188/8189 expose `DaWastehVRMLiveAvatarLauncher`; VRM routes and all four served model hashes match; browser smoke loads WebGL, starts camera tracking, hides controls, and renders non-background full-body pixels.
6. Workflow 07 completes through Spout; a separate receiver gets non-empty 512x512 RGBA with alpha 255. Record warm latency and retain Buffered AI Mirror wording.
7. The voice backend tree verifies 3400 files / 806658313 bytes / tree SHA-256 `ddd816e...`; a licensed test model converts non-empty audio on DirectML and the app-exported ONNX also runs.
8. Both ComfyUI servers are responsive with empty queues after testing, test-only RVC models are removed, and the voice converter is stopped unless the user needs it running.
9. Before commit, stage only intended release files, inspect cached diff and `git diff --cached --check`, then use an extensive annotated v0.7.2 commit/tag only if remaining manual release gates are accepted.
