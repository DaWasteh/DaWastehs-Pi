---
name: "create-vrm0-avatar-variants"
created: "2026-08-01"
description: "Create realistic or stylized Workflow-06-compatible VRM0 texture variants locally from three references plus a prompt, with an optional strict Meshy cloud candidate path. Manual-only; do not use for unrelated work."
version: 3
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when adding or testing VRM models for Workflow 06, especially three-reference appearance guidance, realistic/stylized texture variants, custom UV textures, dynamic preset listing, or optional Meshy auto-rig conversion.

## Procedure
1. Prefer Workflow 08 for no-credit local creation. Select a licensed single-texture VRM0 base and load exactly three licensed/consented images of the same clearly adult person: front, three-quarter, and profile with similar crop, lighting, expression, and face scale.
2. Workflow 08 batches the three images through core BatchImagesNode and applies one IPAdapterAdvanced conditioning with combine_embeds=average at weight 0.35. Keep img2img denoise near 0.20 so the fixed UV islands remain usable.
3. Treat the result as an appearance/likeness-guided texture variant, never identity reconstruction. Workflow 08 preserves base geometry, skeleton, fingers, morph targets, UV layout, license metadata, and original texture alpha; it rejects bases with multiple distinct embedded base-color images rather than partially editing them.
4. Keep the save node muted for the first run. Inspect the flat UV preview, then explicitly enable save and rerun with the fixed seed/cache. Finally inspect the saved model rendered in Workflow 06; delete or ignore rejected variants.
5. After saving, refresh Workflow 06's model list. The loopback-only `/dawasteh/vrm-model-list` route enumerates safe files from `models/live-avatar-vrm`.
6. For binary texture replacement, operate only on the declared glTF buffer core, replace the image's exclusive span, align inserted bytes, shift later bufferViews by an aligned delta, set PNG MIME and raw image byteLength, and ensure BIN padding beyond declared length is at most three bytes.
7. Use Workflow 09 only when the user explicitly accepts Comfy credits and Meshy uploads. Require a truthful provider/asset license URL; Meshy outputs GLB/FBX, never guaranteed VRM.
8. Strict GLB-to-VRM conversion must prove one coherent skin connected to a mesh, valid JOINTS_0/WEIGHTS_0 accessors, required body/finger hierarchy, identity bone rotation/scale, and real non-empty POSITION morph accessors for Blink and A/I/U/E/O before publishing a full-capability VRM0.
9. When strict capabilities are missing, reject with a report. Body-only output requires explicit acknowledgement and still must pass coherent body skin/hierarchy checks; never bind empty morph slots or partial finger chains.
10. Keep Workflow 07 Windows combo values exactly equal to pinned/live object_info: `LiveAvatar\lcm-lora-sdv1-5.safetensors` and `SD1.5\control_v11p_sd15_openpose_fp16.safetensors`. Reopen the workflow after syncing because an already-open canvas retains old widgets.

## Pitfalls
- Do not rename an unrigged GLB to `.vrm`; metadata cannot manufacture skin weights, bone hierarchy, fingers or facial morph deltas.
- Do not claim Workflow 08 creates new geometry, body shape, or a photorealistic identity. A stylized base remains geometrically stylized.
- Do not feed the extracted UV texture into IPAdapter's reference input; UV goes to VAEEncode while the three user LoadImage nodes feed BatchImagesNode and IPAdapter.
- The first reference determines BatchImagesNode's dimensions; inconsistent crops or face scale weaken the equal average.
- Multi-texture VRM0 bases must fail clearly until a future workflow supports editing all materials. Never silently replace only the first texture.
- Do not discard original alpha when replacing an RGBA base-color texture.
- Do not use placeholder license URLs. `licenseName=Other` must fail until a truthful URL is entered.
- Do not shift later binary bufferViews by an unaligned raw PNG delta or retain old GLB padding before repadding.
- Do not stress/restart the RX 9070 XT while the user is gaming; use 8188/R9700 for creator smokes and restart only that server after empty-queue checks.

## Verification
1. Run `L:/ComfyUI/.venv/Scripts/python.exe tests/test_live_avatar_vrm_creator.py -v`; all tests, including alpha preservation, multi-texture rejection, three-reference topology, and binary safety, must pass without skips.
2. Run all Python tests in the Comfy venv, deterministic generation for Workflows 06–10, Live Avatar refinement check, Pixaroma integration check, against-HEAD validation, and `git diff --check`.
3. Verify Workflow 08 production JSON and `assets/live-avatar-v072/workflow-08.template.json` are byte-identical and that the save node is muted by default.
4. Run a disposable Workflow 08 API smoke on 8188 with flat autogrow keys `images.image0`, `images.image1`, and `images.image2`; confirm the new VRM appears in the model list and then remove it.
5. Verify a known multi-texture base is rejected with the explicit one-distinct-base-color-image compatibility error.
6. Never execute Workflow 09 without credits/consent; validate it structurally and keep the lack of Meshy live testing explicit.
