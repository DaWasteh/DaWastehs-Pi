---
name: "windows-gpu-utilization-pdh"
description: "Read live Windows GPU engine utilization with PDH instead of stale WMI/perflib formatting. Use when telemetry shows false 0%/stale GPU load or new high-frequency utilization code is added; do not use for slow inventory-only queries."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: low
---
## When to Use
Use for Windows GPU utilization sampling at sub-second cadence or stale WMI readings. Keep WMI for one-shot inventory/VRAM when it is sufficient. Repository telemetry semantics override this aggregation recipe.

## Procedure
1. Open one PDH query and add the English wildcard counter `\\GPU Engine(*)\\Utilization Percentage`.
2. Prime the rate counter, then collect and read the formatted counter array on each poll. Do not cache/enumerate a static GPU-engine instance list.
3. Parse instance names by LUID, engine index, and engine type. Aggregate duplicate rows per engine conservatively, then map LUIDs to physical adapters through DXGI/device identity.
4. Keep Microsoft Basic Render Driver and irrelevant zero-only adapters out through existing inventory identity rules.
5. Apply only modest smoothing when the UI needs it; preserve raw samples for diagnostics.
6. Close query/counter resources on shutdown and keep sampling off the UI thread.

## Pitfalls
- The first rate sample is normally zero.
- `PdhEnumObjectItems` snapshots become stale as GPU engine instances appear/disappear.
- WMI formatted GPU counters repeat at roughly one-second cadence.
- AMD ADL is not the correct RDNA4 shortcut; ADLX is a separate API with different semantics.
- Engine sums and vendor “overall GPU” metrics are not always identical.

## Verification
1. Under a known bounded load, compare several 250 ms PDH samples with Task Manager/vendor telemetry and confirm updates are not repeated WMI snapshots.
2. Verify the English counter path works on the German Windows installation.
3. Run the directly affected telemetry tests and a short handle/memory stability sample.
4. Preserve existing inventory/VRAM behavior; do not require a long soak for an unrelated UI change.
