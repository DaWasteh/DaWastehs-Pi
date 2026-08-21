import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";

const require = createRequire(import.meta.url);

const extensionContext = {
  cwd: "C:/Users/Sebas/.pi",
  hasUI: false,
  mode: "tui",
  ui: {
    async confirm() {
      throw new Error("Unexpected confirmation in extension test");
    },
    async select() {
      throw new Error("Unexpected selection in extension test");
    },
    notify() {},
    setStatus() {},
  },
};

test("Pi 0.84 extension registrations and cancellation contract", async () => {
  const temporaryAgentDir = await mkdtemp(join(tmpdir(), "pi-extension-test-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = temporaryAgentDir;

  try {
    const alarmHandlers = new Map();
    const alarmCommands = new Map();
    const alarmModule = await import("../extensions/alarm-sound.ts");
    alarmModule.default({
      on(name, handler) {
        alarmHandlers.set(name, handler);
      },
      registerCommand(name, definition) {
        alarmCommands.set(name, definition);
      },
    });

    assert.deepEqual(
      [...alarmHandlers.keys()],
      ["project_trust", "session_start", "agent_start", "tool_execution_start", "tool_execution_end", "agent_end", "agent_settled", "session_shutdown"],
    );
    assert.ok(alarmCommands.has("alarm-sounds"));

    // Disable playback, then exercise the low-level-end → settled flow.
    await alarmCommands.get("alarm-sounds").handler("off", extensionContext);
    await alarmHandlers.get("agent_start")({ type: "agent_start" }, extensionContext);
    await alarmHandlers.get("agent_end")({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "stop" }],
    }, extensionContext);
    await alarmHandlers.get("agent_settled")({ type: "agent_settled" }, extensionContext);

    const updateTools = new Map();
    const updateCommands = new Map();
    const updateHandlers = new Map();
    let execCalls = 0;

    // Prove the tracked npm postinstall hook can repair a clean vulnerable
    // pi-subagents package without relying on ignored local node_modules state.
    const fixturePackageRoot = join(temporaryAgentDir, "npm", "node_modules", "pi-subagents");
    const fixtureExecutorDir = join(fixturePackageRoot, "src", "runs", "foreground");
    const fixtureExecutorPath = join(fixtureExecutorDir, "subagent-executor.ts");
    await mkdir(fixtureExecutorDir, { recursive: true });
    await writeFile(
      fixtureExecutorPath,
      'import { randomUUID } from "node:crypto";\nfunction run(_id) { const workflowRunId = _id; return workflowRunId; }\n',
      "utf8",
    );
    const { patchPiSubagents } = require("../npm/patches/postinstall.cjs");
    const fixturePatch = patchPiSubagents(fixturePackageRoot);
    assert.equal(fixturePatch.changed, true);
    assert.match(await readFile(fixtureExecutorPath, "utf8"), /const workflowRunId = randomUUID\(\);/);

    const heimdallPath = join(temporaryAgentDir, "heimdall.json");
    const driftedSandbox = process.platform !== "linux";
    await writeFile(heimdallPath, JSON.stringify({ sandbox: { enabled: driftedSandbox } }), "utf8");
    const updateModule = await import("../extensions/pi-autoupdate.ts");
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Bitte Pi und die Extensions aktualisieren."), { scope: "all", force: false });
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Bitte nur die Extensions aktualisieren."), { scope: "extensions", force: false });
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Bitte Pi neu installieren und das erzwingen."), { scope: "self", force: true });
    assert.equal(updateModule.parsePiUpdateAuthorization('Erkläre, ob "update Pi" sicher ist.'), null);
    assert.equal(updateModule.parsePiUpdateAuthorization("Repeat 'update Pi' exactly."), null);
    assert.equal(updateModule.parsePiUpdateAuthorization("The agent can update Pi."), null);
    assert.equal(updateModule.parsePiUpdateAuthorization("Should I update Pi?"), null);
    assert.equal(updateModule.parsePiUpdateAuthorization("Please explain whether to update Pi."), null);
    assert.equal(updateModule.parsePiUpdateAuthorization("I am not asking you to update Pi."), null);
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Update packages, but not Pi."), { scope: "extensions", force: false });
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Update Pi, not extensions."), { scope: "self", force: false });
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Update Pi, but don't force it."), { scope: "self", force: false });
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Update Pi, no force."), { scope: "self", force: false });
    assert.deepEqual(updateModule.parsePiUpdateAuthorization("Update packages, excluding Pi."), { scope: "extensions", force: false });
    assert.equal(updateModule.hasExplicitPiUpdateIntent("Bitte Pi nicht aktualisieren."), false);
    assert.equal(updateModule.updateAuthorizationAllows({ scope: "extensions", force: false }, "all", false), false);
    assert.equal(updateModule.updateAuthorizationAllows({ scope: "all", force: false }, "self", false), true);
    assert.equal(updateModule.updateAuthorizationAllows({ scope: "self", force: false }, "self", true), false);
    await updateModule.default({
      on(name, handler) { updateHandlers.set(name, handler); },
      registerTool(definition) {
        updateTools.set(definition.name, definition);
      },
      registerCommand(name, definition) {
        updateCommands.set(name, definition);
      },
      async exec() {
        execCalls++;
        throw new Error("Unexpected subprocess in extension test");
      },
    });

    const updateTool = updateTools.get("pi_update");
    assert.ok(updateTool);
    assert.ok(updateCommands.has("update"));
    assert.ok(updateHandlers.has("input"));
    assert.deepEqual(JSON.parse(await readFile(heimdallPath, "utf8")), { sandbox: { enabled: driftedSandbox } });
    assert.deepEqual(updateTool.parameters.properties.scope.enum, ["all", "self", "extensions"]);
    assert.equal(updateTool.parameters.properties.scope.anyOf, undefined);

    const controller = new AbortController();
    controller.abort(new Error("test-cancel"));
    await assert.rejects(
      updateTool.execute(
        "cancel",
        { scope: "self", confirm: false },
        controller.signal,
        undefined,
        extensionContext,
      ),
      /test-cancel/,
    );
    assert.equal(execCalls, 0);
    await assert.rejects(
      updateTool.execute("unauthorized", { scope: "self", confirm: false }, undefined, undefined, extensionContext),
      /does not authorize scope='self'/,
    );
    await assert.rejects(
      updateTool.execute("prompt-bypass", { scope: "all", confirm: true }, undefined, undefined, extensionContext),
      /does not authorize scope='all'/,
    );
    await updateCommands.get("update").handler("chek", extensionContext);
    assert.equal(execCalls, 0);

    // The recovery patch must remain inside finally and run before lock release.
    const source = await readFile(new URL("../extensions/pi-autoupdate.ts", import.meta.url), "utf8");
    const maintenanceStart = source.indexOf("async function runUpdateWithPostPatches");
    const finallyStart = source.indexOf("} finally {", maintenanceStart);
    const recoveryPatch = source.indexOf("ensurePiIntercomBrokerCwdPatch(cwd)", finallyStart);
    const lockRelease = source.indexOf("await intercomLock.release()", finallyStart);
    assert.ok(maintenanceStart >= 0 && finallyStart > maintenanceStart);
    assert.ok(recoveryPatch > finallyStart && lockRelease > recoveryPatch);

    // Every Windows update path, including signal-less slash commands, must
    // use tree-aware timeout termination. Settings-derived npm names are
    // allowlisted before they can reach cmd.exe.
    assert.equal(source.includes('signal && process.platform === "win32"'), false);
    assert.ok((source.match(/const result = process\.platform === "win32"/g) ?? []).length >= 2);
    assert.match(source, /function isSafeNpmPackageName\(name: string\)/);
    assert.match(source, /encodeURIComponent\(pkgName\)/);
    assert.equal((source.match(/ctx\.ui\.confirm/g) ?? []).length, 0, "Updater authority must not fall back to technical confirmation popups");
    const startupPolicy = source.slice(source.indexOf("Startup is intentionally"), source.indexOf("async function ensurePostUpdatePackagePatches"));
    assert.doesNotMatch(startupPolicy, /await ensure(?:Heimdall|PiSubagents)/);

    // A live nonce-bearing updater lock cannot be stolen on age alone, while
    // native two-line pi-intercom spawn locks retain their upstream lease.
    assert.match(source, /nativeSpawnLeaseExpired = nonceLine\.length === 0/);
    assert.match(source, /stale = !validPid \|\| !ownerAlive \|\| !validCreatedAt \|\| nativeSpawnLeaseExpired/);

    // Pi 0.84 tool-call ids can contain `|`; the updater must preserve the
    // package patch that decouples async workflow directory ids from them.
    assert.match(source, /async function patchPiSubagentsAsyncWorkflowId/);
    assert.match(source, /const subagents = await ensurePiSubagentsAsyncWorkflowIdPatch\(cwd\)/);
    const runtimePackage = JSON.parse(await readFile(new URL("../npm/package.json", import.meta.url), "utf8"));
    assert.equal(runtimePackage.scripts.postinstall, "node patches/postinstall.cjs");
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(temporaryAgentDir, { recursive: true, force: true });
  }
});

