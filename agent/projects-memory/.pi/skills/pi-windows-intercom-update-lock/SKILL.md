---
name: "pi-windows-intercom-update-lock"
created: "2026-07-30"
description: "Repair Pi package updates blocked by pi-intercom EBUSY locks on Windows. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when /update or pi update --extensions fails on Windows with EBUSY renaming agent/npm/node_modules/pi-intercom, or when changing the pi-autoupdate maintenance window.

## Procedure
1. Use agent/extensions/pi-autoupdate.ts as the canonical implementation; do not work around this by requiring all Pi sessions to close.
2. Before package mutation, acquire agent/intercom/broker.spawn.lock in the native pi-intercom two-line format plus a compatible nonce line; retain the file descriptor and heartbeat the timestamp.
3. Validate agent/intercom/broker.pid against a pi-intercom broker command line, then terminate the Windows parent/descendant process tree with taskkill /T /F while the respawn lock is held.
4. Run pi/npm through tree-aware cancellation so lock loss or timeout cannot leave descendant package-mutating processes alive.
5. Keep the lock through post-update package patches, reapply pi-intercom's runtime-cwd patch, verify nonce ownership, close the descriptor, then remove only the owned lock.
6. Validate with cd agent && npx tsc -p tsconfig.json, git diff --check, and an end-to-end extensions update with a live intercom broker.

## Pitfalls
- Changing only the broker cwd is insufficient: the live tsx loader still locks pi-intercom on Windows.
- Killing only cmd.exe is insufficient: descendant Node/npm processes can continue mutating packages.
- PID-only lock ownership is insufficient because reconnect code in the same Pi process uses the same PID; retain and verify a nonce.
- Do not stage volatile agent/.pi-hermes-locks.sqlite-shm or .wal files in release commits.

## Verification
1. pi --version reports the intended Pi version.
2. npm list --prefix agent/npm --depth=0 shows expected package versions.
3. An end-to-end pi update --extensions succeeds while the intercom broker is connected and reports that the broker was stopped with respawn paused.
4. TypeScript reports no errors and git diff --check passes.
5. A fresh-context reviewer reports no remaining blockers in pi-autoupdate.ts.
