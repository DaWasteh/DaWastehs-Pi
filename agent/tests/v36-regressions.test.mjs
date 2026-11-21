import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const patches = createRequire(import.meta.url)("../npm/patches/postinstall.cjs");

test("pi-subagents 0.89.2 presetRunId ?? randomUUID() is recognized as filesystem-safe without rewriting", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-subagents-v36-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "src/runs/foreground"), { recursive: true });
  const target = join(root, "src/runs/foreground/subagent-executor.js");
  const upstream089 = 'import { randomUUID } from "node:crypto";\nconst workflowRunId = asyncWorkflow ? workflowResumeLaunch?.presetRunId ?? randomUUID() : undefined;\n';
  await writeFile(target, upstream089, "utf8");
  assert.equal(patches.hasFilesystemSafePiSubagentsAsyncWorkflowId(upstream089), true);
  assert.deepEqual(patches.patchPiSubagents(root), { found: true, changed: false, path: target });
  assert.equal(await readFile(target, "utf8"), upstream089);

  // Unsafe expressions still fail closed.
  for (const unsafe of [
    'const workflowRunId = asyncWorkflow ? _id ?? randomUUID() : undefined;',
    'const workflowRunId = asyncWorkflow ? customId : undefined;',
  ]) {
    assert.equal(patches.hasFilesystemSafePiSubagentsAsyncWorkflowId(unsafe), false);
  }
});

test("pix-optimizer 1.3.14 native binaries resolver is recognized while legacy which-probe still patches", async () => {
  const { patchPixOptimizerRtkSource } = await import("../extensions/pi-autoupdate.ts");
  const upstream13 = `import { resolveTool } from "@xynogen/pix-runtime/binaries";\nexport function probeRtk() { return resolveTool("rtk"); }\n`;
  assert.deepEqual(patchPixOptimizerRtkSource(upstream13), { status: "upstream-native", next: upstream13 });

  const legacy = `\t// Check if rtk binary is available
\tconst checkRtkAvailability = async (): Promise<RtkStatus> => {
\t\t// Cache for 60 seconds
\t\tif (rtkStatus && Date.now() - rtkStatus.checkedAt < 60000) {
\t\t\treturn rtkStatus;
\t\t}

\t\ttry {
\t\t\tconst result = await pi.exec("which", ["rtk"], { timeout: 1000 });
\t\t\tif (result.code === 0 && result.stdout?.trim()) {
\t\t\t\trtkStatus = {
\t\t\t\t\tavailable: true,
\t\t\t\t\tcheckedAt: Date.now(),
\t\t\t\t\tpath: result.stdout.trim(),
\t\t\t\t};
\t\t\t\twarnedMissing = false;
\t\t\t\treturn rtkStatus;
\t\t\t}
\t\t} catch (_error) {
\t\t\t// which command failed
\t\t}

\t\trtkStatus = {
\t\t\tavailable: false,
\t\t\tcheckedAt: Date.now(),
\t\t};
\t\treturn rtkStatus;
\t};
const hint = "rtk not found — RTK rewriting disabled. Install: cargo install rtk-ai";`;
  const patched = patchPixOptimizerRtkSource(legacy);
  assert.equal(patched.status, "patched");
  assert.match(patched.next, /cargo install --git https:\/\/github\.com\/rtk-ai\/rtk/);
  assert.equal(patchPixOptimizerRtkSource(patched.next).status, "already-patched");
  assert.equal(patchPixOptimizerRtkSource("export function unknownRtk() {}").status, "unsupported");
});

