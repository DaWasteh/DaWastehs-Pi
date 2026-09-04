---
name: "maintain-incremental-comfy-updater"
created: "2026-08-11"
description: "Maintain and release the safe incremental Windows ComfyUI updater for this bundle. Manual-only; do not use for unrelated work."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## Governance
Explicit task requirements and repository evidence override this skill; it is manual-only, so run only the explicitly requested stages and treat historical versions, counts, and paths as evidence to re-check.

## When to Use
Use when changing tools/update-comfyui-rdna4.ps1 or .bat, deployment paths, owned workflow/node synchronization, updater backups/manifests, or updater release behavior in DaWastehs-ComfyUI-Bundle.

## Procedure
1. Treat tools/update-comfyui-rdna4.ps1 and tools/update-comfyui-rdna4.bat as canonical; deploy byte-identical copies to L:/ComfyUI after changes.
2. Keep L:/GitHub/DaWastehs-ComfyUI-Bundle as the only owned source repository. Never clone a second working source beside it.
3. Capture one Git commit after pull, enumerate files with git ls-tree, and materialize binary content from that commit's blobs. Do not deploy working-tree bytes.
4. Compare committed blob bytes with installed targets and copy only changed files. Back up only replaced or removed files.
5. Record deployed Git paths in L:/ComfyUI/config/dawasteh-bundle-sync-manifest.json. Remove only files present in the previous manifest but absent from the captured commit.
6. Run reparse-point and lexical containment checks before every directory creation, file write, copy, or deletion involving managed targets, backups, manifests, updater installation, and Git repositories.
7. Keep the active BAT launcher stable during execution; only the PowerShell updater may refresh its installed copy for the next run.
8. Validate with python -m unittest discover -s tests, python tools/validate_workflows.py --against-head, Windows PowerShell parser checks, git diff --check, and byte-identity checks between tools/ and L:/ComfyUI copies before release.

## Pitfalls
- Windows PowerShell 5.1 on this machine does not expose Get-FileHash; use the .NET SHA256 implementation already in the updater.
- git status can miss assume-unchanged or skip-worktree bytes. Commit-blob deployment is required for truthful source_commit attribution.
- Do not create a target or backup directory before junction/reparse preflight; a missing path beneath a junction can mutate an out-of-bound location before a later check fails.
- Do not recursively delete Pixaroma lookalikes or non-Git directories. Warn or fail closed instead.
- Do not compile Python during validation because compileall creates __pycache__/pyc residue; parse source with ast instead.
- Do not overwrite update-comfyui-rdna4.bat while cmd.exe is executing it; resumed batch reads can continue from an invalid byte offset.

## Verification
1. All updater static and Windows runtime tests pass, including hidden working-tree changes, committed blob deployment, stale manifest removal, local-file preservation, traversal, junction, preflight-before-create, and PowerShell self-update coverage.
2. The full repository unittest suite passes and workflow validation reports errors: 0.
3. PowerShell parses both L:/ComfyUI/update-comfyui-rdna4.ps1 and tools/update-comfyui-rdna4.ps1 without errors.
4. git hash-object for each installed launcher copy equals the corresponding HEAD blob.
5. L:/GitHub/DaWastehs-ComfyUI-Bundle is absent, and git status is clean after release.
