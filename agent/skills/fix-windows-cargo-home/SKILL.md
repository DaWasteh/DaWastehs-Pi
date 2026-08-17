---
name: "fix-windows-cargo-home"
description: "Repair an accidental project-local CARGO_HOME on Windows when cargo/rtk resolves inside a repository. Use only after confirming the misconfiguration; do not use for normal Rust installs, project-local toolchains, or unrelated PATH issues."
version: 2
updated: "2026-08-17"
skill-governor-tier: manual
skill-governor-risk: high
disable-model-invocation: true
---
## When to Use
Use only when `where.exe cargo` or `where.exe rtk` resolves to an unintended project-local `.cargo\bin`, or the user-level `CARGO_HOME` points into a repository. Explicit user intent and current environment/registry evidence override this recovery recipe.

## Procedure
1. Inspect process, user, and machine state separately: `$env:CARGO_HOME`, `[Environment]::GetEnvironmentVariable(...)`, `where.exe cargo`, `where.exe rtk`, and the relevant PATH entries.
2. Confirm the project-local Cargo home is accidental. If the repository deliberately isolates Rust state, stop.
3. Create `%USERPROFILE%\.cargo\bin` and copy required executables/config metadata non-destructively. Do not remove the source.
4. Show the proposed user-environment/PATH change and obtain approval before unsetting user `CARGO_HOME` or editing user PATH.
5. Remove only the unintended project Cargo bin from user PATH and ensure `%USERPROFILE%\.cargo\bin` is present once.
6. Start a fresh process environment before verification. If RTK must be installed, use the reviewed Git source command only after approval: `cargo install --git https://github.com/rtk-ai/rtk`.

## Pitfalls
- Child shells keep stale inherited environment values after registry/user changes.
- Copying binaries does not justify deleting caches, registry metadata, or repository config.
- `cargo install rtk-ai` is not the correct installation source for RTK on this system.
- Do not overwrite a newer destination config blindly; compare first.

## Verification
1. In a fresh environment, user-level `CARGO_HOME` is empty unless deliberately configured.
2. `where.exe cargo` and `where.exe rtk` resolve under `%USERPROFILE%\.cargo\bin`.
3. `cargo --version` and `rtk --version` succeed.
4. The old project `.cargo` directory remains available until the user separately approves cleanup.
