# Skill Governor Differential Benchmark

Paper-derived A/B qualification for Pi skills. The harness keeps task, model,
thinking level, tools, fixture, and verifier fixed while changing only the
available skill corpus/policy.

## Conditions

- `no-skill` — no skills or governance prompt
- `v2.3` — skills materialized read-only from Git tag `v2.3`
- `v2.4-routed` — current task-routed auto metadata plus the compact governance policy
- `forced-skill` — v2.4 routed policy plus the case's target body explicitly loaded

This differential table measures metadata/policy interference and forced bodies,
not the complete live governor lifecycle. The full extension is covered by
unit/integration tests and a separate generator→critic probe.

Only `read`, `edit`, and `write` are exposed. Fresh fixtures contain no
symlinks and expose no shell/symlink-creation tool; a small inline safety
extension confines file-tool paths to the disposable fixture and read-only
skill corpus. The harness deliberately exposes no shell or path-enumeration
tool.

## Cases

1. Exact JSON task contract
2. Targeted semantic HTML
3. PowerShell native exit handling
4. Windows Python path/subprocess behavior
5. WinAPI wide-path/handle cleanup
6. Read-only llama.cpp build-log diagnosis
7. Single-widget ComfyUI JSON edit
8. Release notes without commit/tag/push authority

## Run

From `agent/`:

```bash
node benchmarks/skill-governor/run.mjs --runs 3
node benchmarks/skill-governor/report.mjs
```

The default is 8 cases × 4 conditions × 3 repeats = 96 model runs using
`openai-codex/gpt-5.3-codex-spark` at low thinking. Condition order is rotated
by case/replicate. Raw JSONL is immutable and resumable: duplicate keys or
harness/model mismatches fail closed. Use `--replace-output` only when starting
a wholly fresh run.

Useful bounded commands:

```bash
# Validate fixture constructors/verifiers without a model call
node benchmarks/skill-governor/run.mjs --dry-run

# One smoke case/condition
node benchmarks/skill-governor/run.mjs \
  --runs 1 \
  --cases exact-json-contract \
  --conditions no-skill \
  --output benchmarks/skill-governor/results/smoke.jsonl
```

Raw results and failed fixture copies stay under the ignored `results/` path.
The generated aggregate report is written to
`reports/v2.4-benchmark.md` and is intended to be reviewed and committed.

## Metrics

Each row records deterministic verifier checks, blocked policy violations,
skill reads, commands, tool/test/build counts, elapsed time, tokens, cost, and
final text. The report flags paired functional regressions and paper-style 2× efficiency
threshold cases (both token and time regress; one exceeds 2×). These are
threshold flags, not statistical confidence intervals or an acceptable
production budget.

Method references:

- arXiv:2608.11888 — differential skill-failure and efficiency triage
- arXiv:2608.12851 — longitudinal skill lifecycle/misevolution governance