test("/update models delegates to pi update --models", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-update-models-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
  const shim = join(bin, process.platform === "win32" ? "pi.cmd" : "pi");
  await writeFile(shim, process.platform === "win32" ? "@echo off\r\necho stub-models %*\r\n" : '#!/bin/sh\necho stub-models "$@"\n');
  if (process.platform !== "win32") await chmod(shim, 0o755);

  const previousPath = process.env.PATH;
  process.env.PATH = bin + delimiter + previousPath;
  try {
    const commands = new Map();
    const notices = [];
    const { default: update } = await import(`../extensions/pi-autoupdate.ts?models=${Date.now()}`);
    await update({
      on() {},
      registerTool() {},
      registerCommand(name, command) { commands.set(name, command); },
      async exec() { throw new Error("unexpected exec"); },
    });
    await commands.get("update").handler("models", {
      cwd: root,
      ui: { setStatus() {}, notify: (msg, level) => notices.push({ msg, level }) },
    });
    assert.equal(notices.length, 1);
    assert.equal(notices[0].level, "info");
    assert.match(notices[0].msg, /stub-models update --models/);
  } finally {
    process.env.PATH = previousPath;
  }
});

test("post-edit-validation handles Pi 1.5+/1.6 spawn ENOENT stderr, truncated output, and deleted files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "post-edit-v36-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const { default: postEditValidation, isSpawnMissingOutput } = await import(`../extensions/post-edit-validation.ts?v36=${Date.now()}`);
  assert.equal(isSpawnMissingOutput("", ""), true);
  assert.equal(isSpawnMissingOutput("", "spawn python ENOENT"), true);
  assert.equal(isSpawnMissingOutput("", "SyntaxError: invalid syntax"), false);
  assert.equal(isSpawnMissingOutput("some output", "spawn python ENOENT"), false);

  const runCase = async (file, content, execImpl, deleteBeforeTurnEnd = false) => {
    const handlers = new Map();
    const sent = [];
    postEditValidation({
      on(name, handler) { handlers.set(name, handler); },
      async exec(cmd, args, opts) { return execImpl(cmd, args, opts); },
      sendMessage(message, options) { sent.push({ message, options }); },
      appendEntry() {},
    });
    const ctx = { cwd: root, hasUI: false, mode: "json", ui: { setStatus() {} } };
    await handlers.get("session_start")({}, ctx);
    const fullPath = join(root, file);
    await writeFile(fullPath, content, "utf8");
    await handlers.get("tool_result")({ toolName: "write", input: { path: file }, isError: false }, ctx);
    if (deleteBeforeTurnEnd) await unlink(fullPath);
    await handlers.get("turn_end")({ type: "turn_end", toolResults: [] }, ctx);
    return sent;
  };

  // Pi 1.5+ ENOENT message in stderr is treated as unavailable runtime, not failure.
  const enoentSent = await runCase("a.py", "print(1)\n", async () => ({
    code: 1, stdout: "", stderr: "spawn python ENOENT", killed: false, truncated: false,
  }));
  assert.equal(enoentSent.length, 0);

  // Truncated output with killed=true is an explicit failure.
  const truncatedSent = await runCase("b.mjs", "export {};\n", async () => ({
    code: 143, stdout: "lots of output", stderr: "", killed: true, truncated: true,
  }));
  assert.equal(truncatedSent.length, 1);
  assert.match(truncatedSent[0].message.content, /buffer limit/);

  // File created and deleted in the same turn is skipped cleanly.
  const deletedSent = await runCase("gone.json", "{", async () => ({
    code: 0, stdout: "", stderr: "", killed: false, truncated: false,
  }), true);
  assert.equal(deletedSent.length, 0);
});

test("skill-governor handles Pi 1.2+ BeforeAgentStartCustomEvent without prompt or spurious routing", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "skill-gov-custom-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "skill-governor"), { recursive: true });
  const prev = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = root;
  try {
    const handlers = new Map();
    const { default: skillGovernor } = await import(`../extensions/skill-governor/index.ts?custom=${Date.now()}`);
    skillGovernor({
      on(name, handler) { handlers.set(name, handler); },
      registerTool() {},
      registerCommand() {},
      getActiveTools() { return ["read", "bash", "edit", "write"]; },
      setActiveTools() {},
      getAllTools() { return []; },
      appendEntry() {},
      async exec() { return { code: 1, stdout: "", stderr: "", killed: false, truncated: false }; },
    });
    const ctx = { cwd: root, hasUI: true, model: { provider: "openai-codex", id: "gpt-6-astra" }, ui: { notify() {} }, sessionManager: { getEntries: () => [] } };
    await handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
    const skill = { name: "parser-debug", description: "Debug parser errors", filePath: "skills/parser/SKILL.md", baseDir: "skills/parser", sourceInfo: {}, disableModelInvocation: false };
    const customResult = await handlers.get("before_agent_start")({
      type: "before_agent_start",
      messageType: "custom",
      message: { role: "custom", customType: "post-edit-validation", content: "parser error", display: false },
      systemPrompt: "base\n\nThe following skills provide specialized instructions for specific tasks.\n<available_skills></available_skills>",
      systemPromptOptions: { skills: [skill], cwd: root },
    }, ctx);
    assert.equal(customResult.systemPrompt, "base");
  } finally {
    if (prev === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = prev;
  }
});

