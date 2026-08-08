# Pi configuration (`~/.pi`)

Personal configuration for the [Pi coding agent](https://pi.dev): a custom
theme, four local TypeScript extensions, and a few installed pi packages.

![Header](image.png)

## Layout

```text
~/.pi/
├── README.md                  # this file
├── agent/
│   ├── settings.json          # global settings (provider, model, packages, theme)
│   ├── pix.json               # pix extension state/config
│   ├── heimdall.example.json  # portable example; real heimdall.json is OS-local
│   ├── agents/                # custom routed roles (Mechanic, Bugtester, …)
│   ├── npm/
│   │   ├── package.json       # installed pi package manifest
│   │   └── package-lock.json  # installed pi package lockfile
│   ├── package.json           # editor-only devDependencies (see "Editor setup")
│   ├── tsconfig.json          # editor-only TS config (see "Editor setup")
│   ├── pi-hermes-memory/
│   │   └── skills/            # global reusable Pi skills (published)
│   ├── projects-memory/
│   │   └── <project>/skills/   # project-scoped reusable Pi skills (published)
│   ├── extensions/            # auto-discovered local extensions (*.ts)
│   │   ├── alarm-sound.ts
│   │   ├── pi-autoupdate.ts
│   │   ├── stargate-header.ts
│   │   └── token-speed.ts
│   └── themes/
│       └── stargate-sg1.json  # custom theme
```

Extensions placed in `~/.pi/agent/extensions/*.ts` are auto-discovered for all
projects and can be hot-reloaded with `/reload`.

## Local extensions

### `pi-autoupdate.ts`

Wraps Pi's own update mechanism so updates can be triggered from inside a
session (by you or by the model).

It delegates to the `pi` CLI rather than calling `npm` directly, because Pi
packages are not global npm installs — they live under `~/.pi/agent/npm/`,
`.pi/npm/`, and `~/.pi/agent/git/…` and are managed by `pi update`.

Command:

- `/update` — update Pi and all packages
- `/update self` — update Pi only
- `/update extensions` — update packages only
- `/update check` — report whether a Pi (self) update is available

Tool (`pi_update`, callable by the model):

- `scope`: `"all"` (default), `"self"`, or `"extensions"`
- `check`: only check the Pi version, don't install
- `confirm`: show a confirmation dialog (default: on in interactive mode)
- `force`: reinstall Pi even if current (only with `scope: "self"`)

Version-pinned npm specs and pinned git refs are skipped automatically by
`pi update`, so the extension does not special-case them.

On Windows, package updates pause pi-intercom's detached broker and hold its
respawn lock while npm replaces packages. Cancellation propagates through
network checks and child processes; the broker working-directory patch is
re-applied before the lock is released, including after partial failures or
user cancellation. It also preserves a Windows compatibility patch for
`pi-subagents`: async workflows use an independent UUID for their runtime
directory because Pi 0.84 tool-call IDs may contain the Windows-invalid `|`
character. The tracked `agent/npm/patches/postinstall.cjs` applies this fix
while Pi installs package dependencies, before the package is first loaded;
the update extension re-checks it at startup and after later updates.

#### Upstream-publish-bug resilience

Occasionally a package is published to npm with an unresolved `workspace:*`
dependency (a pnpm/yarn monorepo protocol that plain npm cannot resolve). When
that happens, `pi update`'s internal `npm install …@latest` fails with
`EUNSUPPORTEDPROTOCOL`, which aborts the **entire** package update — so one
broken upstream release blocks every other package too.

Before running `pi update`, the extension pre-flights the latest version of
each declared npm package against the public registry. Any package whose latest
version still carries a `workspace:` dependency is treated as "do not update":
the extension updates the remaining packages individually (`pi update
npm:<pkg>`) and skips the broken one, keeping its currently-installed (good)
version. This is self-healing — once the author publishes a fixed version the
pre-flight finds nothing broken and the normal bulk update resumes. The
pre-flight is fail-open (offline / custom-registry / errors never block
updates). It was added after `@xynogen/pix-optimizer@1.1.14` shipped
`"@xynogen/pix-data": "workspace:*"`.

### `stargate-header.ts`

Replaces the startup header with an open Stargate Command console banner
(chevron crown, rounded gate ring with an event-horizon beam, A-frame stand).
Width-adaptive and re-rendered live on theme, model, skill, and extension
changes.

Commands:

- `/header` — toggle between full and quiet mode
- `/refresh-header` — re-scan skills and extensions

### `token-speed.ts`

Custom footer showing context usage with a progress bar, measured generation
speed (tokens/second), the active thinking level, and estimated thinking and
output token counts, with the model and git branch right-aligned.

## Installed packages

Declared in `settings.json` (and/or user settings). See each package upstream
for details:

- `npm:pi-llama-cpp` — local llama.cpp provider integration
- `npm:pi-mcp-adapter` — MCP server adapter
- `npm:pi-web-access` — web access tools

The current installed package manifest is also tracked in
`agent/npm/package.json` / `agent/npm/package-lock.json` so the repository
reflects the package set managed by `pi update`.

## Heimdall sandbox and OS-local state

`agent/heimdall.json` is intentionally **not** tracked. Heimdall's sandbox uses
Linux `bubblewrap`, so the bundled `pi-autoupdate.ts` extension keeps the real
local config aligned with the current OS:

- Linux: `sandbox.enabled = true`
- Windows: `sandbox.enabled = false`
- macOS: `sandbox.enabled = false` until Heimdall supports a macOS sandbox

This prevents Windows/Linux/macOS checkouts from constantly dirtying Git with an
OS-specific config flip. `agent/heimdall.example.json` documents the portable
shape of the config.

Other local runtime files are ignored too, including generated Heimdall defaults,
`agent/models-store.json`, mission indexes, run history, intercom/session state,
SQLite lock databases (including WAL/SHM sidecars), Hermes memory databases, and
project `MEMORY.md` files. Credential files, private keys, certificates, tokens,
and environment files are excluded defensively as well.

## Published skills

Reusable Pi skills are intentionally tracked because they can help other users
even on different systems:

- `agent/pi-hermes-memory/skills/**/SKILL.md` — global skills
- `agent/projects-memory/*/skills/**/SKILL.md` — project-scoped skills

Only the skill files are published; private memory files and session databases
remain ignored.

## Theme

`stargate-sg1` — an amber/orange SGC terminal palette. Selected via
`"theme": "stargate-sg1"` in `settings.json`. The theme file references a
remote `$schema`; VS Code may warn that the schema URL is "untrusted" and skip
download. That is cosmetic and does not affect Pi, which validates themes
itself.

## Settings

Key fields in `agent/settings.json`:

- `defaultProvider` / `defaultModel` — the provider and model used on startup
- `packages` — installed pi packages
- `theme` — active theme name
- `compaction` — context compaction thresholds
- `thinkingBudgets` / `defaultThinkingLevel` — reasoning token budgets per level
- `subagents` — central role-to-model routing and local fallback policy

### Subagent model hierarchy

The parent orchestrator stays on GPT-5.6 Sol High. Child roles use the cheapest
appropriate tier without per-run model overrides:

| Tier | Intended work | Roles |
| --- | --- | --- |
| GPT-5.3 Codex Spark Low (128k) | Mechanical repo scans, targeted reproductions, tiny obvious fixes | `scout`, `context-builder`, `delegate`, `bugtester`, `mechanic` |
| GPT-5.6 Luna Low | Lightweight non-mechanical evidence synthesis | `web-searcher` |
| GPT-5.6 Terra Low | Substantial implementation and research | `worker`, `researcher` |
| GPT-5.6 Sol High | Leadership, planning, critical review, architecture judgment | `teamleiter`, `advisor`, `oracle`, `planner`, `reviewer` |

Spark is also the subagent default, so unclassified roles do not silently inherit
the expensive parent model. Every configured role falls back only to the stable
local llama-server alias at `http://127.0.0.1:1234/local`. Tasks that may exceed
Spark's 128k window or require non-mechanical judgment must be escalated upward.

## Editor setup

Out of the box, opening this folder in VS Code shows errors such as
`Cannot find module '@earendil-works/pi-coding-agent'`, `Cannot find name
'process'`, and several "implicitly has an 'any' type" warnings.

These are editor-only. Pi loads extensions through
[jiti](https://github.com/unjs/jiti), which resolves TypeScript and the pi
packages at runtime with its own bundled copies — the extensions run fine
regardless of what the editor reports.

To give the TypeScript language server the types it needs, install the
editor-only dependencies once:

```bash
cd ~/.pi/agent
npm install
```

On Windows:

```bat
cd %USERPROFILE%\.pi\agent
npm install
```

This installs `@types/node` (fixes `process` and `node:*`), the pi packages
(`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`,
`@earendil-works/pi-ai`), the modern `typebox` package, and TypeScript. The
`tsconfig.json` ties it together. Once types resolve, the implicit-any errors
disappear too, because the callback parameter types are inferred from the pi
API.

For a clean checkout, also restore the tracked Pi runtime manifest; its
postinstall hook applies required package compatibility patches before loading:

```bash
npm --prefix npm install
```

Validate both the local extensions and runtime dependency set with:

```bash
npm run typecheck
npm test
npm audit --omit=dev
npm --prefix npm audit --omit=dev
```

These are `devDependencies` and are not used by Pi at runtime. If you prefer not
to add a local `node_modules`, the errors are safe to ignore.

## Updating

Update everything (Pi and packages) from a shell:

```bash
pi update --all
```

Or from inside a session with the bundled command:

```text
/update
```
