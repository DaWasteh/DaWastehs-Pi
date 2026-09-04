import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { rankSkills } from "../extensions/skill-governor/policy.ts";
import { isLocal, mergeConfig } from "../extensions/skill-governor/index.ts";

function createSkill(name, description, path = `${name}/SKILL.md`) {
	return { name, description, filePath: path, baseDir: name, sourceInfo: {}, disableModelInvocation: false };
}

test("governor config validation degrades malformed fields to defaults instead of throwing", () => {
	const merged = mergeConfig({ enabled: "yes", routing: { maxSkills: 0, minScore: "2", maxSkillsLocal: 2 }, localTools: { keep: "read", blocked: ["skill_manage"], interactiveOnly: 1 } });
	assert.equal(merged.enabled, true);
	assert.equal(merged.routing.maxSkills, 3);
	assert.equal(merged.routing.minScore, 2);
	assert.equal(merged.routing.maxSkillsLocal, 2);
	assert.deepEqual(merged.localTools.keep, ["read", "bash", "edit", "write", "capability_route"]);
	assert.deepEqual(merged.localTools.blocked, ["skill_manage"]);
	assert.equal(merged.localTools.interactiveOnly, true);
	assert.deepEqual(mergeConfig(null).routing, { maxSkills: 3, maxSkillsLocal: 1, maxLocalSystemPromptBytes: 900, minScore: 2 });
});

test("local provider detection covers the AutoTuner gateway and anchors loopback origins", () => {
	assert.equal(isLocal({ provider: "autotuner", id: "qwen3.8-27b", baseUrl: "http://127.0.0.1:1233/v1" }), true);
	assert.equal(isLocal({ provider: "custom", id: "x", baseUrl: "http://0.0.0.0:8080/v1" }), true);
	assert.equal(isLocal({ provider: "custom", id: "x", baseUrl: "http://[::1]:8080" }), true);
	assert.equal(isLocal({ provider: "llama-server=http://127.0.0.1:1234", id: "Qwen3.8-27B" }), true);
	assert.equal(isLocal({ provider: "custom", id: "x", baseUrl: "http://localhost.example.com/v1" }), false);
	assert.equal(isLocal({ provider: "custom", id: "x", baseUrl: "https://api.example.com/?redirect=http://localhost" }), false);
	assert.equal(isLocal({ provider: "openai-codex", id: "gpt-5.6-sol", baseUrl: "https://chatgpt.com/backend-api" }), false);
	assert.equal(isLocal(undefined), false);
});

test("routing ignores two-character tokens, generic verbs, and bare name substrings", () => {
	const catalog = [
		createSkill("debug-voxengine-visual-smoke", "Debug VoxEngine visual smoke failures. Do not use otherwise."),
		createSkill("smoke-test-flora-ui-interactions", "Smoke-test the Flora UI interactions. Do not use otherwise."),
		createSkill("fix-comfyui-workflows-against-installed-nodes", "Fix ComfyUI workflows against installed nodes. Do not use otherwise."),
		createSkill("pi-model-routing", "Route Pi models between cloud tiers. Do not use otherwise."),
		createSkill("amd-dual-gpu-inference", "Tune llama-server tensor split and OOM handling on dual AMD GPUs. Do not use for builds."),
	];
	assert.deepEqual(rankSkills("ok mach weiter", catalog, 2, 3), []);
	assert.deepEqual(rankSkills("Erkläre mir das Qt-UI", catalog, 2, 3), []);
	assert.deepEqual(rankSkills("fix the ts error", catalog, 2, 3), []);
	const routed = rankSkills("Der llama-server bekommt OOM, tensor split anpassen", catalog, 2, 3);
	assert.equal(routed[0]?.skill.name, "amd-dual-gpu-inference");
	assert.equal(routed.length, 1);
	assert.equal(rankSkills("smoke test for flora ui", catalog, 2, 3)[0]?.skill.name, "smoke-test-flora-ui-interactions");
});

