---
name: windows-python-golden-rules
description: "Modern Python 3.12+ rules on Windows 11 including uv, pathlib, async/process behavior, native wheels, and AMD GPU ML via ROCm/HIP or DirectML. Use whenever writing Python tools or local AI code on Windows."
---

# Windows Python Golden Rules (3.12+ / AMD GPU)

## Environment
- `uv` for packages/tools, `py` launcher for version selection, per-project venvs — never global site-packages.
- `pathlib.Path` for paths; enable LongPaths and test >260-char paths.

## Runtime rules
- Async I/O uses the default Proactor loop. CPU-bound work: `multiprocessing` with spawn semantics — guard entry points with `if __name__ == "__main__"`.
- Free-threaded Python (3.13t+) only after every C extension is confirmed no-GIL-safe.
- Native packages need MSVC Build Tools. Defender can slow subprocess launches from temp dirs — keep build/cache dirs stable.
- Shell/PATH/encoding quirks → `powershell-windows-scripting`.

## ML / AMD GPU
- **No CUDA on this machine.** Use ROCm/HIP, DirectML, Vulkan, or CPU; translate CUDA-only tutorials or reject them.
- Device roles and llama.cpp flags → `amd-dual-gpu-inference`. Select devices deliberately (`HIP_VISIBLE_DEVICES`); defaults may not pick the 32 GB R9700.
- DirectML (`torch-directml`, `onnxruntime-directml`) is the fallback when ROCm/HIP wheels don't cover the workload.

## Verification
Test suite runs in the intended venv/Python version; ML startup prints the selected backend/device and expected VRAM before model load.
