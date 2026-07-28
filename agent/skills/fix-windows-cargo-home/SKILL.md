---
name: fix-windows-cargo-home
description: "Move Cargo/RTK binaries out of an accidental project-local CARGO_HOME on Windows. Use whenever where.exe cargo/rtk resolves inside a repo or user-level CARGO_HOME points at a project directory."
---

# Fix Misplaced CARGO_HOME on Windows

## Symptom
`where.exe cargo` or `where.exe rtk` resolves to a project-local `.cargo\bin`, but Rust tools should live under `%USERPROFILE%\.cargo\bin`.

## Repair procedure
Inspect the real process/user/machine state first:

```powershell
$ErrorActionPreference = "Stop"
$env:CARGO_HOME
[Environment]::GetEnvironmentVariable('CARGO_HOME', 'User')
[Environment]::GetEnvironmentVariable('CARGO_HOME', 'Machine')
where.exe cargo
where.exe rtk
```

Move binaries non-destructively, then unset user-level `CARGO_HOME`:

```powershell
$old = "<project>\.cargo"
$new = Join-Path $env:USERPROFILE ".cargo"
New-Item -ItemType Directory -Force "$new\bin" | Out-Null
Copy-Item "$old\bin\*.exe" "$new\bin" -Force
foreach ($f in '.crates.toml', '.crates2.json', 'config.toml') {
  if ((Test-Path "$old\$f") -and -not (Test-Path "$new\$f")) { Copy-Item "$old\$f" "$new\$f" }
}
[Environment]::SetEnvironmentVariable('CARGO_HOME', $null, 'User')
```

Edit the user PATH: remove `<project>\.cargo\bin`, ensure `%USERPROFILE%\.cargo\bin` is present. Follow `powershell-windows-scripting` for fresh-shell/PATH rules.

## Pitfalls
- Child shells inherit stale `CARGO_HOME`; verify registry/user env separately or simulate a fresh process.
- `cargo install rtk-ai` is wrong; RTK installs from GitHub:

```powershell
cargo install --git https://github.com/rtk-ai/rtk
```

- Do not delete the old project `.cargo` directory unless the user explicitly confirms; it may contain caches or project config.

## Verification
```powershell
$env:CARGO_HOME = $null
$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
where.exe rtk
rtk --version
where.exe cargo
cargo --version
```

Expected: both tools resolve under `%USERPROFILE%\.cargo\bin`, and user-level `CARGO_HOME` is empty/unset.
