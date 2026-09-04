---
name: system-tricorder-linux-hardware-parity
description: "Fix or validate System Tricorder Linux GPU/disk detection while preserving Windows behavior. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

# System Tricorder — Linux Hardware Parity

## Scope
Use when System Tricorder has Ubuntu/Linux hardware-monitoring bugs, especially GPU enumeration/utilization or drive tile naming/partition issues.

## Workflow
1. Keep Windows-specific paths (WMI, registry, PDH) isolated and unchanged; branch Linux fixes behind platform.system() == 'Linux'.
2. For Linux GPU UI tile creation, use _linux_detect_gpus() rather than Windows get_wmi_gpu_list()/get_registry_gpu_vrams().
3. Parse lspci -mm -nn with shlex.split(); GPU model is field 3 and PCI slots need normalization between lspci/sysfs/NVML forms.
4. Use DRM sysfs for card/vendor/VRAM/gpu_busy_percent where available, lspci fallback for visibility, NVML matched by PCI bus-id for NVIDIA, and DRM fdinfo deltas as best-effort engine utilization fallback.
5. For Linux drive tiles, include only whole physical disks: prefer lsblk -J metadata and sysfs partition checks, then map labels/mounts to compact names like C: Ubuntu or D: DataLabel.
6. Validate with py_compile plus a headless Qt smoke test using QT_QPA_PLATFORM=offscreen and HOME=/tmp.

## Pitfalls
- Do not treat lspci class containing 'Non-VGA' as a VGA GPU; require class to start with VGA, 3D, or Display.
- Do not create fake Linux dGPU tiles when only an iGPU exists; keep the old fallback only if detection fails entirely.
- Do not rely on NVML index ordering matching DRM card order; match by normalized PCI bus id first.
- lsblk/sysfs may be unavailable in container/sandbox contexts; code must degrade gracefully to psutil/lspci fallbacks.

## Verification
1. Run `.venv_linux/bin/python -m py_compile system_tricorder.py`.
2. Run a headless smoke test that instantiates TricorderDashboard with `HOME=/tmp QT_QPA_PLATFORM=offscreen` and checks GPU/iGPU/drive tiles.
3. On real Ubuntu, compare detected GPUs with `lspci -mm -nn`/`nvtop` and verify drive tiles show whole disks rather than partitions.
