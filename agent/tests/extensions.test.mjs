import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const extensionContext = {
  cwd: "C:/Users/Sebas/.pi",
  hasUI: false,
  mode: "tui",
  ui: {
    async confirm() {
      throw new Error("Unexpected confirmation in extension test");
    },
    notify() {},
    setStatus() {},
  },
};

test("Pi 0.83 extension registrations and cancellation contract", async () => {
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
      ["agent_start", "tool_execution_start", "tool_execution_end", "agent_end", "agent_settled", "session_shutdown"],
    );
    assert.ok(alarmCommands.has("alarm-sounds"));

    // Disable playback, then exercise the Pi 0.83 low-level-end → settled flow.
    await alarmCommands.get("alarm-sounds").handler("off", extensionContext);
    await alarmHandlers.get("agent_start")({ type: "agent_start" }, extensionContext);
    await alarmHandlers.get("agent_end")({
      type: "agent_end",
      messages: [{ role: "assistant", stopReason: "stop" }],
    }, extensionContext);
    await alarmHandlers.get("agent_settled")({ type: "agent_settled" }, extensionContext);

    const updateTools = new Map();
    const updateCommands = new Map();
    let execCalls = 0;
    const updateModule = await import("../extensions/pi-autoupdate.ts");
    await updateModule.default({
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

    // The recovery patch must remain inside finally and run before lock release.
    const source = await readFile(new URL("../extensions/pi-autoupdate.ts", import.meta.url), "utf8");
    const maintenanceStart = source.indexOf("async function runUpdateWithPostPatches");
    const finallyStart = source.indexOf("} finally {", maintenanceStart);
    const recoveryPatch = source.indexOf("ensurePiIntercomBrokerCwdPatch(cwd)", finallyStart);
    const lockRelease = source.indexOf("await intercomLock.release()", finallyStart);
    assert.ok(maintenanceStart >= 0 && finallyStart > maintenanceStart);
    assert.ok(recoveryPatch > finallyStart && lockRelease > recoveryPatch);
  } finally {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    await rm(temporaryAgentDir, { recursive: true, force: true });
  }
});
