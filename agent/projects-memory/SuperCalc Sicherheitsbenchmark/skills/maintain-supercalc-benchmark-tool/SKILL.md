---
name: maintain-supercalc-benchmark-tool
description: "Build and verify the SuperCalc .NET 10 benchmark CLI/WPF harness. Use when modifying Core/Cli/App/Tests, scorer/parser, llama.cpp client, prompt builder, report writer, archive migration, CI, or Linux/Wine launch scripts. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

# SuperCalc Benchmark — .NET Harness Build & Verify

## Environment
- All projects target `net10.0`; `global.json` pins SDK `10.0.301` with `rollForward=latestFeature`.
- Run dotnet commands from repo root.
- On Ubuntu, use `./setup_linux.sh`; it installs/uses `~/.pi/dotnet`, sets writable homes/caches, builds, and publishes the Wine WPF app under `artifacts/linux-wine/`.
- VS Code on Ubuntu should launch via `./code_linux.sh`; GUI on Ubuntu/Wine via `./start_linux.sh`.

## Prompt/scoring invariants
- Run 1/Run 2 never receive `enhanced_exploits.md` or `ground_truth.json`. Ground truth is loaded only after scoring, except explicit Run 3 truth audit.
- Scoring changes are profile-versioned. `official-v1` is frozen; new behavior gets a new profile and archive migration path.
- Optional adjudication is local-only, labeled non-official-comparable, and never sent to Run 1/Run 2.
- Manual per-run stop is distinct from global abort; preserve the separate archive semantics.

## Validation workflow
```bash
dotnet build SuperCalcBenchmark.slnx --configuration Release
dotnet run --project src/SuperCalcBenchmark.Tests --configuration Release
dotnet run --project src/SuperCalcBenchmark.Cli --configuration Release -- validate
dotnet run --project src/SuperCalcBenchmark.Cli --configuration Release -- score-fixture --response tools/response-fixtures/perfect.json --out artifacts/perfect-ci --no-archive
```

For archive migrations:

```bash
dotnet run --project src/SuperCalcBenchmark.Cli --configuration Release -- migrate-archive-scores --archive ./archive --assume-profile official-v1 --dry-run
```

Use `--write` only after inspecting the dry run; it creates a backup by default.

## Pitfalls
- WPF must not treat `src/.../bin/...` as repo root just because copied assets exist there; prefer candidates with `.git`/`SuperCalcBenchmark.slnx`.
- GUI archives should land under repo-root `./archive`, not under bin output directories.
- Headless Pi sessions may not run Wine GUI even when the publish is valid.
- Token metrics must remain exact, never character estimates: request streaming `usage` with `stream_options.include_usage`, parse the final empty-choices SSE chunk, use `usage.completion_tokens` as authoritative generated total, and count visible Thinking/Output separately with the loaded model's `/tokenize` endpoint (`add_special=false`). Total may exceed the visible channel sum because control/separator/EOS tokens are hidden.
- New archive token fields stay nullable so legacy scorecards render `n/a`; never backfill old records from chars.
## Verification
- `dotnet --info` sees a compatible .NET 10 SDK; Ubuntu `~/.pi/dotnet/dotnet --info` is acceptable with the script env.
- Build has 0 errors; Ubuntu `./setup_linux.sh` publishes the Wine app.
- Tests print `All tests passed`.
- `validate` prints `Valid: True`.
- Perfect fixture scores 100/100 with expected TP/FP counts.
