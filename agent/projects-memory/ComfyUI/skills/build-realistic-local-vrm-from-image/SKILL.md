---
name: "build-realistic-local-vrm-from-image"
created: "2026-08-02"
description: "Build and validate a realistic local VRM from one image using Qwen, RMBG, native Hunyuan3D, Blender and the VRM addon. Manual-only; do not use for unrelated work."
version: 3
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when a realistic, fully local image-to-VRM result is required on L:/ComfyUI without CUDA/cloud auto-rigging. Do not use Olivia low-poly geometry as the final body; use only its validated rig/metadata donor when licensing permits.

## Procedure
1. Coordinate first with the MiniMax workflow and dedicated push sessions via pi-intercom. Source of truth is L:/GitHub/DaWastehs-ComfyUI-Bundle; sync Live Avatar workflows and the LiveAvatar custom node byte-for-byte to L:/ComfyUI/ComfyUI without including another session's files.
2. Generate a level-camera full-body A-pose with Qwen Image Edit. Pad/outpaint until hands, five fingers and both feet are inside the frame and limbs are separated.
3. Generate left/back/right A-pose views for texture reference only. Do not use them for local Hunyuan geometry conditioning: the tested multiview geometry path fragmented severely.
4. Run RMBG-2.0 before Hunyuan. Use native Hunyuan3D 2.1 single-view conditioning with 4096 latent resolution and octree_resolution 512.
5. Render and inspect the GLB. Keep only the largest component, repair normals and holes, and reject anatomy that is not visibly improved.
6. Use tools/build_high_realism_local_vrm.py from the public bundle. The Blender rig stage removes every donor mesh, preserves donor author/license metadata, fits the humanoid rig, and avoids double-decimating a prepared mesh.
7. Project front/left/back/right references to a smart UV atlas, use the original high-resolution face crop for the front face region, generate PBR roughness, and proportionally cap texture edges at 2048.
8. Add conservative Blink/Blink_L/Blink_R and A/E/I/O/U morphs, then export VRM0.
9. Validate one mesh/one skin, 52 humanoid bones, embedded PBR images, expression binds, served/local SHA-256 equality and the runtime node schema.
10. Run one headless Chrome fake-camera MediaPipe test. Terminate every marked Chrome process, verify none remain, delete the temporary profile/video, and confirm ComfyUI queue is empty.
11. Have an independent reviewer inspect the repo diff, then hand an exact file allowlist to the dedicated push session so concurrent MiniMax changes stay unstaged.

## Pitfalls
- Arms-down or cropped-hand references produce unusable shoulder/hand geometry.
- Dark backgrounds without RMBG create empty meshes or background planes.
- SaveGLB success does not prove useful geometry; render and count connected components.
- Native multiview Hunyuan3D conditioning fragmented even with consistent A-pose references; use multiview images only for Blender texture projection.
- Hunyuan Paint/nvdiffrast and the wrapper rasterizer are CUDA-oriented and unavailable in this Windows ROCm environment. Do not install CUDA to force them.
- Do not leave donor body/eye/hair/accessory meshes in the final export; remove every donor MESH before importing the Hunyuan body.
- Do not overwrite VRM author/license with CC0. Preserve validated donor metadata or require explicit licensed metadata.
- Do not downscale non-square PBR images to a square; preserve aspect ratio.
- The generic validator requiring TongueOut is inappropriate without a mouth cavity; validate actual Blink and vowel binds.
- Planar/multiview baking remains approximate. Do not claim studio photorealism, separate hair physics, FACS topology or accurate fingers when absent.
- Chrome parent PID cleanup is insufficient; terminate and verify by unique test profile marker.

## Verification
1. Workflow 15 contains core LoadImage → RMBG → single-view Hunyuan conditioning with 4096 latent and octree 512; its template and runtime copy are byte-identical.
2. The reusable Blender orchestrator completes on Blender 4.5.9 and reports all donor meshes removed plus preserved license metadata.
3. The final VRM has exactly one mesh and one skin, 52 humanoid bones, PBR images and bound Blink plus A/E/I/O/U expressions.
4. The runtime HTTP model hash matches the local file and the final file is below the 32 MiB route limit.
5. The browser reports `Tracking: Ganzkörper · live` with the accepted model selected and visible deformation.
6. LiveAvatar tests and workflow-refinement tests pass; known unrelated repo-wide manifest failures are reported separately.
7. ComfyUI queue is empty and no marked Chrome test process/profile remains.
8. The dedicated push session confirms a selective commit/push and concurrent MiniMax files remain outside that commit.