test("token-speed maps max thinking level to thinkingMax and stargate-sg1 uses Pi 1.2+ schema", async () => {
  const handlers = new Map();
  let footerFactory;
  const ctx = {
    cwd: "C:/Users/Sebas/.pi",
    hasUI: true,
    model: { provider: "openai-codex", id: "gpt-6.2-astra", contextWindow: 272_000, reasoning: true },
    getContextUsage: () => ({ tokens: 1000, contextWindow: 272_000, percent: 0.4 }),
    ui: { setFooter(factory) { footerFactory = factory; } },
  };
  const { default: tokenSpeed } = await import(`../extensions/token-speed.ts?max=${Date.now()}`);
  tokenSpeed({
    on(name, handler) { handlers.set(name, handler); },
    getThinkingLevel: () => "max",
  });
  await handlers.get("session_start")({ type: "session_start", reason: "startup" }, ctx);
  const seenColors = [];
  const theme = { fg(color, text) { seenColors.push([color, text]); return text; } };
  const footer = footerFactory(undefined, theme, { getGitBranch: () => "master" });
  footer.render(200);
  assert.ok(seenColors.some(([color, text]) => color === "thinkingMax" && text === "[max]"));

  const themeJson = JSON.parse(await readFile(new URL("../themes/stargate-sg1.json", import.meta.url), "utf8"));
  assert.equal(themeJson.$schema, "https://pi.dev/schemas/theme.schema.json");
  assert.ok(themeJson.colors.thinkingMax);
  assert.ok(themeJson.colors.scrollbarTrack);
  assert.ok(themeJson.colors.scrollbarThumb);
});

test("every published skill fits within the 900-byte local prompt budget even with a 60-char cwd", async () => {
  const { parseFrontmatterField } = await import("../extensions/skill-governor/policy.ts");
  const agentRoot = fileURLToPath(new URL("../", import.meta.url));
  const compactBase = "You are Pi, a coding agent. Obey exact user requirements and repository evidence. Before edits, read applicable AGENTS.md, CLAUDE.md, and PLAN.md. Use schema-valid active-tool calls; trust real results. Make the smallest complete safe change. Fix validator errors before success. Use capability_route for hidden skills/tools.\ncwd: H:\\LAB\\DaWastehs-ComfyUI-Bundle\\subproject-directory-example";
  const baseBytes = Buffer.byteLength(compactBase, "utf8");

  async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(full));
      else if (entry.name === "SKILL.md") out.push(full);
    }
    return out;
  }

  const files = [...await walk(join(agentRoot, "skills")), ...await walk(join(agentRoot, "projects-memory"))];
  assert.ok(files.length >= 90);
  const oversized = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    const name = parseFrontmatterField(text, "name") ?? "";
    const description = parseFrontmatterField(text, "description") ?? "";
    const descriptor = `\n<routed-skill>\nname: ${name}\ndescription: ${description}\npath: ${resolve(file)}\nRead this path when relevant.\n</routed-skill>`;
    const total = baseBytes + Buffer.byteLength(descriptor, "utf8");
    if (total > 900) oversized.push(`${file} (${total} B)`);
  }
  assert.deepEqual(oversized, [], "Skills exceeding 900-byte local prompt budget");
});
