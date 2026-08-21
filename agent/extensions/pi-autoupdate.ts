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
 * the TUI. Explicit natural-language update requests and slash commands are
 * treated as authority; unrequested model updates fail closed without a
 * technical confirmation popup. Pi already prints its own "updates available"
 * notice at startup, so this extension intentionally does NOT add a second
 * startup check.
 *
 * Windows note: the `pi` entry point on PATH is `pi.cmd`, a batch shim. Since
 * the Node fix for CVE-2024-27980, spawning a `.cmd`/`.bat` without a shell is
 * rejected with EINVAL. We therefore route through `cmd.exe /d /s /c pi …`
 * (cmd.exe is a real executable), exactly like cross-spawn does.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getAgentDir, VERSION } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, readFileSync, writeSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type } from "typebox";

const LATEST_VERSION_URL = "https://pi.dev/api/latest-version";
const LLAMA_CPP_PACKAGE_NAME = "pi-llama-cpp";
const LLAMA_SERVER_URL = "http://127.0.0.1:1234";
const HERMES_MEMORY_PACKAGE_NAME = "pi-hermes-memory";
const HEIMDALL_PACKAGE_NAME = "@casualjim/pi-heimdall";
const PI_INTERCOM_PACKAGE_NAME = "pi-intercom";
const PI_SUBAGENTS_PACKAGE_NAME = "pi-subagents";
const INTERCOM_BROKER_CWD_LINE = "cwd: getIntercomDirPath(),";
const INTERCOM_SPAWN_LOCK_HEARTBEAT_MS = 2_000;
const INTERCOM_SPAWN_LOCK_STALE_MS = 10_000;
const PIX_OPTIMIZER_PACKAGE_PATH = ["@xynogen", "pix-optimizer"];
const PIX_PRETTY_PACKAGE_PATH = ["@xynogen", "pix-pretty"];

/** What to update. Maps directly onto `pi update` flags. */
type UpdateScope = "all" | "self" | "extensions";

export interface PiUpdateAuthorization {
  scope: UpdateScope;
  force: boolean;
}

