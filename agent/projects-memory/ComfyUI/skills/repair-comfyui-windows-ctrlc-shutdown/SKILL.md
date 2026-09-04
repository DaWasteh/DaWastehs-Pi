---
name: "repair-comfyui-windows-ctrlc-shutdown"
created: "2026-08-02"
description: "Repair and verify graceful Ctrl+C shutdown for the two L:/ComfyUI Windows RDNA4 launchers. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when start-R9700.ps1 or start-9070XT.ps1 no longer exits on Ctrl+C, when PowerShell suppresses console interrupts, or after changing the Windows launcher/supervisor.

## Procedure
1. Confirm ports 8188 and 8189 are free or identify the exact ComfyUI listener before editing.
2. Keep scripts/windows_comfy_launcher.py as the console supervisor: re-enable Ctrl+C handling, start ComfyUI with CREATE_NEW_PROCESS_GROUP, install signal.default_int_handler for SIGBREAK in the child bootstrap, and send targeted CTRL_BREAK_EVENT after Ctrl+C.
3. Have both PowerShell start scripts invoke the supervisor with the venv Python, ComfyUI working directory, and their existing argument arrays. Do not invoke main.py directly and do not rely on Start-Process propagation.
4. Keep verified stop-R9700.ps1 and stop-9070XT.ps1 taskkill fallbacks for native/GPU hangs that cannot shut down gracefully.
5. Parse PowerShell scripts and py_compile the supervisor, then start each real server in a separate Windows console. Attach a helper to that console, issue CTRL_C_EVENT, and verify launcher exit 0 plus closed listener port.

## Pitfalls
- PowerShell can suppress Ctrl+C for foreground native children; direct '& python main.py' is not reliable on this setup.
- Sending CTRL_BREAK_EVENT to ordinary Python terminates it with 0xC000013A and skips finally blocks unless SIGBREAK is explicitly mapped to signal.default_int_handler.
- Do not use taskkill for the normal Ctrl+C path because it bypasses ComfyUI asset_seeder.shutdown() and cleanup_temp().
- The update script must detect launcher/supervisor/main.py processes as well as listening ports because startup has a pre-listener Torch/import window.

## Verification
1. PowerShell AST parsing reports no errors for both start and stop scripts.
2. python -m py_compile passes for scripts/windows_comfy_launcher.py.
3. R9700 starts on 8188, CTRL_C_EVENT causes exit 0, and 8188 closes.
4. RX 9070 XT starts on 8189, CTRL_C_EVENT causes exit 0, and 8189 closes.
5. No ComfyUI launcher, supervisor, main.py process, or listener remains after each test.
