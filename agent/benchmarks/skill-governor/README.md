# Historical v2.4 Skill Governor Benchmark

This harness reproduces the recorded v2.4 differential experiment only. It is
not a v2.7 benchmark and its existing rows are not release evidence for the
lean v2.7 router. Do not relabel or extend `v2.4-routed` results with current
runtime behavior.

## Historical conditions

- `no-skill` — no skills or governance prompt
- `v2.3` — skills materialized read-only from Git tag `v2.3`
- `v2.4-routed` — v2.4's automatic-only metadata selection (maximum five)
  plus its historical compact governance policy
- `forced-skill` — the historical v2.4 routed policy plus the case target body

The v2.4 policy is deliberately a benchmark-local constant in `run.mjs`. This
keeps historical reproduction independent from removed v2.7 runtime exports.

Only `read`, `edit`, and `write` are exposed. Fresh fixtures contain no shell
or path-enumeration tool, and the inline safety extension confines file-tool
paths to the disposable fixture and read-only skill corpus.

## Cases

1. Exact JSON task contract
2. Targeted semantic HTML
3. PowerShell native exit handling
4. Windows Python path/subprocess behavior
5. WinAPI wide-path/handle cleanup
6. Read-only llama.cpp build-log diagnosis
7. Single-widget ComfyUI JSON edit
8. Release notes without commit/tag/push authority

## Optional historical reproduction

No paid benchmark calls are part of v2.7 verification. If explicitly requested,
run the historical experiment from `agent/`:

```bash
npm run skill:bench
npm run skill:report
```

The default is 8 cases × 4 conditions × 3 repeats = 96 model runs using
`openai-codex/gpt-5.3-codex-spark` at low thinking. Raw JSONL is immutable and
resumable; duplicate keys or harness/model mismatches fail closed.

For no-model fixture verification only:

```bash
npm run skill:bench -- --dry-run
```

Raw results remain under the ignored `results/` path. Historical aggregate
reports remain named `v2.4-benchmark.md` to prevent accidental v2.7 claims.
