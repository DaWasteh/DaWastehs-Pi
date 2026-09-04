---
name: fix-comfyui-workflows-against-installed-nodes
description: "Validate and repair ComfyUI UI-format workflows against the actually installed L:/ComfyUI nodes/extensions. Use when LLM-generated workflows have fictional node names, bad widget values, broken links, or loader/model mismatches. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

# ComfyUI Workflow Validation Against Installed Nodes

## Scope
Use this after consulting `comfyui-amd-workflows` for AMD workflow-editing rules. This skill owns the `object_info`/installed-node validation method.

## Object-info dump
Dump object_info offline without loading models: set `sys.path` to `L:/ComfyUI/ComfyUI`, instantiate `PromptServer(asyncio.get_event_loop())`, then run `nodes.init_extra_nodes(init_custom_nodes=True, init_api_nodes=True)` and serialize each `NODE_CLASS_MAPPINGS` entry (`INPUT_TYPES`, `RETURN_TYPES`, category, output flag). Expect roughly 2232 nodes.

## Validation rules
- Node `type` must exist, except frontend-only nodes such as `Note`, `MarkdownNote`, `Reroute`, and `PrimitiveNode`.
- Validate dropdown widget values by name, not raw index. `control_after_generate` is inserted after seed widgets and can offset naive widget mapping.
- Link type strings must match input types.
- Check model files only on loader nodes and in the correct folders: CLIPLoader→`text_encoders`, UNET/GGUF loaders→`unet`, VAE→`vae`, checkpoints→`checkpoints`, LoRA→`loras`, MMAudio→`mmaudio`.

## Known local node-name fixes
- QwenTTS uses `AILab_Qwen3TTSCustomVoice/VoiceDesign`.
- MMAudio nodes are `MMAudioSuite*`; consolidate assets into `models/mmaudio/`.
- VHS video nodes are `VHS_*`.
- LTX text uses CLIPLoader `type=ltxv` plus the correct LTXAV text encoder path; see `fix-ltx23-textencoder-av-crash` for LTX-2.3.
- Hunyuan3D working setup uses CORE nodes, not missing kijai `Hy3D*` wrappers.

## Pitfalls
- Some custom nodes require `PromptServer.instance` before offline load.
- ripgrep/rtk can misparse complex patterns here; prefer Python source scans for ComfyUI internals.
- Widget-count validation is unreliable because connected inputs are not widgets.

## Verification
- Object-info dump prints OK and includes expected custom nodes.
- Validator reports no real problems except accepted placeholders/union-type warnings.
- Loader-referenced model files exist.
- Workflow opens without red missing-node boxes.
