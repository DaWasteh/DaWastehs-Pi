---
name: "build-live-avatar-comfy-workflows-rdna4"
created: "2026-08-01"
description: "Live-Avatar-Workflows mit Queue- oder Continuous-LivePortrait, Webcam, Alpha und Spout auf der Windows-RDNA4-ComfyUI-Instanz bauen und validieren. Manual-only; do not use for unrelated work."
version: 6
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding, repairing, optimizing, releasing, or retesting webcam-driven LivePortrait/OBS workflows for the R9700 ComfyUI server on port 8188 in this repository, including the queue fallback and the continuous latest-frame path.

## Procedure
1. Check `http://127.0.0.1:8188/queue` is empty and query `/object_info` before installing, patching, restarting, or authoring nodes.
2. Use `ComfyUI-LivePortraitKJ` with `blazeface_back_camera`, landmark device `torch_gpu`, face detector device `cpu`, detector dtype `fp32`, LivePortrait `fp16`, and the verified TorchScript landmark patch. Never install upstream requirements wholesale into the Python 3.13 ROCm environment.
3. For fallback workflow 03, keep `WebcamCaptureCV2.release=false`, apply `tools/patches/ComfyUI-KJNodes-WebcamCaptureCV2-Windows-Backend.patch`, and use the current frontend mode `Run (Instant)` after one successful manual run.
4. For continuous workflow 05, install `custom_nodes/ComfyUI-DaWasteh-LiveAvatar`, use one normal Run with `max_frames=0`, and stop with ComfyUI Interrupt. Never use Run (Instant) for the blocking continuous node.
5. Keep all Torch/ROCm inference and compositing in ComfyUI's execution thread. Only webcam capture and Spout transmission may use helper threads; each helper owns and releases its native resource in the same thread and exchanges only the newest frame through overwrite-only slots.
6. Capture the Facecam Pro at requested 960x540, center-crop to a square, resize to 256x256 before GPU inference, mirror by default, and start with `delta_multiplier=0.75` plus stitching enabled to reduce extreme face distortion.
7. For the continuous composite, cache source RGB, transformed face mask, static background contribution, and original alpha once. Preserve LoadImage semantics with `alpha = 1 - MASK`; never call `soft_empty_cache()` or `gc.collect()` per frame and do not add PreviewImage to the live execution path.
8. Use `cam_index=1` for the Elgato Facecam Pro and `cam_index=2` for the Logitech BRIO on the current USB order, while documenting that reconnects may reorder them. Ensure OBS is not holding the Facecam exclusively; enable Deactivate when not showing on unrelated OBS camera sources.
9. Install OBS Spout2 under `C:/ProgramData/obs-studio/plugins/win-spout/`. Select `ComfyLiveAvatar` for workflow 03 or `ComfyLiveAvatarFast` for workflow 05, use Composite Mode `Default`, and keep OBS and Spout on the compatible physical GPU.
10. Probe SpoutGL with the upstream receive order: call `receiveImage(None, GL_RGBA, ...)`, wait for `isUpdated()`, then allocate a writable buffer from `getSenderWidth()*getSenderHeight()*4` and process subsequent receives. Treat `SenderInfo` as an object with `.width` and `.height`, not a tuple.
11. Refine new workflows, update collection totals, run the complete tests and against-HEAD validator, sync workflow/custom-node files into the live install, restart ComfyUI, and use bounded `max_frames` smokes before an unbounded run.
12. For releases, verify no concurrent session is writing, inspect the complete diff, use an extensive version commit, create an annotated tag, and atomically push branch plus tag.

## Pitfalls
- PyTorch 2.6+ refuses the upstream pickled `torch.fx` landmark model in weights-only mode; never set `weights_only=False` before verifying the exact source hash.
- Installing `onnx2torch` or entire upstream requirements in production can change protobuf/NumPy and break unrelated audio nodes.
- A normal ComfyUI graph is serial. Spout's FPS repeats the latest image and does not create fresh inference frames; workflow 03 measured only about 1.29 fresh FPS.
- Do not run multiple GPU inference workers against the mutable LivePortrait pipeline. Overlap capture and Spout only; parallel GPU jobs can increase latency, VRAM use, and artifacts.
- The continuous node intentionally blocks other ComfyUI jobs until Interrupt. Always validate that Interrupt empties the queue without stopping the server and that camera/Spout resources are released.
- SpoutGL sender and receiver objects are native/OpenGL resources. Keep creation, use, and release thread-affine and do not rely on daemon destruction for cleanup.
- A preallocated receiver buffer can remain black until Spout reports `isUpdated()`. Allocate after the format/size update, then read the next frame.
- `getSenderInfo()` returns a `SenderInfo` object on installed SpoutGL 0.1.1; indexing it causes `TypeError`.
- LivePortrait remains face/head-only. A flat PNG cannot provide credible hidden arms, hands, or finger articulation; use the separate VRM/MediaPipe tracking path for full-body work.
- A listed sender is not proof of a usable shared texture. `gs_texture_open_shared ... 80070057` indicates an OBS/sender GPU mismatch.
- OBS 32 does not discover the old `%APPDATA%/obs-studio/plugins/win-spout/` location on this installation.
- Do not stage unrelated concurrent-session files. Coordinate with intercom before release work.

## Verification
1. `python -m unittest discover -s tests -v` passes; v0.7.1 has 53 tests.
2. Run `L:/ComfyUI/.venv/Scripts/python.exe tests/test_live_avatar_continuous.py -v`; all 13 production-Torch tests pass, including BCHW composite and partial-start cleanup.
3. `python tools/integrate_pixaroma_prompts.py --check` reports pending 0 and changed 0.
4. `python tools/refine_workflows.py --workflows "workflows/Live Avatar" --check` reports changed 0.
5. `python tools/validate_workflows.py --workflows workflows --against-head` reports zero errors and current totals.
6. A bounded 100-frame continuous smoke completes successfully after warm-up at approximately 0.127–0.136 seconds per fresh frame (7.3–7.9 FPS) on the R9700.
7. An upstream-pattern SpoutGL receiver obtains non-empty changing 1024x1024 RGBA frames from `ComfyLiveAvatarFast` with byte/alpha extrema `(0,255)`.
8. Start workflow 05 unbounded, POST `/interrupt`, then verify `/system_stats` still responds, `/queue` is empty, and history records `execution_interrupted` for the continuous node.
9. OBS receives the selected sender with `rendering context->texture` and no following shared-texture error.
10. Repository and live custom-node files hash-match except intentional user workflow selections, and git status is clean after release.
