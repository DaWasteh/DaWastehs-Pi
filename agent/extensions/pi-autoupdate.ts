/**
 * pi-autoupdate – Update extension for pi
 *
 * Provides:
 *  - Tool: `pi_update` (callable by the LLM) – updates pi and/or its packages
 *  - Command: `/update` (manual invocation) – same, from inside the TUI
 *
 * Why this delegates to the `pi` CLI instead of calling npm directly
 * ------------------------------------------------------------------
 * Pi has its *own* package manager. Pi packages are NOT global npm installs:
 * npm-sourced packages live under `~/.pi/agent/npm/` (user) or `.pi/npm/`
 * (project), git packages under `~/.pi/agent/git/…`, and pi also supports local
 * paths. A plain `npm outdated -g` / `npm install -g` therefore can neither see
 * nor update them — which is exactly why the previous version reported
 * "extensions current" while pi's own banner said an update was available.
 *
 * Pi already exposes the correct operation as a CLI subcommand:
 *   pi update                 → update pi, update packages, reconcile git refs
 *   pi update --extensions    → update packages + reconcile git refs only
 *   pi update --self          → update pi only
 *   pi update --self --force  → reinstall pi even if current
 *   pi update npm:@scope/pkg  → update a single package
 * Version-pinned npm specs and pinned git refs are skipped automatically, so we
 * no longer need to reason about pins ourselves.
 *
 * This extension is a thin, correct wrapper around those commands: it lets the
 * model trigger updates (`pi_update` tool) and adds a `/update` slash command in
 * the TUI, with a confirmation step. Pi already prints its own "updates
 * available" notice at startup, so this extension intentionally does NOT add a
 * second startup check.
 *
 * Windows note: the `pi` entry point on PATH is `pi.cmd`, a batch shim. Since
 * the Node fix for CVE-2024-27980, spawning a `.cmd`/`.bat` without a shell is
 * rejected with EINVAL. We therefore route through `cmd.exe /d /s /c pi …`
 * (cmd.exe is a real executable), exactly like cross-spawn does.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";

/** What to update. Maps directly onto `pi update` flags. */
type UpdateScope = "all" | "self" | "extensions";

