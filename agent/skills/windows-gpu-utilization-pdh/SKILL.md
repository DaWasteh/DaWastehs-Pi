---
name: windows-gpu-utilization-pdh
description: "Read Windows GPU engine utilization via PDH (cache-free, Task-Manager-grade) instead of WMI. Use whenever a monitor shows stale 0% GPU readings or new Windows GPU telemetry code is written."
---

# Windows GPU Utilization via PDH

## Symptom
A dashboard shows long 0% GPU stretches while AMD Adrenalin/NVIDIA/Task Manager shows sustained load. Root cause: `Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine` is WMI/perflib-cached at roughly one-second granularity.

## Canonical PDH sequence
Use one wildcard counter and let PDH maintain the dynamic instance list:

```python
# ctypes shape, not a full wrapper
PdhOpenQueryW(None, None, byref(query))
PdhAddCounterW(query, r"\GPU Engine(*)\Utilization Percentage", 0, byref(counter))
PdhCollectQueryData(query)  # prime
# on every poll:
PdhCollectQueryData(query)
PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, byref(size), byref(count), None)
buf = (ctypes.c_ubyte * size.value)()
PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, byref(size), byref(count), buf)
```

Parse instance names like `pid_X_luid_0xHHHH_0xLLLL_phys_0_eng_N_engtype_TYPE`; aggregate max per `(luid, engine_index)` and sum by engine type. Bind LUID to physical GPUs through DXGI `AdapterLuid`/DeviceId.

## Locale and smoothing rules
- The English counter path works on German/non-English Windows; do not localize it. `PdhLookupPerfNameByIndex` returns empty for these GPU counters.
- Prime with at least two collects; the first sample for a rate counter is usually zero.
- Apply a short EMA (`tau≈0.25s`) to hide frame-scale 0↔100 oscillation on bursty workloads.

## Pitfalls
- `PdhEnumObjectItems` is instantly stale for GPU engines; never enumerate instances manually.
- WMI remains fine for slow VRAM/inventory queries, not high-frequency engine utilization.
- AMD ADL is dead on RDNA4; ADLX is out-of-process COM and not a practical ctypes shortcut.
- Microsoft Basic Render Driver can appear as a zero-util LUID; filter it by vendor/name/VRAM as existing inventory code does.

## Verification
- Compare PDH and WMI at 250 ms under known load; PDH updates every sample, WMI repeats/stales.
- Sustained 100% load reads roughly 92–100% in >90% of PDH samples; EMA has no sub-5% dips.
- `PdhAddCounterW` succeeds on de-DE Windows using the English path.
- VRAM/inventory WMI code still works after only the utilization path is switched to PDH.
