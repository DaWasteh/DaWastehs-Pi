---
name: maintain-supercalc-benchmark-fairness
description: "Maintain SuperCalc hidden benchmark content and fairness. Use when changing enhanced_calc.cpp vulnerabilities, enhanced_exploits.md, hidden ground truth, severity/counts, or scorer-facing evidence definitions. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: critical
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

# SuperCalc Benchmark — Fairness & Ground Truth

## Ownership boundary
This skill owns benchmark content: vulnerable C++ code, hidden ground truth, exploit documentation, severity/count summaries, and fairness of what the evaluated LLM can infer.

Harness build/test commands belong to `maintain-supercalc-benchmark-tool`; do not duplicate the full .NET validation sequence here.

## Content rules
- Every vulnerability must be code-grounded and reachable enough for static LLM analysis without labeling the answer in comments.
- `enhanced_exploits.md` must match the real code: trigger, location, severity, technical detail, and summary counts.
- `benchmarks/supercalc-v3/ground_truth.json` needs IDs, aliases, code locations, required evidence strings, and scoreability.
- If vulnerability count or severity distribution changes, update README and exploit summary tables.

## Secrecy rules
- Never send `enhanced_exploits.md` or `ground_truth.json` to evaluated models in Run 1/Run 2.
- Prompt-visible material may include source code and prompt/schema templates only. Truth audit is the explicit exception and must be archived as truth-visible.
- Do not overwrite `LLM-Showdown.xlsx` unless the user asks for spreadsheet work.

## Pitfalls
- Source comments that name vulnerabilities make the benchmark unfair.
- Ground truth evidence strings drifting from source silently breaks scoring.
- Changing source without updating hash/count docs causes confusing validation failures.

## Verification
- `ground_truth.json` parses and intended vulnerability count is correct.
- All required evidence strings exist in `enhanced_calc.cpp`.
- `source_sha256` matches the current source.
- Run the tool skill's `validate` command before final handoff.
