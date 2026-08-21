# Skill Governor

Local Pi extension implementing a governed procedural-skill lifecycle without
modifying package-owned extensions.

## Runtime policy

Automatic evolution/canary/activation are off in code defaults. This user's
tracked `agent/skill-governor/config.json` explicitly opts into the full
lifecycle (`userApprovedAt`) while retaining recurrence, same-provider, audit,
critic, and evidence gates.

- Task-route at most `routing.maxAutoSkills` automatic descriptions with a
  positive lexical score.
- Keep unmatched automatic skills available through `skill_route`. Manual and
  canary bodies may be read without a popup because reading instructions is not
  permission to execute their consequential actions.
- Remove `skill_manage` from active model tools and block direct mutations.
- Store generated candidates outside all Pi skill-discovery roots.
- Require distinct recurrent observations before automatic generation.
- Default to same-provider generator/critic calls; task text is redacted and
  bounded before the side-channel request.
- Fail closed on malformed critic output, secret/injection findings, digest
  drift, stale evidence, duplicate task/run evidence, or failed candidate runs.
- Promote low-risk candidates to manual canary first. Automatic active promotion
  additionally requires digest-bound evidence from unique paired tasks.

## Evidence import

`/skill-governor evidence <candidate-id> <json-file>` accepts one object or an
array. Every record must match the current candidate digest:

```json
{
  "taskId": "fixture-1",
  "runId": "2026-08-17-a",
  "evaluator": "pi-skill-benchmark-v1",
  "candidateSha256": "<64 hex chars>",
  "baselinePassed": false,
  "candidatePassed": true,
  "utilityDelta": 1,
  "tokenRatio": 0.9,
  "timeRatio": 0.9,
  "hardSafetyViolation": false,
  "recordedAt": "2026-08-17T00:00:00.000Z"
}
```

Authority actions remain explicit user slash commands, without a redundant
technical yes/no popup. Incomplete active promotion fails closed unless the user
repeats the command with `--override`. Promotion, retirement, and rollback reload
Pi resources after durable state changes.

The low-noise permission policy guards actual file-tool and shell mutations of
governor-owned paths. It does not scan opaque custom-tool payloads or treat
messages, test names, and paths on another Windows volume as governed files.
Ordinary repository commands remain governed by the user's task and the tool
that executes them; skill-governor is intentionally not a global shell gate.

## Security boundary

Tool hooks, canonical paths, reparse-point checks, digest validation, and
failure-atomic moves are defense-in-depth. On Windows, Pi, extensions, and shell
commands still run as the same logged-in user; same-user hostile code can race
or bypass text-level interception. Use a separate OS identity, VM, or supported
filesystem/process sandbox when the task itself is untrusted.

The design is informed by arXiv:2608.11888 (differential skill failures) and
arXiv:2608.12851 (skill misevolution/lifecycle governance). Their benchmark
thresholds are not assumed to transfer unchanged to this Pi setup.