export function parsePiUpdateAuthorization(value: string): PiUpdateAuthorization | null {
  const unquoted = value.replace(/"[^"\n]*"|`[^`\n]*`|‘[^’\n]*’|'[^'\n]{2,}'/g, " ");
  const actionPattern = /\b(?:update|upgrade|refresh|reinstall|aktualisier(?:en|e|t)|updat(?:en|e|et)|neu\s+installier(?:en|e|t))\b/i;
  const directCue = /^(?:please\b|bitte\b|can\s+you\b|could\s+you\b|kannst\s+du\b|können\s+wir\b|ich\s+möchte(?:,?\s+dass\s+du)?\b|i\s+want\s+you\s+to\b)/i;
  const metaLead = /^(?:repeat|quote|explain|document|analy[sz]e|discuss|describe|should\s+i|erklär\w*|dokumentier\w*|analysier\w*|diskutier\w*|beschreib\w*|wiederhol\w*|zitiere?\b)/i;
  const clause = unquoted.split(/[.!?\n;]+/).map((part) => part.trim()).find((part) => {
    const withoutPolitePrefix = part.replace(/^(?:please|bitte|can\s+you|could\s+you|kannst\s+du|können\s+wir)\s+/i, "");
    if (!part || metaLead.test(withoutPolitePrefix)) return false;
    actionPattern.lastIndex = 0;
    return actionPattern.test(part) && (directCue.test(part) || actionPattern.exec(withoutPolitePrefix)?.index === 0);
  });
  if (!clause) return null;
  const negatedAction = /\b(?:do\s+not|don['’]?t|not|never|without|nicht|niemals|kein(?:e|en|er|es)?|ohne|weder|refuse\s+to)\b[^,]{0,60}\b(?:update|upgrade|refresh|reinstall|aktualisier(?:en|e|t)|updat(?:en|e|et)|neu\s+installier(?:en|e|t))\b/i.test(clause);
  if (negatedAction) return null;
  const excludesPi = /\b(?:no|not|without|except|excluding|skip|nicht|ohne|außer|kein(?:e|en|er|es)?)\s+pi\b/i.test(clause);
  const excludesExtensions = /\b(?:no|not|without|except|excluding|skip|nicht|ohne|außer|kein(?:e|en|er|es)?)\s+(?:packages?|pakete?|extensions?|erweiterungen?|plugins?)\b/i.test(clause);
  const hasPi = !excludesPi && /\bpi\b/i.test(clause);
  const hasExtensions = !excludesExtensions && /\b(?:packages?|pakete?|extensions?|erweiterungen?|plugins?)\b/i.test(clause);
  if (!hasPi && !hasExtensions) return null;
  const forceNegated = /\b(?:do\s+not|don['’]?t|no|not|without|except|excluding|skip|nicht|ohne|außer|kein(?:e|en|er|es)?)\b[^,]{0,24}\b(?:force|forced|reinstall|erzwingen)\b/i.test(clause);
  return {
    scope: hasPi && hasExtensions ? "all" : hasExtensions ? "extensions" : "self",
    force: !forceNegated && /\b(?:force|forced|reinstall|neu\s+installier(?:en|e|t)|erzwingen)\b/i.test(clause),
  };
}

export function hasExplicitPiUpdateIntent(value: string): boolean {
  return parsePiUpdateAuthorization(value) !== null;
}

export function updateAuthorizationAllows(
  authorization: PiUpdateAuthorization | null,
  scope: UpdateScope,
  force: boolean,
): boolean {
  const scopeAllowed = authorization?.scope === "all" || authorization?.scope === scope;
  return !!authorization && scopeAllowed && (!force || authorization.force);
}

export default async function (pi: ExtensionAPI) {
  let pendingUpdateAuthorization: PiUpdateAuthorization | null = null;
  pi.on("input", async (event) => {
    if (event.source !== "extension") pendingUpdateAuthorization = parsePiUpdateAuthorization(event.text);
    return { action: "continue" };
  });
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

  function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timeout = AbortSignal.timeout(timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /** Fetch the latest published pi version from pi.dev. */
  async function fetchLatestVersion(signal?: AbortSignal): Promise<string | null> {
    try {
      const res = await fetch(LATEST_VERSION_URL, { signal: withTimeout(signal, 10_000) });
      if (!res.ok) return null;
      const json = (await res.json()) as { version?: string };
      return json.version ?? null;
    } catch {
      signal?.throwIfAborted();
      return null;
    }
  }

  /** Check whether a pi (self) update is available. */
  async function checkSelfUpdate(signal?: AbortSignal): Promise<{
    available: boolean;
    current: string | null;
    latest: string | null;
  }> {
    const current = VERSION || null;
    const latest = await fetchLatestVersion(signal);
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

  function piIntercomPackageRoots(cwd: string): string[] {
    return piNpmRoots(cwd).map((root) => join(root, "node_modules", PI_INTERCOM_PACKAGE_NAME));
  }

  function piSubagentsPackageRoots(cwd: string): string[] {
    return piNpmRoots(cwd).map((root) => join(root, "node_modules", PI_SUBAGENTS_PACKAGE_NAME));
  }

  /**
   * Pi 0.84 tool-call ids may contain `|`, which is illegal in Windows path
   * components. pi-subagents 0.43 used that id directly as an async workflow
   * directory name. Give workflows their own UUID, as ordinary async runs do.
   */
  async function patchPiSubagentsAsyncWorkflowId(
    packageRoot: string,
  ): Promise<{ found: boolean; ok: boolean; message?: string }> {
    const executorPath = join(packageRoot, "src", "runs", "foreground", "subagent-executor.ts");
    let source: string;
    try {
      source = await readFile(executorPath, "utf8");
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return { found: false, ok: true };
      return {
        found: true,
        ok: false,
        message: `⚠️ Could not read ${executorPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (/const workflowRunId\s*=\s*randomUUID\(\);/.test(source)) {
      return { found: true, ok: true, message: `✅ ${PI_SUBAGENTS_PACKAGE_NAME} async workflow IDs are filesystem-safe.` };
    }
    if (!source.includes("const workflowRunId = _id;")) {
      return {
        found: true,
        ok: false,
        message: `⚠️ Could not find the async workflow ID assignment in ${executorPath}.`,
      };
    }

    const next = source.replace(
      "const workflowRunId = _id;",
      "const workflowRunId = randomUUID(); // Filesystem-safe on Windows; tool-call ids may contain `|`.",
    );
    await writeFile(executorPath, next, "utf8");
    return { found: true, ok: true, message: `✅ Patched ${executorPath} to use filesystem-safe async workflow IDs.` };
  }

  async function ensurePiSubagentsAsyncWorkflowIdPatch(cwd: string): Promise<{ ok: boolean; text: string }> {
    const messages: string[] = [];
    let ok = true;
    let foundPackage = false;
    for (const root of piSubagentsPackageRoots(cwd)) {
      const patch = await patchPiSubagentsAsyncWorkflowId(root);
      if (!patch.found) continue;
      foundPackage = true;
      if (!patch.ok) ok = false;
      if (patch.message) messages.push(patch.message);
    }
    if (!foundPackage) messages.push(`ℹ️ ${PI_SUBAGENTS_PACKAGE_NAME} was not found in global/project npm packages.`);
    return { ok, text: messages.join("\n") };
  }

  /**
   * Keep pi-intercom's detached broker working directory outside node_modules.
   * On Windows a process whose cwd is inside a package prevents npm from
   * renaming that package directory (EBUSY). The broker uses absolute script
   * paths, so the runtime directory is the correct, update-safe cwd.
   */
  async function patchPiIntercomBrokerCwd(
    packageRoot: string,
  ): Promise<{ found: boolean; ok: boolean; message?: string }> {
    const spawnPath = join(packageRoot, "broker", "spawn.ts");
    let source: string;
    try {
      source = await readFile(spawnPath, "utf8");
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return { found: false, ok: true };
      return {
        found: true,
        ok: false,
        message: `⚠️ Could not read ${spawnPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (source.includes(INTERCOM_BROKER_CWD_LINE)) {
      return {
        found: true,
        ok: true,
        message: `✅ ${PI_INTERCOM_PACKAGE_NAME} broker already uses the update-safe runtime cwd.`,
      };
    }

    const packageCwdPattern = /cwd:\s*extensionDir,/;
    if (!packageCwdPattern.test(source) || !source.includes("getIntercomDirPath")) {
      return {
        found: true,
        ok: false,
        message: `⚠️ Could not find pi-intercom's broker cwd assignment in ${spawnPath}.`,
      };
    }

    const next = source.replace(
      packageCwdPattern,
      `${INTERCOM_BROKER_CWD_LINE} // Do not lock this package directory on Windows.`,
    );
    await writeFile(spawnPath, next, "utf8");
    return {
      found: true,
      ok: true,
      message: `✅ Patched ${spawnPath} so the detached broker no longer locks node_modules.`,
    };
  }

  async function ensurePiIntercomBrokerCwdPatch(cwd: string): Promise<{ ok: boolean; text: string }> {
    const messages: string[] = [];
    let ok = true;
    let foundPackage = false;

    for (const root of piIntercomPackageRoots(cwd)) {
      const patch = await patchPiIntercomBrokerCwd(root);
      if (!patch.found) continue;
      foundPackage = true;
      if (!patch.ok) ok = false;
      if (patch.message) messages.push(patch.message);
    }

    if (!foundPackage) messages.push(`ℹ️ ${PI_INTERCOM_PACKAGE_NAME} was not found in global/project npm packages.`);
    return { ok, text: messages.join("\n") };
  }

  async function isPiIntercomInstalled(cwd: string): Promise<boolean> {
    for (const root of piIntercomPackageRoots(cwd)) {
      if (await fileExists(join(root, "package.json"))) return true;
    }
    return false;
  }

  function isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      return (err as { code?: string }).code === "EPERM";
    }
  }

  function intercomRuntimePath(...parts: string[]): string {
    return join(getAgentDir(), "intercom", ...parts);
  }

  /**
   * Hold pi-intercom's existing spawn lock while its old broker is stopped and
   * npm replaces the package. Connected Pi sessions back off instead of
   * immediately spawning another broker from the directory being updated.
   */
  async function acquireIntercomUpdateLock(signal?: AbortSignal): Promise<{
    signal: AbortSignal;
    assertOwned: () => void;
    release: () => Promise<void>;
  }> {
    signal?.throwIfAborted();
    const lockPath = intercomRuntimePath("broker.spawn.lock");
    await mkdir(dirname(lockPath), { recursive: true });

    // pi-intercom reads only the first two lines. The nonce is a backwards-
    // compatible third line that prevents this updater from refreshing or
    // deleting a same-PID replacement lock created by its own reconnect path.
    const nonce = randomUUID();
    const lockContents = () => `${process.pid}\n${Date.now()}\n${nonce}\n`;
    let lockFd: number | null = null;

    for (let attempt = 0; attempt < 40 && lockFd === null; attempt++) {
      signal?.throwIfAborted();
      try {
        const fd = openSync(lockPath, "wx");
        try {
          writeSync(fd, lockContents(), 0, "utf8");
          lockFd = fd;
        } catch (err) {
          closeSync(fd);
          await unlink(lockPath).catch(() => undefined);
          throw err;
        }
      } catch (err: unknown) {
        if ((err as { code?: string }).code !== "EEXIST") throw err;

        let observed = "";
        let stale = false;
        try {
          observed = await readFile(lockPath, "utf8");
          const [pidLine = "", createdLine = "0", nonceLine = ""] = observed.trim().split(/\r?\n/);
          const ownerPid = Number.parseInt(pidLine, 10);
          const createdAt = Number.parseInt(createdLine, 10);
          const validPid = Number.isSafeInteger(ownerPid) && ownerPid > 0;
          const ownerAlive = validPid && isProcessAlive(ownerPid);
          const validCreatedAt = Number.isFinite(createdAt);
          const nativeSpawnLeaseExpired = nonceLine.length === 0
            && validCreatedAt
            && Date.now() - createdAt > INTERCOM_SPAWN_LOCK_STALE_MS;
          // A nonce marks another updater's heartbeated lock. Never steal that
          // lock from a live owner merely because its event loop paused. Native
          // two-line pi-intercom spawn locks retain their upstream 10s lease.
          stale = !validPid || !ownerAlive || !validCreatedAt || nativeSpawnLeaseExpired;
        } catch {
          stale = true;
        }

        if (stale) {
          // Do not unlink a lock that changed after our stale read.
          try {
            if (readFileSync(lockPath, "utf8") === observed) await unlink(lockPath);
          } catch (unlinkError: unknown) {
            if ((unlinkError as { code?: string }).code !== "ENOENT") {
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
          }
          continue;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    if (lockFd === null) {
      throw new Error(`Could not acquire pi-intercom update lock at ${lockPath}.`);
    }

    const ownedFd = lockFd;
    const controller = new AbortController();
    let ownershipError: Error | null = null;
    let active = true;

    const verifyOwnership = (): void => {
      const [pidLine = "", _createdLine = "", nonceLine = ""] = readFileSync(lockPath, "utf8")
        .trim()
        .split(/\r?\n/);
      if (Number.parseInt(pidLine, 10) !== process.pid || nonceLine !== nonce) {
        throw new Error(`Lost pi-intercom update-lock ownership at ${lockPath}.`);
      }
    };

    const loseOwnership = (err: unknown): void => {
      if (ownershipError) return;
      ownershipError = err instanceof Error ? err : new Error(String(err));
      active = false;
      controller.abort(ownershipError);
    };

    const heartbeat = setInterval(() => {
      if (!active) return;
      try {
        verifyOwnership();
        // The retained descriptor prevents pathname replacement on Windows and
        // avoids a truncate/read race while other sessions test lock staleness.
        writeSync(ownedFd, lockContents(), 0, "utf8");
      } catch (err: unknown) {
        loseOwnership(err);
      }
    }, INTERCOM_SPAWN_LOCK_HEARTBEAT_MS);
    heartbeat.unref?.();

    return {
      signal: controller.signal,
      assertOwned() {
        if (ownershipError) throw ownershipError;
        verifyOwnership();
      },
      async release() {
        active = false;
        clearInterval(heartbeat);
        let releaseError: unknown;
        try {
          verifyOwnership();
        } catch (err: unknown) {
          releaseError = err;
        }
        closeSync(ownedFd);

        if (!releaseError) {
          try {
            verifyOwnership();
            await unlink(lockPath);
          } catch (err: unknown) {
            if ((err as { code?: string }).code !== "ENOENT") releaseError = err;
          }
        }
        if (releaseError) throw releaseError;
      },
    };
  }

  /** Stop the old Windows broker process tree that currently locks pi-intercom. */
  async function stopIntercomBrokerForUpdate(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    const pidPath = intercomRuntimePath("broker.pid");
    let brokerPid: number;
    try {
      brokerPid = Number.parseInt((await readFile(pidPath, "utf8")).trim(), 10);
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "ENOENT") return "ℹ️ No running pi-intercom broker needed stopping.";
      throw err;
    }

    if (!Number.isSafeInteger(brokerPid) || brokerPid <= 0) {
      await unlink(pidPath).catch(() => undefined);
      return "ℹ️ Removed a stale pi-intercom broker PID file.";
    }
    if (brokerPid === process.pid) throw new Error("Refusing to stop the current Pi process as the intercom broker.");
    if (!isProcessAlive(brokerPid)) {
      await unlink(pidPath).catch(() => undefined);
      return `ℹ️ Removed stale pi-intercom broker PID ${brokerPid}.`;
    }

    // tsx uses a small parent launcher on Windows. Select that parent only when
    // its command line clearly belongs to pi-intercom, then stop the full tree.
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$brokerPid = ${brokerPid}`,
      "$broker = Get-CimInstance Win32_Process -Filter \"ProcessId = $brokerPid\"",
      "if ($null -eq $broker) { exit 0 }",
      "if ($broker.CommandLine -notlike '*pi-intercom*' -or $broker.CommandLine -notlike '*broker*') { Write-Output 'PID file does not identify a pi-intercom broker'; exit 42 }",
      "$target = $broker",
      "$parent = Get-CimInstance Win32_Process -Filter \"ProcessId = $($broker.ParentProcessId)\"",
      "if ($null -ne $parent -and $parent.CommandLine -like '*pi-intercom*' -and $parent.CommandLine -like '*broker*') { $target = $parent }",
      "& taskkill.exe /PID $target.ProcessId /T /F | Out-Null",
      "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    ].join("; ");
    const stopped = await pi.exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
      timeout: 10_000,
      signal,
    });
    if (stopped.code !== 0 && isProcessAlive(brokerPid)) {
      throw new Error(`Could not stop pi-intercom broker ${brokerPid}: ${(stopped.stderr || stopped.stdout).trim()}`);
    }

    for (let attempt = 0; attempt < 100 && isProcessAlive(brokerPid); attempt++) {
      signal?.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (isProcessAlive(brokerPid)) throw new Error(`pi-intercom broker ${brokerPid} did not stop.`);
    await unlink(pidPath).catch(() => undefined);
    return `✅ Stopped pi-intercom broker ${brokerPid}; respawn is paused until its package update finishes.`;
  }

  function buildNpmCommand(npmArgs: string[]): { command: string; args: string[] } {
    if (process.platform === "win32") {
      const comspec = process.env.ComSpec || "cmd.exe";
      return { command: comspec, args: ["/d", "/s", "/c", "npm", ...npmArgs] };
    }
    return { command: "npm", args: npmArgs };
  }

  /**
   * Execute an update subprocess with tree-aware Windows cancellation. Pi's
   * generic exec cancellation can stop only the root cmd.exe, leaving its
   * Node/npm descendants alive and still mutating node_modules after a lock
   * failure. taskkill /T is synchronous, so close is observed only after the
   * whole descendant tree has been terminated.
   */
  async function execUpdateCommand(
    command: string,
    args: string[],
    options: { cwd?: string; timeoutMs: number; signal?: AbortSignal },
  ): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }> {
    options.signal?.throwIfAborted();

    return await new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: process.env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const maxOutputChars = 2 * 1024 * 1024;
      let stdout = "";
      let stderr = "";
      let killed = false;
      let settled = false;

      const append = (current: string, chunk: Buffer): string => {
        const next = current + chunk.toString("utf8");
        return next.length <= maxOutputChars ? next : next.slice(-maxOutputChars);
      };
      child.stdout.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
      child.stderr.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });

      const terminateTree = (reason: string): void => {
        if (killed || settled) return;
        killed = true;
        stderr = `${stderr}\n${reason}`.trim();
        if (process.platform === "win32" && child.pid) {
          const termination = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true,
            stdio: "ignore",
          });
          if (termination.status === 0) return;
        }
        child.kill("SIGTERM");
      };

      const onAbort = () => {
        const reason = options.signal?.reason;
        terminateTree(`Update cancelled: ${reason instanceof Error ? reason.message : String(reason ?? "aborted")}`);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timeout = setTimeout(() => terminateTree(`Update timed out after ${options.timeoutMs}ms.`), options.timeoutMs);

      const cleanup = () => {
        clearTimeout(timeout);
        options.signal?.removeEventListener("abort", onAbort);
      };
      child.once("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(err);
      });
      child.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve({ code: code ?? (killed ? 1 : 0), stdout, stderr, killed });
      });
    });
  }

  async function runNpm(
    npmRoot: string,
    npmArgs: string[],
    timeoutMs = 180_000,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; output: string }> {
    const { command, args } = buildNpmCommand(npmArgs);
    try {
      // On Windows always own timeout/abort termination so cmd.exe and every
      // npm/Node descendant are stopped as one tree. Slash commands have no
      // AbortSignal, but their timeout needs the same protection as tool calls.
      const result = process.platform === "win32"
        ? await execUpdateCommand(command, args, { cwd: npmRoot, timeoutMs, signal })
        : await pi.exec(command, args, { cwd: npmRoot, timeout: timeoutMs, signal });
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

  async function ensurePixPrettyIconCatalog(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; text: string }> {
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
      signal?.throwIfAborted();
      const update = await runNpm(npmRoot, ["update", "@xynogen/pix-pretty", "--omit=dev"], 180_000, signal);
      signal?.throwIfAborted();
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

    const hasWorkingProbe =
      next.includes('pi.exec("rtk", ["--version"]') || next.includes("probeRtkAvailability(pi)");
    if (!hasWorkingProbe || !next.includes("cargo install --git https://github.com/rtk-ai/rtk")) {
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

  function desiredHeimdallSandboxEnabled(): boolean {
    // pi-heimdall's sandbox is bubblewrap-based, and bubblewrap is Linux-only.
    // Keep it off on Windows and macOS so cross-OS checkouts do not flip a
    // tracked config file or show a misleading unsupported-sandbox warning.
    return process.platform === "linux";
  }

  function platformLabel(): string {
    return process.platform === "win32" ? "Windows" : process.platform === "linux" ? "Linux" : process.platform === "darwin" ? "macOS" : process.platform;
  }

  /** Keep Heimdall's Linux-only sandbox aligned with the current OS. */
  async function ensureHeimdallSandboxForPlatform(): Promise<{ ok: boolean; text: string }> {
    const configPath = join(getAgentDir(), "heimdall.json");
    const enabled = desiredHeimdallSandboxEnabled();
    const state = enabled ? "enabled" : "disabled";
    const platform = platformLabel();

    try {
      const config = await readJsonObject(configPath);
      const existingSandbox = config.sandbox;
      const sandbox =
        existingSandbox && typeof existingSandbox === "object" && !Array.isArray(existingSandbox)
          ? { ...(existingSandbox as Record<string, unknown>) }
          : {};

      if (sandbox.enabled === enabled) {
        return { ok: true, text: `✅ Heimdall sandbox already ${state} on ${platform}.` };
      }

      sandbox.enabled = enabled;
      config.sandbox = sandbox;
      await mkdir(dirname(configPath), { recursive: true });
      await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
      return { ok: true, text: `✅ Set Heimdall sandbox ${state} on ${platform} (${configPath}).` };
    } catch (err: unknown) {
      return {
        ok: false,
        text: `⚠️ Could not set Heimdall sandbox for ${platform} at ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Startup is intentionally detection/load-only. OS config and package-source
  // repairs run only inside an explicitly authorized update. Clean installs get
  // the subagent compatibility repair from the tracked npm postinstall hook.

  async function ensurePostUpdatePackagePatches(
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ ok: boolean; text: string }> {
    signal?.throwIfAborted();
    const llama = await ensureLlamaCppPort1234(cwd);
    signal?.throwIfAborted();
    const pixPretty = await ensurePixPrettyIconCatalog(cwd, signal);
    signal?.throwIfAborted();
    const pix = await ensurePixOptimizerRtkPatch(cwd);
    signal?.throwIfAborted();
    const hermes = await ensureHermesBackfillPatch(cwd);
    signal?.throwIfAborted();
    const intercom = await ensurePiIntercomBrokerCwdPatch(cwd);
    signal?.throwIfAborted();
    const subagents = await ensurePiSubagentsAsyncWorkflowIdPatch(cwd);
    signal?.throwIfAborted();
    const heimdall = await ensureHeimdallSandboxForPlatform();
    signal?.throwIfAborted();
    return {
      ok: llama.ok && pixPretty.ok && pix.ok && hermes.ok && intercom.ok && subagents.ok && heimdall.ok,
      text: `${LLAMA_CPP_PACKAGE_NAME}:\n${llama.text}\n\n@xynogen/pix-pretty:\n${pixPretty.text}\n\n@xynogen/pix-optimizer:\n${pix.text}\n\n${HERMES_MEMORY_PACKAGE_NAME}:\n${hermes.text}\n\n${PI_INTERCOM_PACKAGE_NAME}:\n${intercom.text}\n\n${PI_SUBAGENTS_PACKAGE_NAME}:\n${subagents.text}\n\n${HEIMDALL_PACKAGE_NAME}:\n${heimdall.text}`,
    };
  }

  /** Run `pi <args…>` and capture the result. */
  async function runPi(
    piArgs: string[],
    timeoutMs = 300_000,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; output: string }> {
    const { command, args } = buildPiCommand(piArgs);
    try {
      // Use tree-aware timeout handling for every Windows invocation, including
      // the signal-less `/update` slash-command path.
      const result = process.platform === "win32"
        ? await execUpdateCommand(command, args, { timeoutMs, signal })
        : await pi.exec(command, args, { timeout: timeoutMs, signal });
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

  /* ────────────────────────────────────────────────────
   * Upstream-publish-bug resilience
   *
   * Some npm packages get published with unresolved `workspace:*` dependency
   * specifiers — a pnpm/yarn monorepo protocol that plain npm cannot resolve.
   * When that happens, `npm install <pkg>@latest` inside `pi update` fails with
   * `EUNSUPPORTEDPROTOCOL ... "workspace:"`, which aborts the WHOLE package
   * update: one broken upstream release blocks every other package too.
   *
   * To keep `/update` working we pre-flight the latest version of each declared
   * npm package against the public registry. Any package whose latest version
   * still carries a `workspace:` dependency is treated as "do not update": we
   * update the remaining packages individually (`pi update npm:<pkg>`) and skip
   * the broken one, keeping its currently-installed (good) version. This is
   * self-healing — once the author publishes a fixed version the pre-flight
   * finds nothing broken and the normal bulk update resumes automatically.
   * The pre-flight is fail-open: a flaky/offline/custom registry never blocks
   * updates (we just fall through to the normal bulk path in that case).
   * ──────────────────────────────────────────────────── */

  const NPM_REGISTRY_BASE = "https://registry.npmjs.org";

  /** All declared package specs (e.g. `npm:@scope/pkg`, `git:...`) from user + project settings. */
  async function declaredPackageSpecs(cwd: string): Promise<string[]> {
    const specs = new Set<string>();
    const paths = [join(getAgentDir(), "settings.json"), join(cwd, ".pi", "settings.json")];
    for (const settingsPath of paths) {
      const s = await readJsonObject(settingsPath);
      const pkgs = Array.isArray(s.packages) ? s.packages : [];
      for (const spec of pkgs) if (typeof spec === "string") specs.add(spec);
    }
    return [...specs];
  }

  /** Strict npm-name allowlist before a settings-derived name reaches cmd.exe. */
  function isSafeNpmPackageName(name: string): boolean {
    if (name.length === 0 || name.length > 214) return false;
    const segment = "[a-z0-9](?:[a-z0-9._~-]*[a-z0-9])?";
    return new RegExp(`^(?:@${segment}/)?${segment}$`).test(name);
  }

  /** Extract and validate the bare package name from an `npm:` spec. */
  function npmSpecToName(spec: string): string | null {
    if (!spec.startsWith("npm:")) return null;
    const rest = spec.slice("npm:".length);
    // Scoped names start with '@'; their version separator is the SECOND '@'.
    const at = rest.startsWith("@") ? rest.indexOf("@", 1) : rest.indexOf("@");
    const name = at > 0 ? rest.slice(0, at) : rest;
    return isSafeNpmPackageName(name) ? name : null;
  }

  /** Latest-version metadata for an npm package from the public registry (null on any error). */
  async function fetchLatestPackageMeta(
    pkgName: string,
    signal?: AbortSignal,
  ): Promise<{ version: string; deps: Record<string, string> } | null> {
    try {
      const res = await fetch(`${NPM_REGISTRY_BASE}/${encodeURIComponent(pkgName)}/latest`, {
        signal: withTimeout(signal, 8_000),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        version?: string;
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };
      if (!json.version) return null;
      const deps = {
        ...(json.dependencies ?? {}),
        ...(json.optionalDependencies ?? {}),
        ...(json.peerDependencies ?? {}),
      };
      return { version: json.version, deps };
    } catch {
      signal?.throwIfAborted();
      return null; // fail-open for registry/network failures, but never swallow caller cancellation
    }
  }

  /** Detect declared npm packages whose latest version is unresolvable by npm (workspace: protocol). */
  async function detectBrokenNpmUpdates(
    npmNames: string[],
    signal?: AbortSignal,
  ): Promise<Map<string, { latest: string; badDeps: string[] }>> {
    const broken = new Map<string, { latest: string; badDeps: string[] }>();
    const checked = await Promise.all(
      npmNames.map(async (name) => {
        const meta = await fetchLatestPackageMeta(name, signal);
        if (!meta) return null;
        const bad = Object.entries(meta.deps)
          .filter(([, v]) => typeof v === "string" && v.startsWith("workspace:"))
          .map(([k, v]) => `${k}@${v}`);
        return bad.length ? { name, latest: meta.version, bad } : null;
      }),
    );
    for (const r of checked) if (r) broken.set(r.name, { latest: r.latest, badDeps: r.bad });
    return broken;
  }

  /** Human-readable notice listing packages skipped because their latest version is unresolvable. */
  function brokenPackagesNotice(
    broken: Map<string, { latest: string; badDeps: string[] }>,
    skippedGitReconcile: boolean,
  ): string {
    if (broken.size === 0) return "";
    const lines = [...broken.entries()].map(
      ([pkg, info]) =>
        `  • ${pkg}@${info.latest} → unresolved ${info.badDeps.join(", ")} (upstream publish bug). Skipped; keeping installed version. Auto-resumes once a fixed version is published.`,
    );
    const tail = skippedGitReconcile
      ? "\nℹ️  Git-sourced packages are not reconciled during this fallback run; re-run `/update` after the broken package is fixed."
      : "";
    return `⚠️  Skipped ${broken.size} package(s) whose latest npm version npm cannot install:\n${lines.join("\n")}${tail}`;
  }

  /** Update each declared npm package individually, skipping the broken set. */
  async function runPerPackageNpmUpdates(
    npmNames: string[],
    skip: Set<string>,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; output: string }> {
    const targets = npmNames.filter((p) => !skip.has(p));
    if (targets.length === 0) {
      return { success: true, output: "(no npm packages to update after skipping broken ones)" };
    }
    const sections: string[] = [];
    let success = true;
    for (const name of targets) {
      const r = await runPi(["update", `npm:${name}`], 300_000, signal);
      success = success && r.success;
      sections.push(`npm:${name}:\n${r.output || "(no output)"}`);
    }
    return { success, output: sections.join("\n\n") };
  }

  /** Hint appended when npm itself rejects a `workspace:` specifier (defense in depth). */
  function upstreamBugHint(output: string): string {
    if (/EUNSUPPORTEDPROTOCOL|"workspace:"|Unsupported URL Type "workspace:"/.test(output)) {
      return (
        "\n\nℹ️  This is an upstream publish bug: a package was published to npm with an unresolved " +
        "`workspace:*` dependency, which npm cannot install. The update pre-flight normally skips such " +
        "packages automatically; if it recurred here (e.g. offline, stale cache, or a custom npm registry), " +
        "find the culprit with `npm view <pkg>@latest dependencies` and re-run `/update`."
      );
    }
    return "";
  }

  /**
   * Run the update for a scope, transparently routing around npm packages whose
   * latest version is unresolvable (workspace: protocol). The common case (no
   * broken packages) is unchanged: a single `pi update --all` / `--extensions`.
   * Only when a broken latest is detected do we fall back to per-package updates.
   */
  async function runScopedUpdate(
    scope: UpdateScope,
    force: boolean,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{ success: boolean; output: string; brokenNotice: string }> {
    if (scope === "self") {
      const r = await runPi(updateArgs(scope, force), 300_000, signal);
      return { success: r.success, output: r.output + upstreamBugHint(r.output), brokenNotice: "" };
    }

    const specs = await declaredPackageSpecs(cwd);
    const npmNames = [...new Set(specs.map(npmSpecToName).filter((n): n is string => !!n))];
    const hasNonNpm = specs.some((s) => !s.startsWith("npm:"));
    const broken = await detectBrokenNpmUpdates(npmNames, signal);
    const brokenNotice = brokenPackagesNotice(broken, broken.size > 0 && hasNonNpm);

    // Common path: nothing broken → one bulk command, exactly like before.
    if (broken.size === 0) {
      const bulkArgs = scope === "all" ? ["update", "--all"] : ["update", "--extensions"];
      const r = await runPi(bulkArgs, 300_000, signal);
      return { success: r.success, output: r.output + upstreamBugHint(r.output), brokenNotice: "" };
    }

    // Broken package(s) detected → update pi self (for "all") + each good npm package individually.
    const parts: string[] = [];
    let success = true;
    if (scope === "all") {
      const selfR = await runPi(["update", "--self"], 300_000, signal);
      success = success && selfR.success;
      if (selfR.output) parts.push(selfR.output);
    }
    const pkgR = await runPerPackageNpmUpdates(npmNames, new Set(broken.keys()), signal);
    success = success && pkgR.success;
    if (pkgR.output) parts.push(pkgR.output);
    const combined = parts.join("\n\n");
    return { success, output: combined + upstreamBugHint(combined), brokenNotice };
  }

  /**
   * Apply an update and all package patches as one maintenance window. The
   * Windows maintenance window stops pi-intercom's detached broker (which is
   * executing files from node_modules), holds its native respawn lock, updates
   * the packages, patches the new broker launcher, and only then allows sessions
   * to reconnect. This is required on every pi-intercom update: moving only the
   * broker cwd is insufficient because the live tsx loader also locks the package.
   */
  async function runUpdateWithPostPatches(
    scope: UpdateScope,
    force: boolean,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<{
    result: { success: boolean; output: string; brokenNotice: string };
    postUpdate: { ok: boolean; text: string } | null;
    maintenanceNotice: string;
  }> {
    type UpdateOutcome = {
      result: { success: boolean; output: string; brokenNotice: string };
      postUpdate: { ok: boolean; text: string } | null;
      maintenanceNotice: string;
    };

    let intercomLock: Awaited<ReturnType<typeof acquireIntercomUpdateLock>> | null = null;
    let maintenanceNotice = "";
    let phase = "package update";
    let outcome: UpdateOutcome = {
      result: { success: false, output: "Update did not start.", brokenNotice: "" },
      postUpdate: null,
      maintenanceNotice,
    };

    try {
      signal?.throwIfAborted();
      const shouldPauseIntercom =
        scope !== "self"
        && process.platform === "win32"
        && (await fileExists(intercomRuntimePath("broker.pid")) || await isPiIntercomInstalled(cwd));

      if (shouldPauseIntercom) {
        phase = "Windows pi-intercom update preparation";
        intercomLock = await acquireIntercomUpdateLock(signal);
        signal?.throwIfAborted();
        maintenanceNotice = await stopIntercomBrokerForUpdate(signal);
        signal?.throwIfAborted();
        intercomLock.assertOwned();
      }

      const updateSignal = signal && intercomLock
        ? AbortSignal.any([signal, intercomLock.signal])
        : signal ?? intercomLock?.signal;

      phase = "package update";
      const result = await runScopedUpdate(scope, force, cwd, updateSignal);
      signal?.throwIfAborted();
      intercomLock?.assertOwned();

      phase = "post-update package fixes";
      const postUpdate = scope !== "self" ? await ensurePostUpdatePackagePatches(cwd, updateSignal) : null;
      signal?.throwIfAborted();
      intercomLock?.assertOwned();
      outcome = { result, postUpdate, maintenanceNotice };
    } catch (err: unknown) {
      outcome = {
        result: {
          success: false,
          output: `${phase} failed: ${err instanceof Error ? err.message : String(err)}`,
          brokenNotice: "",
        },
        postUpdate: null,
        maintenanceNotice,
      };
    } finally {
      if (intercomLock) {
        // Even a cancelled or partially failed npm replacement may already have
        // overwritten pi-intercom. Repair its launcher before releasing the
        // respawn lock, otherwise a new broker can immediately lock node_modules.
        try {
          intercomLock.assertOwned();
          const recovery = await ensurePiIntercomBrokerCwdPatch(cwd);
          if (outcome.postUpdate === null || !recovery.ok) {
            const recoveryNotice = `pi-intercom recovery check:\n${recovery.text}`;
            outcome.maintenanceNotice = [outcome.maintenanceNotice, recoveryNotice].filter(Boolean).join("\n\n");
          }
          if (!recovery.ok) {
            outcome.result = {
              ...outcome.result,
              success: false,
              output: `${outcome.result.output}\n\npi-intercom recovery patch failed:\n${recovery.text}`.trim(),
            };
          }
        } catch (err: unknown) {
          const recoveryError = `pi-intercom recovery patch failed: ${err instanceof Error ? err.message : String(err)}`;
          outcome.result = {
            ...outcome.result,
            success: false,
            output: `${outcome.result.output}\n\n${recoveryError}`.trim(),
          };
        }

        try {
          await intercomLock.release();
        } catch (err: unknown) {
          const cleanupError = `pi-intercom update-lock cleanup failed: ${err instanceof Error ? err.message : String(err)}`;
          outcome.result = {
            ...outcome.result,
            success: false,
            output: `${outcome.result.output}\n\n${cleanupError}`.trim(),
          };
        }
      }
    }

    return outcome;
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
      "'extensions' only packages. On Windows, pi-intercom's detached broker is paused and its respawn lock is held while npm replaces the package, avoiding EBUSY. After package updates, pi-llama-cpp is reset to http://127.0.0.1:1234, @xynogen/pix-pretty is refreshed if pix-optimizer needs its icon catalog, pi-subagents async workflow IDs are kept Windows-safe, the Heimdall sandbox is enabled on Linux and disabled on Windows/non-Linux, and known overwritten local package patches are re-applied. " +
      "Packages whose latest npm version is unresolvable by npm (e.g. published with an unresolved `workspace:*` dependency) are detected via a registry pre-flight and skipped, updating the rest individually, so a single broken upstream release never blocks other updates. " +
      "`check=true` reports whether a pi update is available without installing (package update availability is " +
      "surfaced by pi at startup; there is no dry-run for it). A direct, scope-matching user request authorizes one update without a redundant popup. " +
      "`force` reinstalls pi even if current (scope 'self' only).",
    parameters: Type.Object({
      scope: Type.Optional(
        StringEnum(["all", "self", "extensions"] as const, {
          description: "What to update. Default: 'all'.",
        }),
      ),
      check: Type.Optional(
        Type.Boolean({ description: "Only check (pi self only); don't install. Default: false." }),
      ),
      confirm: Type.Optional(
        Type.Boolean({
          description: "Deprecated compatibility field; ignored. Authority comes from the user's direct, scope-matching request.",
        }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Reinstall pi even if current. Only with scope 'self'. Default: false." }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      signal?.throwIfAborted();
      const scope: UpdateScope = params.scope ?? "all";
      const checkOnly = params.check ?? false;
      const force = (params.force ?? false) && scope === "self";

      // ── Check-only ───────────────────────────────────────────────────────
      // We can only reliably dry-check pi itself (via pi.dev). Package update
      // availability has no documented dry-run; pi already reports it at startup.
      if (checkOnly) {
        const self = await checkSelfUpdate(signal);
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

      // ── Authority ──────────────────────────────────────────────────────────
      const args = updateArgs(scope, force);
      const authorization = pendingUpdateAuthorization;
      if (!updateAuthorizationAllows(authorization, scope, force)) {
        throw new Error(`Pi update blocked: the user's latest direct request does not authorize scope='${scope}'${force ? " with force" : ""}. Do not show a raw-command approval popup; ask one plain-language question only if the broader effect is genuinely needed.`);
      }
      pendingUpdateAuthorization = null;

      // ── Run ──────────────────────────────────────────────────────────────
      ctx.ui.setStatus("pi-update", `Updating ${scopeLabel(scope)}…`);
      const { result, postUpdate, maintenanceNotice } = await runUpdateWithPostPatches(scope, force, ctx.cwd, signal);
      ctx.ui.setStatus(
        "pi-update",
        result.success ? (postUpdate && !postUpdate.ok ? "Update complete; post-update patch failed!" : "Update complete!") : "Update failed!",
      );

      const notice = result.brokenNotice ? `${result.brokenNotice}\n\n` : "";
      const maintenance = maintenanceNotice ? `${maintenanceNotice}\n\n` : "";
      const body = maintenance + notice + (result.output || "(no output)");
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

      if (!["", "self", "extensions", "ext"].includes(argStr)) {
        ctx.ui.notify("Nutzung: /update [self|extensions|check]", "warning");
        return;
      }
      const scope: UpdateScope =
        argStr === "self" ? "self" : argStr === "extensions" || argStr === "ext" ? "extensions" : "all";
      const args = updateArgs(scope, false);

      ctx.ui.setStatus("pi-update", `Updating ${scopeLabel(scope)}…`);
      const { result, postUpdate, maintenanceNotice } = await runUpdateWithPostPatches(scope, false, ctx.cwd);
      ctx.ui.setStatus(
        "pi-update",
        result.success ? (postUpdate && !postUpdate.ok ? "Done; post-update patch failed!" : "Done!") : "Failed!",
      );

      const notice = result.brokenNotice ? `${result.brokenNotice}\n\n` : "";
      const maintenance = maintenanceNotice ? `${maintenanceNotice}\n\n` : "";
      const postUpdateText = postUpdate ? `\n\n${postUpdate.text}` : "";
      if (result.success) {
        ctx.ui.notify(`✅ Update finished.\n\n${maintenance}${notice}${result.output || ""}${postUpdateText}\n\nRestart pi to load new versions.`, postUpdate && !postUpdate.ok ? "warning" : "info");
      } else {
        ctx.ui.notify(`❌ Update failed:\n${maintenance}${notice}${(result.output + postUpdateText).slice(0, 1200)}`, "error");
     }
    },
  });
}
