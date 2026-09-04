---
name: "release-supercalc-version"
created: "2026-07-06"
description: "Prepare and push a SuperCalc benchmark release with semver tag and archive data. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when the user asks to publish a new SuperCalc release/version with code changes and benchmark archive scorecards.

## Procedure
1. Verify intended changes and untracked archive scorecards with `rtk git status --short`; include only `archive/<benchmark>/<family>__<quant>/*.json` scorecards, not generated `artifacts/` or `archive/_reports/`.
2. Bump the benchmark tool version in both `src/SuperCalcBenchmark.Core/BenchmarkRunner.cs` (`ToolVersion` constant) and `src/SuperCalcBenchmark.Core/Models.cs` (`BenchmarkRunResult.ToolVersion` default) when the release version changes.
3. Update README documentation/changelog when behavior changes or the user asks for a release description.
4. Run release checks from repo root: `rtk dotnet build SuperCalcBenchmark.slnx --configuration Release`, `rtk dotnet run --project src/SuperCalcBenchmark.Tests --configuration Release`, `rtk dotnet run --project src/SuperCalcBenchmark.Cli --configuration Release -- validate`, and perfect fixture scoring with `--no-archive`; optionally run `compare --public-labels --out artifacts/release-verify-comparison` to verify HTML generation.
5. Commit code plus intended archive JSON scorecards with a clear multi-line message. Use a temp message file or here-doc to avoid literal `\n` in commit messages.
6. Create an annotated semver tag (e.g. `v0.6.2`) with a multi-line description using `git tag -a <tag> -F <file>`, then push `main` and the tag separately.

## Pitfalls
- The repo's GitHub Pages workflow also creates auto release tags like `v16` from main pushes; semver tags can coexist but are not the same as those workflow run-number tags.
- Do not include ignored/generated local run artifacts (`artifacts/`, `results/`, raw run directories) in releases unless explicitly requested.
- When writing tag/commit descriptions through shell commands, avoid escaped `\n` in quoted `-m` arguments; use `-F <file>` for clean multi-line descriptions.

## Verification
1. `rtk git status --short --branch` shows clean and `main...origin/main` with no ahead/behind after push.
2. `rtk git ls-remote --tags origin <tag>` returns the pushed annotated tag.
3. Release checks pass with zero build/test/validation errors.
