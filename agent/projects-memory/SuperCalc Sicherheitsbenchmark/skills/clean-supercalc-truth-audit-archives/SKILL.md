---
name: clean-supercalc-truth-audit-archives
description: "Safely clean legacy SuperCalc archive/run artifacts while keeping current truth-audit runs. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: critical
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

# SuperCalc Benchmark — Clean Truth-Audit Archives

## Scope
Use when the user wants a clean SuperCalc benchmark archive/run history that keeps only current runs with Run 3 truth_audit, and explicitly wants old artifacts moved to Windows Recycle Bin instead of permanently deleted.

## Workflow
1. Identify repo scorecards under archive/supercalc-v3/*/*.json with Python, not Windows PowerShell 5.1 ConvertFrom-Json -Depth. Keep scorecards whose runs contain runKind='truth_audit' or a truth/audit run with groundTruthVisibleToModel=true.
2. Move only repo archive model directories with zero truth-audit scorecards to Recycle Bin. Keep directories with any truth-audit scorecard; if mixed, move individual legacy files instead of the whole directory.
3. Move archive/_reports to Recycle Bin because generated comparison reports are stale after pruning and can be regenerated with `dotnet run --project src/SuperCalcBenchmark.Cli -- compare`.
4. Check for stale app-output archives under src/SuperCalcBenchmark.App/bin/**/archive (from the old wrong-root issue) and move those stale generated copies to Recycle Bin; the canonical archive is ./archive.
5. For full raw run outputs in %LOCALAPPDATA%/SuperCalcBenchmark/Runs, keep only directories that contain run3_* files or run.json metadata proving a truth_audit run; move legacy/no-truth directories to Recycle Bin.
6. Use Microsoft.VisualBasic.FileIO.FileSystem DeleteDirectory/DeleteFile with RecycleOption.SendToRecycleBin, or another verified Recycle Bin API. Do not use rm/rmdir/del for user data.
7. Verify afterwards: archive/supercalc-v3 has only truth-audit JSONs, %LOCALAPPDATA%/SuperCalcBenchmark/Runs has only truth-audit directories, archive/_reports and stale bin archives are absent, and git status shows deletions only for intended legacy tracked scorecards plus any current untracked scorecards.

## Pitfalls
- Windows PowerShell 5.1 `ConvertFrom-Json` does not support `-Depth`; using it can make every parse fail and misclassify current truth-audit scorecards as legacy. Prefer Python for detection or omit -Depth.
- Do not permanently delete artifacts. If Recycle Bin restore is needed, enumerate Shell.Application Namespace(10), match item.Name plus original location, and invoke the localized Restore verb (German: `&Wiederherstellen`).
- Some current truth-audit scorecards may be untracked before cleanup; do not confuse `??` current scorecards with legacy items.
- Do not remove hidden ground truth or exploit docs; this workflow is only for run/archive artifacts.

## Verification
1. A Python summary reports repo archive json total equals the number of kept current scorecards, all with truth_audit and zero legacy/bad JSONs.
2. A Python summary reports local run dirs total equals truth dirs and zero legacy dirs.
3. `src/SuperCalcBenchmark.App/bin/**/archive` no longer exists unless intentionally regenerated, and `archive/_reports` is absent or regenerated from only current scorecards.
4. `git status --short --untracked-files=all` shows expected `D` entries for legacy tracked scorecards and preserves current truth-audit scorecards.