function governorMock(initial) {
	const handlers = new Map();
	const tools = new Map();
	const entries = [];
	let active = [...initial];
	// Pi's getAllTools lists every configured tool, including ones the governor hid.
	const allTools = [...new Set([...initial, "subagent", "release_tool", "skill_manage"])];
	return {
		api: {
			on(name, handler) { handlers.set(name, handler); },
			registerTool(tool) { tools.set(tool.name, tool); },
			registerCommand() {},
			getActiveTools() { return [...active]; },
			setActiveTools(next) { active = [...new Set(next)]; },
			getAllTools() { return allTools.map((name) => ({ name, description: `${name} tool`, sourceInfo: {} })); },
			appendEntry(customType, data) { entries.push({ type: "custom", customType, data }); },
			async exec() { return { code: 1, stdout: "", stderr: "", killed: false }; },
		},
		handlers,
		entries,
		get active() { return active; },
	};
}

test("the governor-owned tool delta survives /reload and is restored on the next cloud switch", async () => {
	const root = await mkdtemp(join(tmpdir(), "governor-reload-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = root;
	try {
		await mkdir(join(root, "skill-governor"), { recursive: true });
		const local = { provider: "autotuner", id: "qwen3.8-27b", baseUrl: "http://127.0.0.1:1233/v1" };
		const first = governorMock(["read", "bash", "edit", "write", "subagent", "skill_manage"]);
		const firstModule = await import(`../extensions/skill-governor/index.ts?reload-a=${Date.now()}`);
		firstModule.default(first.api);
		const ui = { notify() {} };
		await first.handlers.get("session_start")({ type: "session_start", reason: "startup" }, { cwd: root, hasUI: true, model: local, ui, sessionManager: { getEntries: () => [] } });
		assert.equal(first.active.includes("subagent"), false, "local profile hides the subagent tool");
		assert.ok(first.entries.some((entry) => entry.customType === "skill-governor" && entry.data.removed.includes("subagent")));

		// /reload: a fresh instance starts from the already reduced tool set and
		// only sees the previous instance's session entries.
		const second = governorMock(first.active);
		const secondModule = await import(`../extensions/skill-governor/index.ts?reload-b=${Date.now()}`);
		secondModule.default(second.api);
		const ctx = { cwd: root, hasUI: true, model: local, ui, sessionManager: { getEntries: () => first.entries } };
		await second.handlers.get("session_start")({ type: "session_start", reason: "reload" }, ctx);
		assert.equal(second.active.includes("subagent"), false, "local profile stays reduced after reload");
		await second.handlers.get("model_select")({ type: "model_select", model: { provider: "openai-codex", id: "gpt-5.6-sol" }, source: "set" }, ctx);
		assert.ok(second.active.includes("subagent"), "cloud switch restores the delta recovered from the session");
		assert.equal(second.active.includes("skill_manage"), true);

		// A plain startup never replays old entries.
		const third = governorMock(first.active);
		const thirdModule = await import(`../extensions/skill-governor/index.ts?reload-c=${Date.now()}`);
		thirdModule.default(third.api);
		await third.handlers.get("session_start")({ type: "session_start", reason: "startup" }, { ...ctx, model: { provider: "openai-codex", id: "gpt-5.6-sol" } });
		assert.equal(third.active.includes("subagent"), false);
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous;
		await rm(root, { recursive: true, force: true });
	}
});

function validatorMock(execImplementation) {
	const handlers = new Map();
	const sent = [];
	const execCalls = [];
	return {
		api: {
			on(name, handler) { handlers.set(name, handler); },
			async exec(command, args, options) { execCalls.push({ command, args, options }); return execImplementation(command, args, options); },
			sendMessage(message, options) { sent.push({ message, options }); },
			appendEntry() {},
		},
		handlers,
		sent,
		execCalls,
	};
}

async function runValidator(root, files, execImplementation, suffix) {
	const mock = validatorMock(execImplementation);
	const module = await import(`../extensions/post-edit-validation.ts?${suffix}=${Date.now()}`);
	module.default(mock.api);
	const ctx = { cwd: root, hasUI: false, mode: "json", ui: { setStatus() {} } };
	await mock.handlers.get("session_start")({}, ctx);
	for (const file of files) await mock.handlers.get("tool_result")({ toolName: "write", input: { path: file }, isError: false }, ctx);
	await mock.handlers.get("turn_end")({ type: "turn_end", toolResults: [] }, ctx);
	return { mock, module };
}

test("validator timeouts are failures and silent spawn failures are treated as unavailable runtimes", async () => {
	const root = await mkdtemp(join(tmpdir(), "post-edit-v28-"));
	try {
		await writeFile(join(root, "script.mjs"), "export {};\n", "utf8");
		const killed = await runValidator(root, ["script.mjs"], async () => ({ code: 0, stdout: "", stderr: "", killed: true }), "killed");
		assert.equal(killed.mock.sent.length, 1, "a killed validator never counts as success");
		assert.match(killed.mock.sent[0].message.content, /timed out/);

		await writeFile(join(root, "script.py"), "print(1)\n", "utf8");
		const missing = await runValidator(root, ["script.py"], async () => ({ code: 1, stdout: "", stderr: "", killed: false }), "missing");
		assert.equal(missing.mock.execCalls.length, 1);
		assert.equal(missing.mock.sent.length, 0, "code 1 without any output is the missing-interpreter signature");

		const real = await runValidator(root, ["script.py"], async () => ({ code: 1, stdout: "", stderr: "SyntaxError: invalid syntax", killed: false }), "real");
		assert.equal(real.mock.sent.length, 1, "real diagnostics still fail");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("JSON-with-comments files are not parsed strictly and Git Bash is preferred on Windows", async () => {
	const root = await mkdtemp(join(tmpdir(), "post-edit-jsonc-"));
	try {
		await writeFile(join(root, "tsconfig.json"), "{\n  // comment\n  \"compilerOptions\": {}\n}\n", "utf8");
		await mkdir(join(root, ".vscode"), { recursive: true });
		await writeFile(join(root, ".vscode", "settings.json"), "{ /* block */ }", "utf8");
		await writeFile(join(root, "plain.json"), "{", "utf8");
		const { mock, module } = await runValidator(root, ["tsconfig.json", join(".vscode", "settings.json"), "plain.json"], async () => ({ code: 0, stdout: "", stderr: "", killed: false }), "jsonc");
		assert.equal(mock.sent.length, 1);
		assert.match(mock.sent[0].message.content, /plain\.json/);
		assert.doesNotMatch(mock.sent[0].message.content, /tsconfig\.json|settings\.json/);
		assert.equal(module.postEditValidationInternals.isJsonWithComments("C:\\repo\\tsconfig.build.json"), true);
		assert.equal(module.postEditValidationInternals.isJsonWithComments("/repo/package.json"), false);

		await writeFile(join(root, "run.sh"), "echo ok\n", "utf8");
		const checks = await module.postEditValidationInternals.checksForFiles([join(root, "run.sh")]);
		for (const check of checks) {
			if (process.platform === "win32") assert.match(check.command, /Git[\\/](?:usr[\\/])?bin[\\/]bash\.exe$/i);
			else assert.equal(check.command, "bash");
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("TypeScript diagnostics are focused on the edited files and feedback keeps its footer under the cap", async () => {
	const module = await import(`../extensions/post-edit-validation.ts?focus=${Date.now()}`);
	const { focusTypeScriptOutput, failureMessage, MAX_FEEDBACK_CHARS } = module.postEditValidationInternals;
	const cwd = "C:\\repo";
	const focused = focusTypeScriptOutput(
		["extensions/a.ts(3,5): error TS2322: bad", "legacy/old.ts(1,1): error TS7006: implicit any", ...Array.from({ length: 12 }, (_, i) => `legacy/n${i}.ts(1,1): error TS1`)].join("\n"),
		["C:\\repo\\extensions\\a.ts"],
		cwd,
	);
	assert.match(focused, /^extensions\/a\.ts\(3,5\): error TS2322: bad/);
	assert.match(focused, /Diagnostics outside the edited files \(13; fix only if caused by this edit/);
	assert.match(focused, /… 5 more/);

	const message = failureMessage({
		schemaVersion: 1,
		status: "failed",
		round: 2,
		files: ["a.ts", "b.ts"],
		feedbackLimit: 2,
		results: [
			{ name: "typescript-noemit", files: ["a.ts"], command: "tsc", exitCode: 2, output: `<${"x".repeat(9_000)}>` },
			{ name: "json-parse", files: ["b.json"], exitCode: 1, output: "&".repeat(9_000) },
		],
	});
	assert.ok(message.length <= MAX_FEEDBACK_CHARS, `message length ${message.length}`);
	assert.match(message, /final automatic repair round/);
	assert.ok(message.endsWith("</post-edit-validation>"));
	assert.match(message, /… \(truncated\)/);
	assert.match(message, /json-parse: b\.json/);
});