test("Alarm wrapper rings for confirmations and permission selectors without wrapping normal menus twice", async () => {
  const { installDialogAlarm, selectionNeedsAttention, uninstallDialogAlarm } = await import("../extensions/alarm-sound.ts");
  const events = [];
  const calls = [];
  const ui = {
    async confirm(title) { calls.push(`confirm:${title}`); return true; },
    async select(title, options) { calls.push(`select:${title}`); return options[0]; },
  };
  installDialogAlarm(ui, (reason) => events.push(`open:${reason}`), (reason) => events.push(`close:${reason}`));
  assert.equal(await ui.confirm("Freigabe", "Fortfahren?"), true);
  assert.equal(await ui.select("Choose model", ["A", "B"]), "A");
  assert.equal(await ui.select("MCP permission", ["Allow once", "Deny"]), "Allow once");
  assert.deepEqual(events, ["open:confirmation", "close:confirmation", "open:confirmation", "close:confirmation"]);
  assert.deepEqual(calls, ["confirm:Freigabe", "select:Choose model", "select:MCP permission"]);
  assert.equal(selectionNeedsAttention("Choose model", ["A", "B"]), false);
  assert.equal(selectionNeedsAttention("RTK command zulassen?", ["Ja", "Nein"]), true);
  assert.equal(selectionNeedsAttention("Trust project folder?", ["Trust", "Trust (this session only)", "Do not trust"]), true);

  const secondEvents = [];
  installDialogAlarm(ui, (reason) => secondEvents.push(`open:${reason}`), (reason) => secondEvents.push(`close:${reason}`));
  await ui.confirm("Overwrite?", "Replace file?");
  assert.deepEqual(secondEvents, ["open:confirmation", "close:confirmation"]);
  uninstallDialogAlarm(ui);
  secondEvents.length = 0;
  await ui.confirm("After shutdown", "No wrapper remains");
  assert.deepEqual(secondEvents, []);
});

