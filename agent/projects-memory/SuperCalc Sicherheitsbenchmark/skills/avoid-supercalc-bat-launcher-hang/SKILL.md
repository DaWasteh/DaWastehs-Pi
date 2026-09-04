---
name: avoid-supercalc-bat-launcher-hang
description: "Diagnose and avoid Windows Terminal hangs when launching the SuperCalc WPF app. Do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: auto
skill-governor-risk: medium
---
## Governance
Explicit task requirements and repository evidence override this skill; use only the portion relevant to the current change and treat historical versions, counts, and paths as evidence to re-check.

# SuperCalc Benchmark — Avoid Windows Launcher Hangs

## Scope
Use when the SuperCalc GUI startup leaves a cmd/Terminal window open, unresponsive, or visible after the WPF window appears.

## Workflow
1. Check the app log first: if it shows 'Bereit' and archive loading completed quickly, the WPF startup path is not the blocker.
2. Do not rely on start.bat for a no-console launch on Windows 11/Windows Terminal; even an empty .bat can keep cmd/Terminal alive for several seconds.
3. Use or maintain start.vbs as the preferred no-console launcher. It resolves Release first, Debug fallback, sets the working directory to the app output folder, runs SuperCalcBenchmark.App.exe through WScript.Shell.Run with wait=false, and exits.
4. Keep start.bat only as a compatibility wrapper that invokes start.vbs; update setup output/docs to recommend start.vbs.
5. If profiling is needed, measure launchers with PowerShell Start-Process -PassThru, but avoid leaving test terminal windows open; always kill SuperCalcBenchmark.App after timing.

## Pitfalls
- Do not interpret the lingering black Terminal window as archive-loading or WPF UI startup if the SuperCalc log has already printed readiness and archive timing.
- Do not switch start.bat to 'exit' instead of 'exit /b'; tests showed it can make the wrapper hang worse under Windows Terminal.
- Do not repeatedly run launcher profile tests without cleaning up cmd/WindowsTerminal/SuperCalcBenchmark.App processes, because visible test windows can annoy the user.

## Verification
1. Double-click or Start-Process start.vbs: wscript exits in well under one second and SuperCalcBenchmark.App.exe remains running.
2. dotnet build SuperCalcBenchmark.slnx --configuration Release --no-restore succeeds.
3. dotnet run --project src/SuperCalcBenchmark.Tests/SuperCalcBenchmark.Tests.csproj passes.
