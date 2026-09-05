import assert from "node:assert/strict";
import test from "node:test";
import { patchLlamaServerUrlSource } from "../extensions/pi-autoupdate.ts";
import { unloadOnExit } from "../extensions/autotuner.ts";

test("the pi-llama-cpp fallback URL patch accepts the 0.10 constant name and keeps whichever name it finds", () => {
	const legacy = 'export const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080";\nexport const FALLBACK_CTX = 128000;\n';
	const current = 'export const API_KEY_PLACEHOLDER = "sk-placeholder";\n\nexport const LLAMA_SERVER_URL = "http://127.0.0.1:8080";\n';
	assert.deepEqual(patchLlamaServerUrlSource(legacy, "http://127.0.0.1:1234"), {
		found: true,
		next: 'export const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:1234";\nexport const FALLBACK_CTX = 128000;\n',
	});
	assert.deepEqual(patchLlamaServerUrlSource(current, "http://127.0.0.1:1234"), {
		found: true,
		next: 'export const API_KEY_PLACEHOLDER = "sk-placeholder";\n\nexport const LLAMA_SERVER_URL = "http://127.0.0.1:1234";\n',
	});
	// Already patched sources are left byte-identical; unknown layouts are reported, not rewritten.
	const patched = patchLlamaServerUrlSource(current, "http://127.0.0.1:1234").next;
	assert.deepEqual(patchLlamaServerUrlSource(patched, "http://127.0.0.1:1234"), { found: true, next: patched });
	assert.deepEqual(patchLlamaServerUrlSource("export const SOMETHING_ELSE = 1;", "http://127.0.0.1:1234"), { found: false, next: "export const SOMETHING_ELSE = 1;" });
});

test("unloading on exit is the default and only an explicit falsy AUTOTUNER_UNLOAD_ON_EXIT disables it", () => {
	assert.equal(unloadOnExit({}), true);
	assert.equal(unloadOnExit({ AUTOTUNER_UNLOAD_ON_EXIT: "1" }), true);
	assert.equal(unloadOnExit({ AUTOTUNER_UNLOAD_ON_EXIT: "maybe" }), true);
	for (const value of ["0", "false", "no", "off", " OFF "]) {
		assert.equal(unloadOnExit({ AUTOTUNER_UNLOAD_ON_EXIT: value }), false, value);
	}
});