test("Stargate header remains width-safe and reuses its protocol image", async () => {
  const handlers = new Map();
  const commands = new Map();
  let headerFactory;
  const headerContext = {
    ...extensionContext,
    hasUI: true,
    model: {
      provider: "openai-codex",
      id: "gpt-5.6-sol",
    },
    ui: {
      ...extensionContext.ui,
      setHeader(factory) {
        headerFactory = factory;
      },
    },
  };

  const module = await import("../extensions/stargate-header.ts");
  module.default({
    on(name, handler) {
      handlers.set(name, handler);
    },
    registerCommand(name, definition) {
      commands.set(name, definition);
    },
    getAllTools() {
      return [];
    },
  });

  assert.deepEqual(
    [...handlers.keys()],
    ["session_start", "resources_discover", "before_agent_start", "model_select"],
  );
  assert.ok(commands.has("header"));
  assert.ok(commands.has("refresh-header"));

  await handlers.get("session_start")({ type: "session_start", reason: "startup" }, headerContext);
  assert.equal(typeof headerFactory, "function");
  const theme = { fg: (_color, text) => text };
  const header = headerFactory(undefined, theme);
  for (const width of [20, 46, 80, 160]) {
    const lines = header.render(width);
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => visibleWidth(line) <= width));
  }
  header.invalidate();

  const source = await readFile(new URL("../extensions/stargate-header.ts", import.meta.url), "utf8");
  assert.match(source, /protocolGateImage \?\?= new Image/);
  assert.match(source, /protocolGateImage\.render\(imageWidth \+ 2\)/);
});

test("Token footer does not count unrelated tool arguments as chat", async () => {
  const handlers = new Map();
  let footerFactory;
  const footerContext = {
    ...extensionContext,
    hasUI: true,
    model: {
      provider: "openai-codex",
      id: "gpt-5.6-sol",
      contextWindow: 128_000,
      reasoning: true,
    },
    getContextUsage() {
      return { tokens: 1_000, contextWindow: 128_000, percent: 0.78125 };
    },
    ui: {
      ...extensionContext.ui,
      setFooter(factory) {
        footerFactory = factory;
      },
    },
  };

  const module = await import("../extensions/token-speed.ts");
  module.default({
    on(name, handler) {
      handlers.set(name, handler);
    },
    getThinkingLevel() {
      return "low";
    },
  });

  await handlers.get("session_start")({ type: "session_start", reason: "startup" }, footerContext);
  await handlers.get("message_start")({ message: { role: "assistant" } }, footerContext);
  await handlers.get("message_update")({
    assistantMessageEvent: { type: "text_delta", delta: "t".repeat(40) },
  }, footerContext);
  await handlers.get("message_update")({
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 0,
      partial: { content: [{ type: "toolCall", name: "bash" }] },
    },
  }, footerContext);
  await handlers.get("message_update")({
    assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: "b".repeat(180) },
  }, footerContext);
  await handlers.get("message_update")({
    assistantMessageEvent: {
      type: "toolcall_start",
      contentIndex: 1,
      partial: { content: [{ type: "toolCall", name: "bash" }, { type: "toolCall", name: "edit" }] },
    },
  }, footerContext);
  await handlers.get("message_update")({
    assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: "w".repeat(180) },
  }, footerContext);
  await handlers.get("message_end")({
    message: { role: "assistant", usage: { output: 100 } },
  }, footerContext);

  assert.equal(typeof footerFactory, "function");
  const theme = { fg: (_color, text) => text };
  const footer = footerFactory(undefined, theme, { getGitBranch: () => "master" });
  const line = footer.render(300)[0];
  assert.match(line, /talk 10/);
  assert.match(line, /write 45/);
  assert.doesNotMatch(line, /talk 55|talk 100/);
});
