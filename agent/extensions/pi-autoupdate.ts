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
 * Pi already exposes the correct operations as CLI subcommands:
 *   pi update --all           → update pi, update packages, reconcile git refs
 *   pi update                 → update pi only
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
import { getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type } from "typebox";

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const LLAMA_CPP_PACKAGE_NAME = "pi-llama-cpp";
const LLAMA_SERVER_URL = "http://127.0.0.1:1234";
const HERMES_MEMORY_PACKAGE_NAME = "pi-hermes-memory";
const PIX_OPTIMIZER_PACKAGE_PATH = ["@xynogen", "pix-optimizer"];
const PIX_PRETTY_PACKAGE_PATH = ["@xynogen", "pix-pretty"];

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
    } else if (scope === "all") {
      args.push("--all");
    }
    return args;
  }

  /** A short, human label for a scope. */
  function scopeLabel(scope: UpdateScope): string {
    return scope === "self" ? "pi" : scope === "extensions" ? "packages" : "pi + packages";
  }

  /** Read a JSON object from disk. Missing files are treated as empty objects. */
  async function readJsonObject(path: string): Promise<Record<string, unknown>> {
    try {
      const raw = await readFile(path, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return {};
      throw err;
    }
  }

  /** Keep Pi's global llama.cpp server setting on LM Studio's OpenAI-compatible port. */
  async function ensureGlobalLlamaServerUrl(): Promise<string> {
    const settingsPath = join(getAgentDir(), "settings.json");
    const settings = await readJsonObject(settingsPath);

    if (settings.llamaServerUrl === LLAMA_SERVER_URL) {
      return `✅ Global llamaServerUrl already set to ${LLAMA_SERVER_URL}.`;
    }

    settings.llamaServerUrl = LLAMA_SERVER_URL;
    await mkdir(dirname(settingsPath), { recursive: true });
    await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
    return `✅ Set global llamaServerUrl to ${LLAMA_SERVER_URL}.`;
  }

  /** Candidate pi-llama-cpp package roots that may have been refreshed by `pi update`. */
  function llamaCppPackageRoots(cwd: string): string[] {
    const roots = [
      join(getAgentDir(), "npm", "node_modules", LLAMA_CPP_PACKAGE_NAME),
      join(cwd, ".pi", "npm", "node_modules", LLAMA_CPP_PACKAGE_NAME),
    ];
    return [...new Set(roots)];
  }

  /** Re-apply the local pi-llama-cpp fallback-port patch that package updates overwrite. */
  async function patchLlamaCppDefaultUrl(packageRoot: string): Promise<{ found: boolean; ok: boolean; message?: string }> {
    const constantsPath = join(packageRoot, "src", "constants.ts");

    let source: string;
    try {
      source = await readFile(constantsPath, "utf8");
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return { found: false, ok: true };
      return {
        found: true,
        ok: false,
        message: `⚠️ Could not read ${constantsPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const targetLine = `export const DEFAULT_LLAMA_SERVER_URL = "${LLAMA_SERVER_URL}";`;
    const defaultUrlPattern = /export const DEFAULT_LLAMA_SERVER_URL\s*=\s*["']http:\/\/127\.0\.0\.1:\d+["'];/;

    if (!defaultUrlPattern.test(source)) {
      return {
        found: true,
        ok: false,
        message: `⚠️ Could not find DEFAULT_LLAMA_SERVER_URL in ${constantsPath}.`,
      };
    }

    const next = source.replace(defaultUrlPattern, targetLine);
    if (next === source) {
      return { found: true, ok: true, message: `✅ ${LLAMA_CPP_PACKAGE_NAME} fallback already uses ${LLAMA_SERVER_URL}.` };
    }

    try {
      await writeFile(constantsPath, next, "utf8");
      return { found: true, ok: true, message: `✅ Patched ${constantsPath} to ${LLAMA_SERVER_URL}.` };
    } catch (err: unknown) {
      return {
        found: true,
        ok: false,
        message: `⚠️ Could not write ${constantsPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /** Reset llama.cpp/LM Studio integration to port 1234 after package updates. */
  async function ensureLlamaCppPort1234(cwd: string): Promise<{ ok: boolean; text: string }> {
    const messages: string[] = [];
    let ok = true;

    try {
      messages.push(await ensureGlobalLlamaServerUrl());
    } catch (err: unknown) {
      ok = false;
      messages.push(`⚠️ Could not set global llamaServerUrl: ${err instanceof Error ? err.message : String(err)}`);
    }

    let foundPackage = false;
    for (const root of llamaCppPackageRoots(cwd)) {
      const patch = await patchLlamaCppDefaultUrl(root);
      if (!patch.found) continue;
      foundPackage = true;
      if (!patch.ok) ok = false;
      if (patch.message) messages.push(patch.message);
    }

    if (!foundPackage) {
      messages.push(`ℹ️ ${LLAMA_CPP_PACKAGE_NAME} was not found in global/project npm packages.`);
    }

    return { ok, text: messages.join("\n") };
  }

  function piNpmRoots(cwd: string): string[] {
    const roots = [
      join(getAgentDir(), "npm"),
      join(cwd, ".pi", "npm"),
    ];
    return [...new Set(roots)];
  }

  function pixOptimizerPackageRoots(cwd: string): string[] {
    return piNpmRoots(cwd).map((root) => join(root, "node_modules", ...PIX_OPTIMIZER_PACKAGE_PATH));
  }

  function pixPrettyPackageRoot(npmRoot: string): string {
    return join(npmRoot, "node_modules", ...PIX_PRETTY_PACKAGE_PATH);
  }

  async function fileExists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch {
      return false;
    }
  }

  function buildNpmCommand(npmArgs: string[]): { command: string; args: string[] } {
    if (process.platform === "win32") {
      const comspec = process.env.ComSpec || "cmd.exe";
      return { command: comspec, args: ["/d", "/s", "/c", "npm", ...npmArgs] };
    }
    return { command: "npm", args: npmArgs };
  }

  async function runNpm(
    npmRoot: string,
    npmArgs: string[],
    timeoutMs = 180_000,
  ): Promise<{ success: boolean; output: string }> {
    const { command, args } = buildNpmCommand(npmArgs);
    try {
      const result = await pi.exec(command, args, { cwd: npmRoot, timeout: timeoutMs });
      const stdout = (result as any).stdout ?? "";
      const stderr = (result as any).stderr ?? "";
      const exitCode = (result as any).code ?? 0;
      const output = (stdout + "\n" + stderr).trim();
      return { success: exitCode === 0, output: String(output).slice(0, 4000) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Could not launch npm in ${npmRoot}: ${msg}` };
    }
  }

  async function pixPrettyIconCatalogStatus(packageRoot: string): Promise<{
    found: boolean;
    ok: boolean;
    version?: string;
    message?: string;
  }> {
    const packageJsonPath = join(packageRoot, "package.json");

    let pkg: Record<string, unknown>;
    try {
      const raw = await readFile(packageJsonPath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { found: true, ok: false, message: `Invalid package.json at ${packageJsonPath}.` };
      }
      pkg = parsed as Record<string, unknown>;
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return { found: false, ok: false };
      return {
        found: true,
        ok: false,
        message: `Could not read ${packageJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const version = typeof pkg.version === "string" ? pkg.version : "unknown";
    const exportsValue = pkg.exports;
    const hasIconCatalogExport =
      !!exportsValue &&
      typeof exportsValue === "object" &&
      !Array.isArray(exportsValue) &&
      Object.prototype.hasOwnProperty.call(exportsValue, "./icon-catalog");
    const hasIconCatalogFile = await fileExists(join(packageRoot, "src", "icon-catalog.ts"));

    return {
      found: true,
      ok: hasIconCatalogExport && hasIconCatalogFile,
      version,
      message: !hasIconCatalogExport
        ? `@xynogen/pix-pretty ${version} does not export ./icon-catalog.`
        : !hasIconCatalogFile
          ? `@xynogen/pix-pretty ${version} exports ./icon-catalog, but src/icon-catalog.ts is missing.`
          : undefined,
    };
  }

  async function ensurePixPrettyIconCatalog(cwd: string): Promise<{ ok: boolean; text: string }> {
    const messages: string[] = [];
    let ok = true;
    let foundRelevantRoot = false;

    for (const npmRoot of piNpmRoots(cwd)) {
      if (!(await fileExists(join(npmRoot, "package.json")))) continue;

      const optimizerRoot = join(npmRoot, "node_modules", ...PIX_OPTIMIZER_PACKAGE_PATH);
      const prettyRoot = pixPrettyPackageRoot(npmRoot);
      const hasOptimizer = await fileExists(join(optimizerRoot, "package.json"));
      const before = await pixPrettyIconCatalogStatus(prettyRoot);

      if (!hasOptimizer && !before.found) continue;
      foundRelevantRoot = true;

      if (before.ok) {
        messages.push(`✅ @xynogen/pix-pretty ${before.version} already exposes ./icon-catalog in ${npmRoot}.`);
        continue;
      }

      const reason = before.message ?? "@xynogen/pix-pretty is not installed.";
      const update = await runNpm(npmRoot, ["update", "@xynogen/pix-pretty", "--omit=dev"]);
      if (!update.success) {
        ok = false;
        messages.push(`⚠️ ${reason}\nCould not refresh @xynogen/pix-pretty in ${npmRoot}:\n${update.output}`);
        continue;
      }

      const after = await pixPrettyIconCatalogStatus(prettyRoot);
      if (after.ok) {
        messages.push(`✅ Refreshed @xynogen/pix-pretty to ${after.version} in ${npmRoot}; ./icon-catalog is available.`);
      } else {
        ok = false;
        messages.push(
          `⚠️ npm update ran in ${npmRoot}, but pix-optimizer compatibility is still broken: ${after.message ?? "@xynogen/pix-pretty is not installed."}`,
        );
      }
    }

    if (!foundRelevantRoot) messages.push("ℹ️ @xynogen/pix-pretty/@xynogen/pix-optimizer were not found in global/project npm packages.");
    return { ok, text: messages.join("\n") };
  }

  async function patchPixOptimizerRtk(packageRoot: string): Promise<{ found: boolean; ok: boolean; message?: string }> {
    const rtkPath = join(packageRoot, "src", "rtk.ts");
    const readmePath = join(packageRoot, "README.md");

    let source: string;
    try {
      source = await readFile(rtkPath, "utf8");
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return { found: false, ok: true };
      return { found: true, ok: false, message: `⚠️ Could not read ${rtkPath}: ${err instanceof Error ? err.message : String(err)}` };
    }

    const oldCheck = `	// Check if rtk binary is available
	const checkRtkAvailability = async (): Promise<RtkStatus> => {
		// Cache for 60 seconds
		if (rtkStatus && Date.now() - rtkStatus.checkedAt < 60000) {
			return rtkStatus;
		}

		try {
			const result = await pi.exec("which", ["rtk"], { timeout: 1000 });
			if (result.code === 0 && result.stdout?.trim()) {
				rtkStatus = {
					available: true,
					checkedAt: Date.now(),
					path: result.stdout.trim(),
				};
				warnedMissing = false;
				return rtkStatus;
			}
		} catch (_error) {
			// which command failed
		}

		rtkStatus = {
			available: false,
			checkedAt: Date.now(),
		};
		return rtkStatus;
	};`;
    const newCheck = `	// Check if rtk binary is available
	const checkRtkAvailability = async (): Promise<RtkStatus> => {
		// Cache for 60 seconds
		if (rtkStatus && Date.now() - rtkStatus.checkedAt < 60000) {
			return rtkStatus;
		}

		const markAvailable = (path = "rtk"): RtkStatus => {
			rtkStatus = {
				available: true,
				checkedAt: Date.now(),
				path,
			};
			warnedMissing = false;
			return rtkStatus;
		};

		try {
			const result = await pi.exec("rtk", ["--version"], { timeout: 1000 });
			if (result.code === 0) return markAvailable();
		} catch (_error) {
			// direct probe failed; fall back to PATH locator
		}

		try {
			const locator = process.platform === "win32" ? "where.exe" : "which";
			const result = await pi.exec(locator, ["rtk"], { timeout: 1000 });
			const path = result.stdout?.trim().split(/\\r?\\n/)[0];
			if (result.code === 0 && path) return markAvailable(path);
		} catch (_error) {
			// locator command failed
		}

		rtkStatus = {
			available: false,
			checkedAt: Date.now(),
		};
		return rtkStatus;
	};`;

    let next = source.includes(oldCheck) ? source.replace(oldCheck, newCheck) : source;
    next = next.replace(
      "rtk not found — RTK rewriting disabled. Install: cargo install rtk-ai",
      "rtk not found — RTK rewriting disabled. Install: cargo install --git https://github.com/rtk-ai/rtk",
    );

    if (!next.includes('pi.exec("rtk", ["--version"]') || !next.includes("cargo install --git https://github.com/rtk-ai/rtk")) {
      return { found: true, ok: false, message: `⚠️ Could not apply RTK availability patch in ${rtkPath}.` };
    }

    if (next !== source) await writeFile(rtkPath, next, "utf8");

    try {
      const readme = await readFile(readmePath, "utf8");
      const patchedReadme = readme.replace("cargo install rtk-ai", "cargo install --git https://github.com/rtk-ai/rtk");
      if (patchedReadme !== readme) await writeFile(readmePath, patchedReadme, "utf8");
    } catch {
      // README is documentation only; source patch above is the functional fix.
    }

    return { found: true, ok: true, message: `✅ Patched ${rtkPath} RTK probe + install hint.` };
  }

  async function ensurePixOptimizerRtkPatch(cwd: string): Promise<{ ok: boolean; text: string }> {
    const messages: string[] = [];
    let ok = true;
    let foundPackage = false;

    for (const root of pixOptimizerPackageRoots(cwd)) {
      const patch = await patchPixOptimizerRtk(root);
      if (!patch.found) continue;
      foundPackage = true;
      if (!patch.ok) ok = false;
      if (patch.message) messages.push(patch.message);
    }

    if (!foundPackage) messages.push("ℹ️ @xynogen/pix-optimizer was not found in global/project npm packages.");
    return { ok, text: messages.join("\n") };
  }

  function hermesMemoryPackageRoots(cwd: string): string[] {
    const roots = [
      join(getAgentDir(), "npm", "node_modules", HERMES_MEMORY_PACKAGE_NAME),
      join(cwd, ".pi", "npm", "node_modules", HERMES_MEMORY_PACKAGE_NAME),
    ];
    return [...new Set(roots)];
  }

  async function patchHermesBackfillWarning(packageRoot: string): Promise<{ found: boolean; ok: boolean; message?: string }> {
    const filePath = join(packageRoot, "src", "handlers", "session-backfill.ts");
    let source: string;
    try {
      source = await readFile(filePath, "utf8");
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return { found: false, ok: true };
      return { found: true, ok: false, message: `⚠️ Could not read ${filePath}: ${err instanceof Error ? err.message : String(err)}` };
    }

    const noisy = "notifyBestEffort(options.notify, formatBackfillResult(result), result.errors.length > 0 || result.reachedLimit ? 'warning' : 'info');";
    const quiet = "notifyBestEffort(options.notify, formatBackfillResult(result), result.errors.length > 0 ? 'warning' : 'info');";
    const next = source.replace(noisy, quiet);
    if (!next.includes(quiet)) return { found: true, ok: false, message: `⚠️ Could not apply backfill warning patch in ${filePath}.` };
    if (next !== source) await writeFile(filePath, next, "utf8");
    return { found: true, ok: true, message: `✅ Patched ${filePath} startup-limit notification to info.` };
  }

  async function ensureHermesBackfillPatch(cwd: string): Promise<{ ok: boolean; text: string }> {
    const messages: string[] = [];
    let ok = true;
    let foundPackage = false;

    for (const root of hermesMemoryPackageRoots(cwd)) {
      const patch = await patchHermesBackfillWarning(root);
      if (!patch.found) continue;
      foundPackage = true;
      if (!patch.ok) ok = false;
      if (patch.message) messages.push(patch.message);
    }

    if (!foundPackage) messages.push(`ℹ️ ${HERMES_MEMORY_PACKAGE_NAME} was not found in global/project npm packages.`);
    return { ok, text: messages.join("\n") };
  }

  async function ensurePostUpdatePackagePatches(cwd: string): Promise<{ ok: boolean; text: string }> {
    const llama = await ensureLlamaCppPort1234(cwd);
    const pixPretty = await ensurePixPrettyIconCatalog(cwd);
    const pix = await ensurePixOptimizerRtkPatch(cwd);
    const hermes = await ensureHermesBackfillPatch(cwd);
    return {
      ok: llama.ok && pixPretty.ok && pix.ok && hermes.ok,
      text: `${LLAMA_CPP_PACKAGE_NAME}:\n${llama.text}\n\n@xynogen/pix-pretty:\n${pixPretty.text}\n\n@xynogen/pix-optimizer:\n${pix.text}\n\n${HERMES_MEMORY_PACKAGE_NAME}:\n${hermes.text}`,
    };
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
      "'extensions' only packages. After package updates, pi-llama-cpp is reset to http://127.0.0.1:1234, @xynogen/pix-pretty is refreshed if pix-optimizer needs its icon catalog, and known overwritten local package patches are re-applied. " +
      "`check=true` reports whether a pi update is available without installing (package update availability is " +
      "surfaced by pi at startup; there is no dry-run for it). `confirm=false` skips the confirmation dialog. " +
      "`force` reinstalls pi even if current (scope 'self' only).",
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
            `${scope !== "self" ? `\nAfterwards, ${LLAMA_CPP_PACKAGE_NAME} will be reset to ${LLAMA_SERVER_URL}, pix-pretty/pix-optimizer compatibility will be checked, and known local patches re-applied.` : ""}` +
            piHint,
        );
        if (!confirmed) {
          return { content: [{ type: "text", text: "❌ Update cancelled by user." }], details: {} };
        }
      }

      // ── Run ──────────────────────────────────────────────────────────────
      ctx.ui.setStatus("pi-update", `Updating ${scopeLabel(scope)}…`);
      const result = await runPi(args);
      const postUpdate = scope !== "self" ? await ensurePostUpdatePackagePatches(ctx.cwd) : null;
      ctx.ui.setStatus(
        "pi-update",
        result.success ? (postUpdate && !postUpdate.ok ? "Update complete; post-update patch failed!" : "Update complete!") : "Update failed!",
      );

      const body = result.output || "(no output)";
      const postUpdateText = postUpdate ? `\n\nPost-update package fixes:\n${postUpdate.text}` : "";

      if (!result.success) {
        // Per the current extension API, only a thrown error is flagged as an
        // error to the model; a returned `isError` is not. Throw so failures are
        // reported correctly, while still surfacing pi's full output.
        throw new Error(`Pi update failed (\`${["pi", ...args].join(" ")}\`):\n\n${(body + postUpdateText).slice(0, 3000)}`);
      }

      return {
        content: [{
          type: "text",
          text: `✅ Update finished (\`${["pi", ...args].join(" ")}\`):\n\n${body}${postUpdateText}\n\nRestart pi to load any new versions.`,
        }],
        details: {},
      };
    },
  });

  /* ────────────────────────────────────────────
   * Command: /update
   *   /update                  → pi + packages (`pi update --all`)
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
        `Update ${scopeLabel(scope)} now?\n\nRuns: ${["pi", ...args].join(" ")}` +
          `${scope !== "self" ? `\n\nAfterwards, ${LLAMA_CPP_PACKAGE_NAME} will be reset to ${LLAMA_SERVER_URL}, pix-pretty/pix-optimizer compatibility will be checked, and known local patches re-applied.` : ""}`,
      );
      if (!confirmed) {
        ctx.ui.notify("Update cancelled.", "info");
        return;
      }

      ctx.ui.setStatus("pi-update", `Updating ${scopeLabel(scope)}…`);
      const result = await runPi(args);
      const postUpdate = scope !== "self" ? await ensurePostUpdatePackagePatches(ctx.cwd) : null;
      ctx.ui.setStatus(
        "pi-update",
        result.success ? (postUpdate && !postUpdate.ok ? "Done; post-update patch failed!" : "Done!") : "Failed!",
      );

      const postUpdateText = postUpdate ? `\n\n${postUpdate.text}` : "";
      if (result.success) {
        ctx.ui.notify(`✅ Update finished.${postUpdateText}\n\nRestart pi to load new versions.`, postUpdate && !postUpdate.ok ? "warning" : "info");
      } else {
        ctx.ui.notify(`❌ Update failed:\n${(result.output + postUpdateText).slice(0, 1200)}`, "error");
      }
    },
  });
}