export default function (pi: ExtensionAPI) {
  /* ────────────────────────────────────────────
   * Self-version check (used only for the non-mutating `check` mode and for
   * the confirmation text). The actual update is always done by `pi update`.
   * ──────────────────────────────────────────── */

  /** Compare semver strings. Returns 0 (equal), -1 (a < b), 1 (a > b). */
  function compareSemver(a: string, b: string): number {
    const strip = (s: string) => s.replace(/^v/, "").trim();
    const pa = strip(a).split(".").map(Number);
    const pb = strip(b).split(".").map(Number);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
      const va = pa[i] ?? 0;
      const vb = pb[i] ?? 0;
      if (va !== vb) return va < vb ? -1 : 1;
    }
    return 0;
  }

  /** Fetch the latest published pi version from pi.dev. */
  async function fetchLatestVersion(): Promise<string | null> {
    try {
      const res = await fetch(LATEST_VERSION_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const json = (await res.json()) as { version?: string };
      return json.version ?? null;
    } catch {
      return null;
    }
  }

  /** Check whether a pi (self) update is available. */
  async function checkSelfUpdate(): Promise<{
    available: boolean;
    current: string | null;
    latest: string | null;
  }> {
    const current = VERSION || null;
    const latest = await fetchLatestVersion();
    if (!latest) return { available: false, current, latest: null };
    if (!current) return { available: true, current: null, latest };
    return { available: compareSemver(current, latest) < 0, current, latest };
  }

  /* ────────────────────────────────────────────
   * pi CLI runner (Windows-safe)
   * ──────────────────────────────────────────── */

  /**
   * Build a platform-appropriate invocation of the `pi` CLI. On Windows the
   * entry point on PATH is `pi.cmd`; modern Node refuses to spawn a `.cmd`
   * without a shell (EINVAL since CVE-2024-27980), so we route through
   * `cmd.exe`, which resolves `pi` from PATH in its own context. The argument
   * vector (`update`, `--self`, `npm:@scope/pkg`, …) contains no spaces or cmd
   * metacharacters, so no extra quoting is required.
   */
  function buildPiCommand(piArgs: string[]): { command: string; args: string[] } {
    if (process.platform === "win32") {
      const comspec = process.env.ComSpec || "cmd.exe";
      // /d: skip AutoRun, /s: keep quoting rules simple, /c: run then terminate.
      return { command: comspec, args: ["/d", "/s", "/c", "pi", ...piArgs] };
    }
    return { command: "pi", args: piArgs };
  }

  /** Translate a scope (+ optional force) into `pi update` arguments. */
  function updateArgs(scope: UpdateScope, force: boolean): string[] {
    const args = ["update"];
    if (scope === "self") {
      args.push("--self");
      if (force) args.push("--force");
    } else if (scope === "extensions") {
      args.push("--extensions");
    }
    // scope === "all" → bare `pi update` (pi + packages + git reconcile).
    return args;
  }

  /** A short, human label for a scope. */
  function scopeLabel(scope: UpdateScope): string {
    return scope === "self" ? "pi" : scope === "extensions" ? "packages" : "pi + packages";
  }

  /** Run `pi <args…>` and capture the result. */
  async function runPi(
    piArgs: string[],
    timeoutMs = 300_000,
  ): Promise<{ success: boolean; output: string }> {
    const { command, args } = buildPiCommand(piArgs);
    try {
      const result = await pi.exec(command, args, { timeout: timeoutMs });
      const stdout = (result as any).stdout ?? "";
      const stderr = (result as any).stderr ?? "";
      const exitCode = (result as any).code ?? 0;
      let output = (stdout + "\n" + stderr).trim();

      if (exitCode !== 0 && process.platform === "win32") {
        if (output.includes("EBUSY") || output.includes("EPERM") || output.includes("locked")) {
          output +=
            `\n\nHint: on Windows, updating a package (or pi itself) that is in use can fail with a ` +
            `file lock. Close all instances of pi and run \`${["pi", ...piArgs].join(" ")}\` again ` +
            `from a fresh terminal (as Administrator if needed).`;
        }
      }
      return { success: exitCode === 0, output: String(output).slice(0, 4000) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        output:
          `Could not launch the \`pi\` CLI (${msg}).\n\n` +
          `This extension shells out to \`pi update\`, so \`pi\` must be on PATH. ` +
          `Try running \`${["pi", ...piArgs].join(" ")}\` manually.`,
      };
    }
  }

  /* ────────────────────────────────────────────
   * Tool: pi_update
   * ──────────────────────────────────────────── */

  pi.registerTool({
    name: "pi_update",
    label: "Pi Update",
    description:
      "Update pi and/or its installed packages (extensions, skills, prompts, themes) via the pi CLI. " +
      "`scope` selects what to update: 'all' (default) updates pi and packages, 'self' only pi, " +
      "'extensions' only packages. `check=true` reports whether a pi update is available without " +
      "installing (package update availability is surfaced by pi at startup; there is no dry-run for it). " +
      "`confirm=false` skips the confirmation dialog. `force` reinstalls pi even if current (scope 'self' only).",
    parameters: Type.Object({
      scope: Type.Optional(
        Type.Union([Type.Literal("all"), Type.Literal("self"), Type.Literal("extensions")], {
          description: "What to update. Default: 'all'.",
        }),
      ),
      check: Type.Optional(
        Type.Boolean({ description: "Only check (pi self only); don't install. Default: false." }),
      ),
      confirm: Type.Optional(
        Type.Boolean({
          description: "Skip confirmation dialog. Default: true (interactive) / false (non-interactive).",
        }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Reinstall pi even if current. Only with scope 'self'. Default: false." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const scope: UpdateScope = params.scope ?? "all";
      const checkOnly = params.check ?? false;
      const force = (params.force ?? false) && scope === "self";
      const shouldConfirm = params.confirm ?? ctx.hasUI;

      // ── Check-only ───────────────────────────────────────────────────────
      // We can only reliably dry-check pi itself (via pi.dev). Package update
      // availability has no documented dry-run; pi already reports it at startup.
      if (checkOnly) {
        const self = await checkSelfUpdate();
        const piLine = !self.latest
          ? "⚠️  Could not reach pi.dev to check pi."
          : self.available
            ? `🔄 Pi update available: ${self.current ?? "unknown"} → ${self.latest}`
            : `✅ Pi is up to date (${self.latest}).`;
        const extLine =
          scope === "self"
            ? ""
            : "\n\nℹ️  Package updates have no dry-run. Pi shows them at startup; " +
              "run `pi_update({ scope: \"extensions\" })` (or `/update extensions`) to apply.";
        return {
          content: [{ type: "text", text: piLine + extLine }],
          details: { self: { current: self.current, latest: self.latest } },
        };
      }

      // ── Confirm ────────────────────────────────────────────────────────────
      const args = updateArgs(scope, force);
      if (shouldConfirm) {
        const self = scope === "extensions" ? null : await checkSelfUpdate();
        const piHint =
          self && self.latest
            ? self.available
              ? `\n\npi: ${self.current ?? "unknown"} → ${self.latest}`
              : `\n\npi is current (${self.latest})${force ? "; will reinstall (--force)" : ""}`
            : "";
        const confirmed = await ctx.ui.confirm(
          "Pi Update",
          `Update ${scopeLabel(scope)}?\n\nThis runs: ${["pi", ...args].join(" ")}` +
            `${scope !== "self" ? "\n\nPi will update outdated packages and reconcile pinned git refs." : ""}` +
            piHint,
        );
        if (!confirmed) {
          return { content: [{ type: "text", text: "❌ Update cancelled by user." }], details: {} };
        }
      }

      // ── Run ──────────────────────────────────────────────────────────────
      ctx.ui.setStatus("pi-update", `Updating ${scopeLabel(scope)}…`);
      const result = await runPi(args);
      ctx.ui.setStatus("pi-update", result.success ? "Update complete!" : "Update failed!");

      const body = result.output || "(no output)";

      if (!result.success) {
        // Per the current extension API, only a thrown error is flagged as an
        // error to the model; a returned `isError` is not. Throw so failures are
        // reported correctly, while still surfacing pi's full output.
        throw new Error(`Pi update failed (\`${["pi", ...args].join(" ")}\`):\n\n${body.slice(0, 3000)}`);
      }

      return {
        content: [{
          type: "text",
          text: `✅ Update finished (\`${["pi", ...args].join(" ")}\`):\n\n${body}\n\nRestart pi to load any new versions.`,
        }],
        details: {},
      };
    },
  });

  /* ────────────────────────────────────────────
   * Command: /update
   *   /update                  → pi + packages
   *   /update self             → pi only
   *   /update extensions       → packages only
   *   /update check            → check pi (self) only, no install
   * ──────────────────────────────────────────── */

  pi.registerCommand("update", {
    description: "Update pi and/or packages. Usage: /update [self|extensions|check]",
    handler: async (_args, ctx) => {
      const argStr = (Array.isArray(_args) ? _args.join(" ") : String(_args ?? "")).trim().toLowerCase();

      if (argStr === "check") {
        const self = await checkSelfUpdate();
        if (!self.latest) {
          ctx.ui.notify("Could not check pi version. Check your internet connection.", "error");
        } else if (self.available) {
          ctx.ui.notify(`🔄 Pi update available: ${self.current ?? "unknown"} → ${self.latest}`, "info");
        } else {
          ctx.ui.notify(`✅ Pi is up to date (${self.latest}). For packages, run /update extensions.`, "info");
        }
        return;
      }

      const scope: UpdateScope =
        argStr === "self" ? "self" : argStr === "extensions" || argStr === "ext" ? "extensions" : "all";
      const args = updateArgs(scope, false);

      const confirmed = await ctx.ui.confirm(
        "Pi Update",
        `Update ${scopeLabel(scope)} now?\n\nRuns: ${["pi", ...args].join(" ")}`,
      );
      if (!confirmed) {
        ctx.ui.notify("Update cancelled.", "info");
        return;
      }

      ctx.ui.setStatus("pi-update", `Updating ${scopeLabel(scope)}…`);
      const result = await runPi(args);
      ctx.ui.setStatus("pi-update", result.success ? "Done!" : "Failed!");

      if (result.success) {
        ctx.ui.notify(`✅ Update finished. Restart pi to load new versions.`, "info");
      } else {
        ctx.ui.notify(`❌ Update failed:\n${result.output.slice(0, 1200)}`, "error");
      }
    },
  });
}
