---
name: "backfill-supercalc-diagnostics"
created: "2026-07-18"
description: "Safely recompute schema-v4 diagnostics for historical SuperCalc scorecards without changing official scores. Manual-only: invoke only for an explicit matching task; do not use for routine edits or adjacent project work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit user/task requirements, exact paths, APIs, formats, repository evidence, and acceptance criteria override this skill's examples and historical defaults. This skill is manual-only because its workflow can mutate environments, repositories, releases, large collections, or user data. Run only the explicitly requested stages; installation, deletion, deployment, commit, tag, push, restart, and exhaustive verification each require matching scope or approval. Historical versions, counts, timings, paths, and model names are evidence to re-check, not universal truth.

## When to Use
Use when diagnostics-v1 calculator/parser logic changes or historical archive scorecards must be enriched from existing run artifacts without rerunning models.

## Procedure
1. Run `backfill-archive-metrics --archive ./archive --dry-run`; investigate every unavailable record before writing.
2. Copy the archive to an ignored artifacts directory and run write mode with an explicit backup, then run it a second time. Require the second run to report zero writes.
3. Compare original and migrated JSON canonically after removing only top-level `schemaVersion` and `behavioralDiagnostics`; require zero differences across all scorecards.
4. Use raw JSON DOM mutation for migrations so legacy absent/default fields are not materialized outside the diagnostic envelope.
5. Treat UTF-8 BOM input as valid while hashing and backing up original bytes unchanged. Normalize Run 1/Run 2 aliases and select the final truth-audit JSON after schema echoes.
6. Bump `BehavioralDiagnosticsProvenance.CalculatorVersion` whenever formulas or parser semantics change so current envelopes are recomputed.
7. After disposable validation, write tracked archives with a new external backup directory, rerun for idempotence, and record artifact-completeness and truth-validity censuses separately.

## Pitfalls
- Do not serialize an entire legacy scorecard through current typed models; defaults can change unrelated JSON.
- Do not equate backfill complete/partial artifact status with truth-audit eligibility.
- Do not infer a missing audited target; recover it from a valid normalized response/prompt or leave the truth metric invalid.
- Do not overwrite or reuse a backup directory whose bytes correspond to a different migration generation.
- Never modify official score fields, vulnerability credits, score versions, benchmark prompts, hidden ground truth, or detection assignment during backfill.

## Verification
1. Release solution build and full custom tests pass.
2. Ground-truth validation and perfect fixture remain unchanged.
3. Tracked dry-run reports every record already current and zero writes.
4. Canonical comparison reports zero non-diagnostic differences.
5. Comparison HTML inline scripts parse with Node.
6. Repository excludes migration backups and generated reports from release commits.
