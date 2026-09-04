---
name: "optimize-liveavatar-openpose-latency"
created: "2026-08-02"
description: "Profile and reduce LiveAvatar AI Mirror latency by caching OpenPose and tuning its critical path. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when LiveAvatar-07/11 takes roughly 2 seconds per webcam frame despite a fast 4-step sampler and available R9700 VRAM.

## Procedure
1. Separate sampler time from total prompt time. If four LCM steps take about 0.4 seconds but the prompt takes about 2 seconds, inspect preprocessors rather than adding concurrent diffusion jobs.
2. Watch for `body_pose_model.pth`, `hand_pose_model.pth`, and `facenet.pth` paths printed on every prompt. In comfyui_controlnet_aux this means `OpenposeDetector.from_pretrained()` is rebuilding three models per frame.
3. Benchmark pose configurations independently with one resident model. On the R9700, 512 body+hands+face is about 0.91s hot plus about 0.57s reload; 384 body+face is about 0.21s; hand detection contributes roughly 0.54s.
4. Use `DaWastehCachedOpenPose` from ComfyUI-DaWasteh-LiveAvatar. ComfyUI's classic object cache reuses the node instance by workflow node ID, so the detector remains resident across Run-(Instant) prompts.
5. Create a separate numbered optimized workflow instead of overwriting the baseline. Workflow 11 uses 384² BRIO input, DirectShow index 2, body+face enabled, hands disabled, and retains four LCM steps plus the established ControlNet/IPAdapter strengths.
6. Restart ComfyUI after changing custom-node Python, confirm the node through `/object_info/DaWastehCachedOpenPose`, then benchmark one cold and at least eight sequential hot API prompts.
7. Sync installed node code and workflows into `L:/GitHub/DaWastehs-ComfyUI-Bundle`; update templates, generator, pinned object-info, validation totals, tests, and documentation before committing/pushing.

## Pitfalls
- Do not parallelize two diffusion prompts on the same GPU first; they contend for compute/bandwidth, increase stale-frame backlog, and do not remove serial model reloads.
- Do not interpret free VRAM alone as proof that parallel execution will reduce latency.
- Hand OpenPose is the dominant optional pose cost; disabling face gives little benefit compared with disabling hands.
- A retained webcam capture can block standalone camera benchmarks; use an existing local image when profiling only OpenPose.
- Keep Workflow 07 as the quality/baseline path and publish optimizations as Workflow 11.
- The cold start includes checkpoint, CLIP Vision, ControlNet, IPAdapter, kernels, and cached OpenPose initialization; report hot and cold timings separately.

## Verification
1. Only three OpenPose model-path lines appear during the first Workflow-11 run, not on every hot run.
2. Eight hot server logs remain in a narrow band; verified result was 0.62–0.68s with a 0.645s median (~1.55 FPS).
3. Workflow 07 still contains `OpenposePreprocessor` at 512 with hands/body/face enabled; Workflow 11 contains `DaWastehCachedOpenPose` at 384 with body+face enabled and hands disabled.
4. Targeted tests for cached model reuse, workflow wiring, generator stability, and KJ patch application pass.
5. `tools/validate_workflows.py --against-head` reports zero errors, git diff checks pass, and local HEAD matches origin/main after push.
