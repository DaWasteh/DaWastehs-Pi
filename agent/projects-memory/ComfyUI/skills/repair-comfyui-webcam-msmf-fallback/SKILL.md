---
name: "repair-comfyui-webcam-msmf-fallback"
created: "2026-08-02"
description: "Diagnose and repair ComfyUI OpenCV webcam failures on Windows when MSMF indexes or camera locks are wrong. Do not use for unrelated project work or to broaden a smaller task."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. Use only the narrow portion relevant to the current change. Do not add installation, release, unrelated cleanup, broad exploration, or full-suite verification unless the changed surface requires it. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when a ComfyUI WebcamCaptureCV2 workflow fails with MSMF warnings, `Failed to capture image from webcam`, or HRESULT 0xC00D3704, especially when OBS or virtual cameras are present.

## Procedure
1. Convert the signed OpenCV status to hexadecimal; -1072875772 is 0xC00D3704 (`MF_E_HW_MFT_FAILED_START_STREAMING`).
2. Enumerate devices without opening them using `cv2_enumerate_cameras.enumerate_cameras` separately for `cv2.CAP_DSHOW` and `cv2.CAP_MSMF`; indexes differ by backend.
3. Identify the intended physical fallback by exact device name rather than assuming the same numeric index across backends.
4. Test only the intended device with an explicit backend and a short timeout; release the capture immediately and do not save frames.
5. Configure WebcamCaptureCV2 with explicit backend/index. On this machine Logitech BRIO is DirectShow index 2.
6. If maintaining the node, release and clear failed VideoCapture instances so later queue runs can reopen them, and normalize output to the requested dimensions.
7. Edit UI workflow JSON programmatically, preserve all links and IDs, update the camera explanation note, and back up the original.
8. Restart ComfyUI after Python custom-node changes.

## Pitfalls
- Do not assume cam_index 1 means the second physical camera; on this machine MSMF index 1 is Elgato Virtual Camera while DirectShow index 1 is Elgato Facecam Pro.
- Do not probe all camera/backend combinations in one process; an MSMF open can hang and consume the entire test timeout.
- Changing only cam_index is insufficient when switching from MSMF to DirectShow because each backend has its own ordering.
- A failed retained VideoCapture must be released; otherwise Run (Instant) repeatedly reuses the broken stream.
- Do not interrupt active ComfyUI queues merely to reload the node; check `/queue` first and coordinate restart.

## Verification
1. `py_compile` passes for the edited custom node.
2. DirectShow enumeration maps index 2 to Logitech BRIO.
3. The actual edited WebcamCaptureCV2 class returns a float32 tensor shaped (1, 512, 512, 3) from the BRIO and releases it.
4. Workflow JSON parses; every input/output link resolves; last_node_id and last_link_id cover all IDs.
5. Structural comparison with the backup shows only the intended note/camera nodes changed and all links are untouched.
