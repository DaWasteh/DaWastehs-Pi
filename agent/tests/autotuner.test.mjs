import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const TOKEN = "test-token-0123456789abcdef";

/** Minimal stand-in for AutoTuner's control API (docs/control-api.md). */
async function startFakeGateway(options = {}) {
	const calls = [];
	const state = {
		active: options.active ?? null,
		loading: null,
		switchDelayMs: options.switchDelayMs ?? 0,
		failSwitchWith: options.failSwitchWith,
		models: options.models ?? [
			{ id: "qwen3.8-27b", name: "Qwen3.8 27B", context_window: 32768, max_tokens: 8192, reasoning: true, input: ["text"], path: "I:\\models\\q.gguf", runnable: true, unavailable_reason: "" },
			{ id: "gemma-4-31b", name: "Gemma 4 31B", context_window: 131072, max_tokens: 16384, reasoning: false, input: ["text", "image"], path: "I:\\models\\g.gguf", runnable: true, unavailable_reason: "" },
			{ id: "mmproj-only", name: "Vision projector", context_window: 4096, max_tokens: 1024, reasoning: false, input: ["text"], path: "I:\\models\\m.gguf", runnable: false, unavailable_reason: "multimodal projector, not a chat model" },
		],
	};
	const status = () => ({
		status: state.loading ? "loading" : state.active ? "ready" : "idle",
		active_model: state.active,
		loading_model: state.loading,
		active_since: state.active ? Date.now() / 1000 - 120 : null,
		inflight_requests: 0,
		endpoint: `http://127.0.0.1:${server.address().port}`,
	});
	const send = (res, code, body) => {
		const text = JSON.stringify(body);
		res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(text), Connection: "close" });
		res.end(text);
	};
	const error = (res, code, message, errorCode) => send(res, code, { error: { message, type: "autotuner_control_error", code: errorCode } });
	const server = createServer((req, res) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
			calls.push({ method: req.method, path: req.url, auth: req.headers.authorization, body });
			if (req.url === "/health") return send(res, 200, { status: "ok", service: "autotuner-control-api", version: "5.3.9" });
			if (req.headers.authorization !== `Bearer ${TOKEN}`) return error(res, 401, "A valid AutoTuner bearer token is required.", "unauthorised");
			if (req.url === "/v1/models") {
				return send(res, 200, { object: "list", data: state.models.filter((m) => m.runnable).map(({ path, runnable, unavailable_reason, ...rest }) => rest) });
			}
			if (req.url === "/api/v1/models") return send(res, 200, { models: state.models, ...status() });
			if (req.url === "/api/v1/status") return send(res, 200, status());
			if (req.url === "/api/v1/switch" && req.method === "POST") {
				const model = state.models.find((m) => m.id === body.model_id);
				if (!model) return error(res, 404, `Unknown AutoTuner model ID: ${body.model_id}`, "model_not_found");
				if (!model.runnable) return error(res, 409, model.unavailable_reason, "model_not_runnable");
				if (state.failSwitchWith) return error(res, 409, "busy", state.failSwitchWith);
				if (state.active === model.id) return send(res, 200, status());
				state.loading = model.id;
				setTimeout(() => {
					state.active = model.id;
					state.loading = null;
					send(res, 200, status());
				}, state.switchDelayMs);
				return;
			}
			if (req.url === "/api/v1/stop" && req.method === "POST") {
				state.active = null;
				return send(res, 200, status());
			}
			return error(res, 404, "Endpoint not found.", "not_found");
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	return {
		calls,
		state,
		root: `http://127.0.0.1:${server.address().port}`,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
}

function fakePi() {
	const handlers = new Map();
	const commands = new Map();
	const providers = [];
	const setModelCalls = [];
	return {
		handlers,
		commands,
		providers,
		setModelCalls,
		api: {
			on(name, handler) {
				handlers.set(name, handler);
			},
			registerCommand(name, definition) {
				commands.set(name, definition);
			},
			registerProvider(name, config) {
				providers.push({ name, config });
			},
			async setModel(model) {
				setModelCalls.push(model);
				return true;
			},
		},
	};
}

function fakeContext(overrides = {}) {
	const notifications = [];
	const statuses = [];
	const registry = new Map();
	return {
		notifications,
		statuses,
		registry,
		ctx: {
			cwd: "C:/Users/Sebas/.pi",
			hasUI: true,
			mode: "tui",
			model: undefined,
			modelRegistry: {
				find(provider, id) {
					return registry.get(`${provider}/${id}`);
				},
				async refresh() {
					return { aborted: false, errors: new Map() };
				},
			},
			ui: {
				notify(message, level) {
					notifications.push({ message, level });
				},
				setStatus(key, text) {
					statuses.push({ key, text });
				},
				async select() {
					throw new Error("Unexpected selection");
				},
				async confirm() {
					throw new Error("Unexpected confirmation");
				},
			},
			...overrides,
		},
	};
}

async function withEnv(values, run) {
	const previous = {};
	for (const [key, value] of Object.entries(values)) {
		previous[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return await run();
	} finally {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

const ENV_KEYS = ["AUTOTUNER_API_URL", "AUTOTUNER_API_KEY", "AUTOTUNER_CONTROL_API_KEY", "AUTOTUNER_CONTROL_API_PORT", "AUTOTUNER_CONTROL_API_ENABLED", "AUTOTUNER_DATA_DIR"];
// Every test isolates the AutoTuner data directory so the developer's real
// ~/.autotuner (sidecar, 36 MB settings file) never influences the outcome.
const EMPTY_DATA_DIR = await mkdtemp(join(tmpdir(), "autotuner-ext-empty-data-"));
process.on("exit", () => {
	try {
		rmSync(EMPTY_DATA_DIR, { recursive: true, force: true });
	} catch {
		// best effort
	}
});
const cleanEnv = { ...Object.fromEntries(ENV_KEYS.map((key) => [key, undefined])), AUTOTUNER_DATA_DIR: EMPTY_DATA_DIR };

test("credential discovery prefers the sidecar, scans the large settings file without JSON.parse, and honours disabled flags", async () => {
	const { parseSettingsCredentials, parseSidecar, resolveGateway, isConfigured, normalizeRoot } = await import("../extensions/autotuner.ts");
	const dir = await mkdtemp(join(tmpdir(), "autotuner-ext-"));
	try {
		// Legacy layout: only the multi-megabyte settings file exists. It is
		// larger than any JSON.parse guard and still yields the credentials.
		const filler = `"performance_run_results": ${JSON.stringify(Array.from({ length: 40_000 }, (_, i) => ({ run: i, score: "x".repeat(60) })))}`;
		const settings = `{\n${filler},\n"control_api_enabled": true,\n"control_api_port": 1240,\n"control_api_token": "${TOKEN}",\n"base_port": 1234\n}`;
		assert.ok(settings.length > 2 * 1024 * 1024, "fixture must exceed the former 2 MiB guard");
		await writeFile(join(dir, "autotuner_settings.json"), settings, "utf8");
		const fromSettings = await withEnv({ ...cleanEnv, AUTOTUNER_DATA_DIR: dir }, () => resolveGateway());
		assert.deepEqual(fromSettings, { root: "http://127.0.0.1:1240", token: TOKEN, enabled: true, source: "settings" });
		assert.equal(isConfigured(fromSettings), true);

		// Regex scan semantics on the raw text.
		assert.equal(parseSettingsCredentials('{"a":1}'), undefined);
		assert.deepEqual(parseSettingsCredentials('{"control_api_enabled": false, "control_api_token": "short"}'), { enabled: false });
		const escapedToken = 'esc"aped-0123456789abcdef';
		assert.deepEqual(parseSettingsCredentials('{"control_api_token": ' + JSON.stringify(escapedToken) + "}"), { token: escapedToken });

		// The sidecar wins over the settings file, including enabled=false.
		await writeFile(join(dir, "control_api.json"), JSON.stringify({ schema: 1, enabled: false, port: 1233, version: "5.3.9" }), "utf8");
		const disabled = await withEnv({ ...cleanEnv, AUTOTUNER_DATA_DIR: dir }, () => resolveGateway());
		assert.equal(disabled.source, "sidecar");
		assert.equal(disabled.enabled, false);
		assert.equal(disabled.token, "");
		assert.equal(isConfigured(disabled), false);

		await writeFile(join(dir, "control_api.json"), JSON.stringify({ schema: 1, enabled: true, base_url: "http://localhost:1250/v1/", port: 1250, token: TOKEN }), "utf8");
		const enabled = await withEnv({ ...cleanEnv, AUTOTUNER_DATA_DIR: dir }, () => resolveGateway());
		assert.deepEqual(enabled, { root: "http://localhost:1250", token: TOKEN, enabled: true, source: "sidecar" });
		assert.equal(parseSidecar('{"schema": 2, "token": "' + TOKEN + '"}'), undefined, "unknown schema versions are ignored");
		assert.equal(parseSidecar("not json"), undefined);

		// Environment overrides take precedence over any file.
		const env = await withEnv({ ...cleanEnv, AUTOTUNER_DATA_DIR: dir, AUTOTUNER_API_URL: "http://127.0.0.1:1299/v1", AUTOTUNER_API_KEY: "env-token-0123456789abcdef" }, () => resolveGateway());
		assert.deepEqual(env, { root: "http://127.0.0.1:1299", token: "env-token-0123456789abcdef", enabled: true, source: "env" });
		const forcedOff = await withEnv({ ...cleanEnv, AUTOTUNER_DATA_DIR: dir, AUTOTUNER_CONTROL_API_ENABLED: "0" }, () => resolveGateway());
		assert.equal(isConfigured(forcedOff), false);

		assert.throws(() => normalizeRoot("https://127.0.0.1:1233"), /must use http/);
		assert.throws(() => normalizeRoot("http://192.168.0.5:1233"), /loopback/);
		assert.equal(normalizeRoot("http://user:pw@localhost:1233/v1?x=1#f"), "http://localhost:1233");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("provider registration maps the catalogue, keeps the list offline, and refreshes it online", async () => {
	const gateway = await startFakeGateway();
	try {
		const { api, providers } = fakePi();
		const module = await import("../extensions/autotuner.ts");
		await withEnv({ ...cleanEnv, AUTOTUNER_API_URL: gateway.root, AUTOTUNER_API_KEY: TOKEN }, () => module.default(api));

		const registration = providers.at(-1);
		assert.equal(registration.name, "autotuner");
		assert.equal(registration.config.baseUrl, `${gateway.root}/v1`);
		assert.equal(registration.config.apiKey, TOKEN);
		assert.equal(registration.config.authHeader, true);
		assert.equal(registration.config.api, "openai-completions");
		assert.deepEqual(
			registration.config.models.map((model) => [model.id, model.reasoning, model.input, model.contextWindow, model.maxTokens]),
			[
				["qwen3.8-27b", true, ["text"], 32768, 8192],
				["gemma-4-31b", false, ["text", "image"], 131072, 16384],
			],
		);
		assert.equal(registration.config.models[0].compat.supportsReasoningEffort, false);
		assert.equal(registration.config.models[0].compat.maxTokensField, "max_tokens");

		// Offline refresh (Pi startup) returns the known list without network access.
		const callsBefore = gateway.calls.length;
		const offline = await registration.config.refreshModels({ allowNetwork: false, signal: new AbortController().signal, async publish() { return true; } });
		assert.equal(offline.length, 2);
		assert.equal(gateway.calls.length, callsBefore);

		// Online refresh (the /model selector) fetches the current catalogue.
		gateway.state.models.push({ id: "new-model", name: "New", context_window: 8192, max_tokens: 2048, reasoning: false, input: ["text"], path: "n", runnable: true, unavailable_reason: "" });
		const online = await registration.config.refreshModels({ allowNetwork: true, signal: new AbortController().signal, async publish() { return true; } });
		assert.deepEqual(online.map((model) => model.id), ["qwen3.8-27b", "gemma-4-31b", "new-model"]);

		// A failing online refresh throws so the selector shows the reason and keeps the old list.
		await gateway.close();
		await assert.rejects(
			registration.config.refreshModels({ allowNetwork: true, signal: new AbortController().signal, async publish() { return true; } }),
			(error) => error.name === "AutoTunerApiError" && error.code === "unreachable",
		);
	} finally {
		await gateway.close().catch(() => undefined);
	}
});

test("startup without credentials registers an empty provider and never contacts the gateway", async () => {
	const dir = await mkdtemp(join(tmpdir(), "autotuner-ext-empty-"));
	try {
		const { api, providers, handlers } = fakePi();
		const module = await import("../extensions/autotuner.ts");
		await withEnv({ ...cleanEnv, AUTOTUNER_DATA_DIR: dir }, () => module.default(api));
		const registration = providers.at(-1);
		assert.deepEqual(registration.config.models, []);
		assert.equal(registration.config.apiKey, "autotuner-not-configured");
		assert.deepEqual([...handlers.keys()], ["session_start", "model_select", "before_provider_request", "session_shutdown"]);

		// Selecting an AutoTuner model without credentials yields a setup hint instead of a request.
		const { ctx, notifications } = fakeContext();
		await handlers.get("model_select")({ type: "model_select", model: { provider: "autotuner", id: "x" }, previousModel: undefined, source: "set" }, ctx);
		assert.equal(notifications.length, 1);
		assert.match(notifications[0].message, /External control API/);
		// Foreign providers are ignored entirely.
		await handlers.get("model_select")({ type: "model_select", model: { provider: "openai-codex", id: "gpt-5.6-sol" }, previousModel: undefined, source: "set" }, ctx);
		assert.equal(notifications.length, 1);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("model_select pre-switches through the control API and before_provider_request waits for it", async () => {
	const gateway = await startFakeGateway({ switchDelayMs: 40 });
	try {
		const { api, handlers } = fakePi();
		const module = await import("../extensions/autotuner.ts");
		await withEnv({ ...cleanEnv, AUTOTUNER_API_URL: gateway.root, AUTOTUNER_API_KEY: TOKEN }, () => module.default(api));
		const { ctx, notifications, statuses } = fakeContext({ model: { provider: "autotuner", id: "qwen3.8-27b" } });

		// Restored sessions are not pre-warmed.
		await handlers.get("model_select")({ type: "model_select", model: { provider: "autotuner", id: "qwen3.8-27b" }, previousModel: undefined, source: "restore" }, ctx);
		assert.equal(gateway.calls.filter((call) => call.path === "/api/v1/switch").length, 0);

		await handlers.get("model_select")({ type: "model_select", model: { provider: "autotuner", id: "qwen3.8-27b" }, previousModel: undefined, source: "set" }, ctx);
		assert.equal(statuses.at(-1).text.includes("Qwen3.8 27B"), true, "status line names the model while loading");

		// The provider request waits for the in-flight switch and leaves the payload untouched.
		const payload = { model: "qwen3.8-27b", messages: [] };
		const result = await handlers.get("before_provider_request")({ type: "before_provider_request", payload }, ctx);
		assert.equal(result, undefined);
		const switches = gateway.calls.filter((call) => call.path === "/api/v1/switch");
		assert.equal(switches.length, 1);
		assert.deepEqual(switches[0].body, { model_id: "qwen3.8-27b" });
		assert.equal(switches[0].auth, `Bearer ${TOKEN}`);
		assert.equal(gateway.state.active, "qwen3.8-27b");
		assert.ok(notifications.some((entry) => entry.level === "info" && /bereit/.test(entry.message)));
		assert.equal(statuses.at(-1).text, undefined, "status line is cleared after the switch");

		// A second request for the already-active model needs no further gateway call.
		await handlers.get("before_provider_request")({ type: "before_provider_request", payload }, ctx);
		assert.equal(gateway.calls.filter((call) => call.path === "/api/v1/switch").length, 1);

		// Switching to another model on the next request goes through the gateway again (idempotent server side).
		ctx.model = { provider: "autotuner", id: "gemma-4-31b" };
		await handlers.get("before_provider_request")({ type: "before_provider_request", payload: { model: "gemma-4-31b" } }, ctx);
		assert.equal(gateway.state.active, "gemma-4-31b");

		// Requests for other providers are ignored.
		ctx.model = { provider: "openai-codex", id: "gpt-5.6-sol" };
		const before = gateway.calls.length;
		await handlers.get("before_provider_request")({ type: "before_provider_request", payload: { model: "gpt-5.6-sol" } }, ctx);
		assert.equal(gateway.calls.length, before);

		// Gateway errors are reported once and do not throw out of the hook.
		ctx.model = { provider: "autotuner", id: "mmproj-only" };
		await handlers.get("before_provider_request")({ type: "before_provider_request", payload: { model: "mmproj-only" } }, ctx);
		assert.ok(notifications.some((entry) => entry.level === "error" && /model_not_runnable|projector/.test(entry.message)));
	} finally {
		await gateway.close();
	}
});

test("/autotuner command reports status, lists the catalogue, switches with Pi activation, and stops", async () => {
	const gateway = await startFakeGateway({ active: "gemma-4-31b" });
	try {
		const { api, commands, setModelCalls } = fakePi();
		const module = await import("../extensions/autotuner.ts");
		await withEnv({ ...cleanEnv, AUTOTUNER_API_URL: gateway.root, AUTOTUNER_API_KEY: TOKEN }, () => module.default(api));
		const command = commands.get("autotuner");
		assert.ok(command);
		assert.deepEqual(command.getArgumentCompletions("st").map((item) => item.value), ["status", "stop"]);
		assert.deepEqual(command.getArgumentCompletions("switch qw").map((item) => item.value), ["switch qwen3.8-27b"]);

		const { ctx, notifications, registry } = fakeContext();
		const qwen = { provider: "autotuner", id: "qwen3.8-27b", name: "Qwen3.8 27B" };
		registry.set("autotuner/qwen3.8-27b", qwen);

		await command.handler("status", ctx);
		assert.match(notifications.at(-1).message, /bereit: Gemma 4 31B/);
		assert.match(notifications.at(-1).message, /Gateway http:\/\/127\.0\.0\.1:\d+ · Quelle env/);

		await command.handler("models", ctx);
		const listing = notifications.at(-1).message.split("\n");
		assert.equal(listing.length, 3);
		assert.match(listing[0], /^○ Qwen3.8 27B \(ctx 32k, thinking\)$/);
		assert.match(listing[1], /^● Gemma 4 31B \(ctx 128k\)$/);
		assert.match(listing[2], /^✗ Vision projector \(ctx 4k\) — multimodal projector/);

		await command.handler("switch qwen3.8-27b", ctx);
		assert.equal(gateway.state.active, "qwen3.8-27b");
		assert.deepEqual(setModelCalls, [qwen]);

		// The interactive menu routes the selection the same way.
		ctx.ui.select = async (title, options) => {
			assert.match(title, /AutoTuner/);
			return options.find((option) => option.includes("Gemma"));
		};
		registry.set("autotuner/gemma-4-31b", { provider: "autotuner", id: "gemma-4-31b" });
		await command.handler("", ctx);
		assert.equal(gateway.state.active, "gemma-4-31b");
		assert.equal(setModelCalls.length, 2);

		// Not runnable entries are explained instead of switched.
		ctx.ui.select = async (_title, options) => options.find((option) => option.startsWith("✗"));
		await command.handler("", ctx);
		assert.match(notifications.at(-1).message, /kann nicht als Server laufen: multimodal projector/);
		assert.equal(gateway.state.active, "gemma-4-31b");

		await command.handler("stop", ctx);
		assert.equal(gateway.state.active, null);
		assert.match(notifications.at(-1).message, /gestoppt/);

		await command.handler("health", ctx);
		assert.match(notifications.at(-1).message, /ok \(v5\.3\.9\)/);

		await command.handler("bogus", ctx);
		assert.match(notifications.at(-1).message, /Unbekanntes Unterkommando/);
	} finally {
		await gateway.close();
	}
});

test("/autotuner refresh re-reads credentials, re-registers the provider, and explains disabled gateways", async () => {
	const gateway = await startFakeGateway();
	const dir = await mkdtemp(join(tmpdir(), "autotuner-ext-refresh-"));
	try {
		const { api, commands, providers } = fakePi();
		const module = await import("../extensions/autotuner.ts");
		await withEnv({ ...cleanEnv, AUTOTUNER_DATA_DIR: dir }, async () => {
			await module.default(api);
			assert.equal(providers.at(-1).config.apiKey, "autotuner-not-configured");
			const command = commands.get("autotuner");
			const { ctx, notifications } = fakeContext();

			await command.handler("status", ctx);
			assert.match(notifications.at(-1).message, /Kein API-Token/);

			await writeFile(join(dir, "control_api.json"), JSON.stringify({ schema: 1, enabled: true, base_url: gateway.root, port: Number(new URL(gateway.root).port), token: TOKEN }), "utf8");
			await command.handler("refresh", ctx);
			assert.match(notifications.at(-1).message, /2 Modelle registriert/);
			assert.equal(providers.at(-1).config.apiKey, TOKEN);
			assert.equal(providers.at(-1).config.models.length, 2);

			await writeFile(join(dir, "control_api.json"), JSON.stringify({ schema: 1, enabled: false }), "utf8");
			await command.handler("refresh", ctx);
			assert.match(notifications.at(-1).message, /deaktiviert/);
			assert.deepEqual(providers.at(-1).config.models, []);
		});
	} finally {
		await gateway.close();
		await rm(dir, { recursive: true, force: true });
	}
});
