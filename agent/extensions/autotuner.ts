/**
 * AutoTuner model gateway for Pi.
 *
 * Registers the dynamic `autotuner` provider whose catalogue comes from
 * AutoTuner's authenticated loopback control API (docs/control-api.md in the
 * AutoTuner repository). Every scanned, runnable GGUF model therefore appears
 * under provider "AutoTuner" in Pi's native `/model` selector. Selecting one
 * asks AutoTuner to perform its serialized stop/configure/start/health-check
 * transition through `POST /api/v1/switch` while Pi shows a status line, so the
 * first chat request never hangs silently for minutes. Chat traffic itself is
 * sent through AutoTuner's OpenAI proxy, which keeps the requested model active.
 *
 * Credential discovery order (first hit wins):
 *   1. AUTOTUNER_API_URL + AUTOTUNER_API_KEY (or AUTOTUNER_CONTROL_API_KEY)
 *   2. AUTOTUNER_CONTROL_API_PORT (+ key from 1)
 *   3. <AUTOTUNER_DATA_DIR|~/.autotuner>/control_api.json  (AutoTuner ≥ 5.3.9)
 *   4. <AUTOTUNER_DATA_DIR|~/.autotuner>/autotuner_settings.json, scanned with
 *      regular expressions only. The file holds benchmark results and can be
 *      tens of megabytes, so it is never JSON-parsed here.
 *
 * `/autotuner` offers an interactive switcher plus status, models, switch,
 * stop, refresh, health and help subcommands.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { readFile, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

export const PROVIDER_ID = "autotuner";
const PROVIDER_NAME = "AutoTuner";
const DEFAULT_PORT = 1233;
const MIN_TOKEN_LENGTH = 16;
/** Never authenticates; only satisfies Pi's registry while unconfigured. */
const PLACEHOLDER_KEY = "autotuner-not-configured";
const STATUS_KEY = "autotuner";
const SIDECAR_FILE = "control_api.json";
const SETTINGS_FILE = "autotuner_settings.json";
const MAX_SIDECAR_BYTES = 64 * 1024;
const MAX_SETTINGS_BYTES = 512 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_CATALOGUE_ENTRIES = 10_000;
const DISCOVERY_TIMEOUT_MS = 4_000;
const CONTROL_TIMEOUT_MS = 6_000;
/**
 * AutoTuner waits `timeout_s` (default 900 s since 5.3.9) for llama-server's
 * /health. The client sends that value explicitly and stays slightly above it
 * so the gateway, not a socket timeout, reports a slow load.
 */
const SWITCH_TIMEOUT_S = 900;
const SWITCH_TIMEOUT_MS = (SWITCH_TIMEOUT_S + 20) * 1000;
const COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const SUBCOMMANDS: AutocompleteItem[] = [
	{ value: "status", label: "status", description: "Gateway- und Modellstatus anzeigen" },
	{ value: "models", label: "models", description: "Alle erkannten Modelle mit Lauffähigkeit auflisten" },
	{ value: "switch", label: "switch", description: "switch <model-id>: Modell über AutoTuner laden und aktivieren" },
	{ value: "stop", label: "stop", description: "API-verwalteten llama-server stoppen" },
	{ value: "runtimes", label: "runtimes", description: "Verfügbare llama-server-Builds (Runtimes) auflisten" },
	{ value: "refresh", label: "refresh", description: "Zugangsdaten neu lesen und Modellliste aktualisieren" },
	{ value: "health", label: "health", description: "Erreichbarkeit des Gateways ohne Token prüfen" },
	{ value: "help", label: "help", description: "Verwendung anzeigen" },
];

// ---------------------------------------------------------------------------
// Gateway configuration

export type GatewaySource = "env" | "sidecar" | "settings" | "default";

export interface GatewayConfig {
	/** Loopback origin without trailing slash, e.g. http://127.0.0.1:1233 */
	root: string;
	/** Bearer token; empty when unavailable. */
	token: string;
	/** Persisted "External control API" switch when known. */
	enabled: boolean | undefined;
	source: GatewaySource;
}

interface StoredCredentials {
	baseUrl?: string;
	port?: number;
	token?: string;
	enabled?: boolean;
}

export function isConfigured(gateway: GatewayConfig): boolean {
	return gateway.token.length >= MIN_TOKEN_LENGTH && gateway.enabled !== false;
}

export function validPort(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const port = Number(value);
	return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
}

/** Accepts only plain-http loopback origins; strips credentials, query, /v1. */
export function normalizeRoot(value: string): string {
	const parsed = new URL(value);
	if (parsed.protocol !== "http:") {
		throw new Error("AutoTuner gateway URL must use http on the loopback interface");
	}
	const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
		throw new Error("AutoTuner gateway URL must point to a loopback address");
	}
	parsed.username = "";
	parsed.password = "";
	parsed.search = "";
	parsed.hash = "";
	parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
	return parsed.toString().replace(/\/$/, "");
}

function envBool(value: string | undefined): boolean | undefined {
	if (value === undefined) return undefined;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

export function dataDirectory(env: NodeJS.ProcessEnv = process.env): string {
	return env.AUTOTUNER_DATA_DIR?.trim() || join(homedir(), ".autotuner");
}

/** Parses the small `control_api.json` sidecar written by AutoTuner ≥ 5.3.9. */
export function parseSidecar(raw: string): StoredCredentials | undefined {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (record.schema !== undefined && record.schema !== 1) return undefined;
	const result: StoredCredentials = {};
	if (typeof record.enabled === "boolean") result.enabled = record.enabled;
	const port = validPort(record.port);
	if (port !== undefined) result.port = port;
	if (typeof record.base_url === "string" && record.base_url) {
		try {
			result.baseUrl = normalizeRoot(record.base_url);
		} catch {
			// Ignore a malformed origin; the port or default still applies.
		}
	}
	if (typeof record.token === "string" && record.token.length >= MIN_TOKEN_LENGTH) {
		result.token = record.token;
	}
	return result;
}

async function readSidecar(dataDir: string): Promise<StoredCredentials | undefined> {
	const path = join(dataDir, SIDECAR_FILE);
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_SIDECAR_BYTES) return undefined;
		return parseSidecar(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

/**
 * Extracts the three control-API keys from AutoTuner's large settings file
 * without JSON-parsing it. Returns undefined when none of them is present.
 */
export function parseSettingsCredentials(text: string): StoredCredentials | undefined {
	const result: StoredCredentials = {};
	let found = false;
	const enabled = /"control_api_enabled"\s*:\s*(true|false)/.exec(text);
	if (enabled) {
		result.enabled = enabled[1] === "true";
		found = true;
	}
	const port = /"control_api_port"\s*:\s*(\d{4,5})\b/.exec(text);
	if (port) {
		const value = validPort(port[1]);
		if (value !== undefined) result.port = value;
		found = true;
	}
	const token = /"control_api_token"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text);
	if (token) {
		try {
			const decoded: unknown = JSON.parse(token[1]);
			if (typeof decoded === "string" && decoded.length >= MIN_TOKEN_LENGTH) {
				result.token = decoded;
			}
		} catch {
			// A malformed literal is treated as absent.
		}
		found = true;
	}
	return found ? result : undefined;
}

async function readSettingsCredentials(dataDir: string): Promise<StoredCredentials | undefined> {
	const path = join(dataDir, SETTINGS_FILE);
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size > MAX_SETTINGS_BYTES) return undefined;
		return parseSettingsCredentials(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

export async function resolveGateway(env: NodeJS.ProcessEnv = process.env): Promise<GatewayConfig> {
	const dataDir = dataDirectory(env);
	const envUrl = env.AUTOTUNER_API_URL?.trim() || "";
	const envToken = env.AUTOTUNER_API_KEY?.trim() || env.AUTOTUNER_CONTROL_API_KEY?.trim() || "";
	const envPort = validPort(env.AUTOTUNER_CONTROL_API_PORT?.trim());
	const envEnabled = envBool(env.AUTOTUNER_CONTROL_API_ENABLED);

	// The sidecar is authoritative once AutoTuner writes it, including
	// `enabled: false`; the settings scan only serves older AutoTuner versions.
	const sidecar = await readSidecar(dataDir);
	const stored = sidecar ?? (await readSettingsCredentials(dataDir));
	const storedSource: GatewaySource = sidecar ? "sidecar" : stored ? "settings" : "default";

	let root: string;
	if (envUrl) root = normalizeRoot(envUrl);
	else if (envPort !== undefined) root = `http://127.0.0.1:${envPort}`;
	else if (stored?.baseUrl) root = stored.baseUrl;
	else root = `http://127.0.0.1:${stored?.port ?? DEFAULT_PORT}`;

	const token = envToken || stored?.token || "";
	// Explicit environment credentials are an intentional override: a persisted
	// "disabled" flag must not veto them. Only AUTOTUNER_CONTROL_API_ENABLED can.
	const enabled = envEnabled ?? (envToken ? true : stored?.enabled);
	const source: GatewaySource = envToken || envUrl ? "env" : storedSource;
	return { root, token, enabled, source };
}

// ---------------------------------------------------------------------------
// HTTP client

export class AutoTunerApiError extends Error {
	readonly code: string;
	readonly status: number;

	constructor(message: string, code: string, status = 0) {
		super(message);
		this.name = "AutoTunerApiError";
		this.code = code;
		this.status = status;
	}
}

interface RequestOptions {
	body?: unknown;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** `/health` is the only unauthenticated route. */
	auth?: boolean;
}

function errorFromBody(status: number, body: unknown): AutoTunerApiError {
	const error =
		body && typeof body === "object" && "error" in body
			? (body as { error?: { message?: unknown; code?: unknown } }).error
			: undefined;
	const message =
		error && typeof error.message === "string" && error.message
			? error.message
			: `AutoTuner gateway answered HTTP ${status}`;
	const code = error && typeof error.code === "string" && error.code ? error.code : `http_${status}`;
	return new AutoTunerApiError(message, code, status);
}

export function gatewayRequest<T = unknown>(
	gateway: Pick<GatewayConfig, "root" | "token">,
	method: "GET" | "POST",
	path: string,
	options: RequestOptions = {},
): Promise<T> {
	const { body, signal, timeoutMs = CONTROL_TIMEOUT_MS, auth = true } = options;
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		const finish = (error?: Error, value?: T) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			if (error) reject(error);
			else resolve(value as T);
		};
		const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), "utf8");
		const headers: Record<string, string> = {
			Accept: "application/json",
			Connection: "close",
		};
		if (auth) headers.Authorization = `Bearer ${gateway.token}`;
		if (payload) {
			headers["Content-Type"] = "application/json; charset=utf-8";
			headers["Content-Length"] = String(payload.length);
		}
		const request = httpRequest(`${gateway.root}${path}`, { method, headers }, (response) => {
			const chunks: Buffer[] = [];
			let size = 0;
			response.on("data", (chunk: Buffer) => {
				size += chunk.length;
				if (size > MAX_RESPONSE_BYTES) {
					request.destroy(new AutoTunerApiError("AutoTuner response is too large", "response_too_large"));
					return;
				}
				chunks.push(chunk);
			});
			response.on("end", () => {
				const status = response.statusCode ?? 0;
				const text = Buffer.concat(chunks).toString("utf8");
				let parsed: unknown = {};
				if (text.trim()) {
					try {
						parsed = JSON.parse(text);
					} catch {
						finish(new AutoTunerApiError("AutoTuner returned invalid JSON", "invalid_json", status));
						return;
					}
				}
				if (status < 200 || status >= 300) {
					finish(errorFromBody(status, parsed));
					return;
				}
				finish(undefined, parsed as T);
			});
			response.on("aborted", () =>
				finish(new AutoTunerApiError("AutoTuner response was interrupted", "interrupted")),
			);
			response.on("error", (error) => finish(toApiError(error)));
		});
		const onAbort = () => request.destroy(new AutoTunerApiError("AutoTuner request aborted", "aborted"));
		signal?.addEventListener("abort", onAbort, { once: true });
		request.setTimeout(timeoutMs, () =>
			request.destroy(
				new AutoTunerApiError(`AutoTuner did not answer within ${Math.round(timeoutMs / 1000)} s`, "timeout"),
			),
		);
		request.on("error", (error) => finish(toApiError(error)));
		if (signal?.aborted) onAbort();
		else request.end(payload);
	});
}

function toApiError(error: unknown): AutoTunerApiError {
	if (error instanceof AutoTunerApiError) return error;
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	if (code === "ECONNREFUSED" || code === "ECONNRESET" || code === "ENOTFOUND") {
		return new AutoTunerApiError("AutoTuner gateway is not reachable", "unreachable");
	}
	return new AutoTunerApiError(error instanceof Error ? error.message : String(error), "network");
}

// ---------------------------------------------------------------------------
// Gateway payloads

export interface GatewayStatus {
	status: "idle" | "loading" | "ready" | string;
	active_model: string | null;
	loading_model: string | null;
	active_since: number | null;
	inflight_requests: number;
	endpoint: string;
	/** Additive fields since AutoTuner 5.3.9. */
	ready?: boolean;
	backend_url?: string | null;
	alias?: string | null;
	active_runtime?: string | null;
	default_runtime_id?: string | null;
	runtime?: { id?: string; label?: string; backend?: string; build?: string } | null;
}

export interface GatewayRuntime {
	id: string;
	label?: string;
	backend?: string;
	build?: string;
}

interface RuntimesResponse {
	runtimes?: unknown;
	default_runtime_id?: string | null;
	active_runtime?: string | null;
}

export interface CatalogueModel {
	id: string;
	name: string;
	context_window: number;
	max_tokens: number;
	reasoning: boolean;
	input: string[];
	path: string;
	runnable: boolean;
	unavailable_reason: string;
	size_bytes?: number;
	quant?: string;
	family?: string;
}

interface CatalogueResponse extends Partial<GatewayStatus> {
	models?: unknown;
}

interface ModelListResponse {
	data?: unknown;
}

export function mapModel(raw: unknown): ProviderModelConfig | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const model = raw as Partial<CatalogueModel>;
	if (typeof model.id !== "string" || !model.id) return undefined;
	const contextWindow =
		typeof model.context_window === "number" && Number.isFinite(model.context_window)
			? Math.max(1024, Math.floor(model.context_window))
			: 8192;
	const maxTokens =
		typeof model.max_tokens === "number" && Number.isFinite(model.max_tokens)
			? Math.max(256, Math.min(contextWindow, Math.floor(model.max_tokens)))
			: Math.max(256, Math.min(16384, Math.floor(contextWindow / 2)));
	const advertised = Array.isArray(model.input)
		? model.input.filter((value): value is "text" | "image" => value === "text" || value === "image")
		: [];
	return {
		id: model.id,
		name: typeof model.name === "string" && model.name ? model.name : model.id,
		// Mirror AutoTuner's scanner verdict so Pi renders reasoning_content as
		// thinking blocks. AutoTuner's saved reasoning launch setting stays
		// authoritative: no reasoning_effort or budget fields are sent.
		reasoning: model.reasoning === true,
		input: advertised.length > 0 ? advertised : ["text"],
		cost: COST,
		contextWindow,
		maxTokens,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			supportsStrictMode: false,
			maxTokensField: "max_tokens",
		},
	};
}

export async function fetchModels(gateway: GatewayConfig, signal?: AbortSignal): Promise<ProviderModelConfig[]> {
	const payload = await gatewayRequest<ModelListResponse>(gateway, "GET", "/v1/models", {
		signal,
		timeoutMs: DISCOVERY_TIMEOUT_MS,
	});
	if (!Array.isArray(payload.data) || payload.data.length > MAX_CATALOGUE_ENTRIES) {
		throw new AutoTunerApiError("AutoTuner returned an invalid model catalogue", "invalid_catalogue");
	}
	return payload.data.map(mapModel).filter((model): model is ProviderModelConfig => model !== undefined);
}

export async function fetchCatalogue(
	gateway: GatewayConfig,
	signal?: AbortSignal,
): Promise<{ models: CatalogueModel[]; status: GatewayStatus | undefined }> {
	const payload = await gatewayRequest<CatalogueResponse>(gateway, "GET", "/api/v1/models", {
		signal,
		timeoutMs: DISCOVERY_TIMEOUT_MS,
	});
	if (!Array.isArray(payload.models) || payload.models.length > MAX_CATALOGUE_ENTRIES) {
		throw new AutoTunerApiError("AutoTuner returned an invalid model catalogue", "invalid_catalogue");
	}
	const models = payload.models.filter(
		(entry): entry is CatalogueModel =>
			!!entry && typeof entry === "object" && typeof (entry as CatalogueModel).id === "string",
	);
	const status = typeof payload.status === "string" ? (payload as GatewayStatus) : undefined;
	return { models, status };
}

// ---------------------------------------------------------------------------
// Presentation helpers

export function describeError(error: unknown, gateway?: GatewayConfig): string {
	if (error instanceof AutoTunerApiError) {
		switch (error.code) {
			case "unreachable":
				return `AutoTuner-Gateway ${gateway?.root ?? ""} ist nicht erreichbar. Läuft AutoTuner und ist die External control API aktiviert?`.replace(
					"  ",
					" ",
				);
			case "unauthorised":
				return "AutoTuner lehnt den Token ab. Token in AutoTuner regeneriert? Dann /autotuner refresh.";
			case "model_busy":
				return "Das aktive Modell bearbeitet noch Requests; der Wechsel wird nach deren Ende wiederholt.";
			case "autotuner_busy":
				return "AutoTuner ist durch einen exklusiven Benchmark- oder OCR-Lauf belegt; den Wechsel später erneut versuchen.";
			case "switch_timeout":
				return `AutoTuner hat den Modellstart nicht innerhalb von ${SWITCH_TIMEOUT_S} s abgeschlossen (Timeout).`;
			default:
				return `${error.message} [${error.code}]`;
		}
	}
	return error instanceof Error ? error.message : String(error);
}

export function setupHint(gateway: GatewayConfig): string {
	if (gateway.enabled === false) {
		return "AutoTuner: Die External control API ist deaktiviert. In AutoTuner ⋯ → Settings → External control API einschalten, dann /autotuner refresh.";
	}
	return "AutoTuner: Kein API-Token gefunden. In AutoTuner ⋯ → Settings → External control API aktivieren (oder AUTOTUNER_API_URL/AUTOTUNER_API_KEY setzen), dann /autotuner refresh.";
}

function formatDuration(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "?";
	if (seconds < 90) return `${Math.round(seconds)} s`;
	if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
	return `${(seconds / 3600).toFixed(1)} h`;
}

function formatContext(tokens: number | undefined): string {
	if (!tokens || !Number.isFinite(tokens)) return "";
	return tokens >= 1024 ? `${Math.round(tokens / 1024)}k` : String(tokens);
}

export function formatStatus(status: GatewayStatus, gateway: GatewayConfig, names: Map<string, string>): string {
	const lines: string[] = [];
	const label = (id: string | null) => (id ? names.get(id) ?? id : "–");
	if (status.status === "loading") {
		lines.push(`⏳ AutoTuner lädt ${label(status.loading_model)}`);
	} else if (status.status === "ready") {
		const since =
			typeof status.active_since === "number" && status.active_since > 0
				? ` (seit ${formatDuration(Date.now() / 1000 - status.active_since)})`
				: "";
		lines.push(`● AutoTuner bereit: ${label(status.active_model)}${since}`);
	} else {
		lines.push("○ AutoTuner: kein Modell aktiv");
	}
	lines.push(`Gateway ${gateway.root} · Quelle ${gateway.source}`);
	if (status.backend_url) lines.push(`llama-server ${status.backend_url}${status.alias ? ` · Alias ${status.alias}` : ""}`);
	const runtimeLabel = status.runtime?.label ?? status.active_runtime;
	if (runtimeLabel) lines.push(`Build ${runtimeLabel}${status.runtime?.backend ? ` (${status.runtime.backend})` : ""}`);
	if (typeof status.inflight_requests === "number" && status.inflight_requests > 0) {
		lines.push(`${status.inflight_requests} laufende Requests`);
	}
	return lines.join("\n");
}

export function formatRuntimes(payload: RuntimesResponse): string[] {
	const runtimes = Array.isArray(payload.runtimes)
		? payload.runtimes.filter((entry): entry is GatewayRuntime => !!entry && typeof entry === "object" && typeof (entry as GatewayRuntime).id === "string")
		: [];
	return runtimes.map((runtime) => {
		const marker = runtime.id === payload.active_runtime ? "●" : runtime.id === payload.default_runtime_id ? "◆" : "○";
		const extras = [runtime.backend ?? "", runtime.build ?? ""].filter(Boolean).join(", ");
		return `${marker} ${runtime.label ?? runtime.id}${extras ? ` (${extras})` : ""} — ${runtime.id}`;
	});
}

export function formatCatalogue(models: CatalogueModel[], activeId: string | null | undefined): string[] {
	return models.map((model) => {
		const marker = model.id === activeId ? "●" : model.runnable ? "○" : "✗";
		const context = formatContext(model.context_window);
		const extras = [context ? `ctx ${context}` : "", model.quant ?? "", model.reasoning ? "thinking" : ""]
			.filter(Boolean)
			.join(", ");
		const reason = !model.runnable && model.unavailable_reason ? ` — ${model.unavailable_reason}` : "";
		return `${marker} ${model.name}${extras ? ` (${extras})` : ""}${reason}`;
	});
}

// ---------------------------------------------------------------------------
// Extension state and behaviour

interface SwitchJob {
	modelId: string;
	promise: Promise<GatewayStatus>;
	controller: AbortController;
}

interface GatewayState {
	gateway: GatewayConfig;
	models: ProviderModelConfig[];
	/** Last model AutoTuner confirmed as active through this extension. */
	knownActive: string | undefined;
	switching: SwitchJob | undefined;
	lastError: string | undefined;
	shuttingDown: boolean;
}

function modelName(state: GatewayState, modelId: string): string {
	return state.models.find((model) => model.id === modelId)?.name ?? modelId;
}

function registerGateway(pi: ExtensionAPI, state: GatewayState): void {
	const configured = isConfigured(state.gateway);
	pi.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl: `${state.gateway.root}/v1`,
		apiKey: configured ? state.gateway.token : PLACEHOLDER_KEY,
		authHeader: true,
		api: "openai-completions",
		models: state.models,
		async refreshModels(context) {
			// Pi calls this on startup and after every provider registration with
			// allowNetwork=false; the /model selector calls it with network access.
			if (!context.allowNetwork || context.signal.aborted || !isConfigured(state.gateway)) {
				return state.models;
			}
			// Throwing keeps the previously registered list and surfaces the reason
			// in the selector instead of silently emptying the provider.
			const models = await fetchModels(state.gateway, context.signal);
			state.models = models;
			state.lastError = undefined;
			return models;
		},
	});
}

/**
 * Re-reads credentials, refreshes the catalogue when possible, and
 * re-registers the provider. Never throws; the outcome is returned.
 */
async function connect(
	pi: ExtensionAPI,
	state: GatewayState,
	signal?: AbortSignal,
): Promise<{ configured: boolean; reachable: boolean; count: number; error?: string }> {
	try {
		state.gateway = await resolveGateway();
	} catch (error) {
		state.lastError = describeError(error);
		registerGateway(pi, state);
		return { configured: false, reachable: false, count: 0, error: state.lastError };
	}
	if (!isConfigured(state.gateway)) {
		state.models = [];
		state.knownActive = undefined;
		state.lastError = undefined;
		registerGateway(pi, state);
		return { configured: false, reachable: false, count: 0 };
	}
	try {
		state.models = await fetchModels(state.gateway, signal);
		state.lastError = undefined;
		registerGateway(pi, state);
		return { configured: true, reachable: true, count: state.models.length };
	} catch (error) {
		state.lastError = describeError(error, state.gateway);
		registerGateway(pi, state);
		return { configured: true, reachable: false, count: state.models.length, error: state.lastError };
	}
}

/**
 * Asks AutoTuner to activate a model. Idempotent on the server: an already
 * active model answers immediately, a model that is loading joins the wait.
 */
function switchModel(state: GatewayState, ctx: ExtensionContext, modelId: string): Promise<GatewayStatus> {
	if (state.switching?.modelId === modelId) return state.switching.promise;
	if (state.switching) state.switching.controller.abort();
	const controller = new AbortController();
	const label = modelName(state, modelId);
	const startedAt = Date.now();
	setStatusSafe(ctx, `⏳ AutoTuner lädt ${label} …`);
	const promise = gatewayRequest<GatewayStatus>(state.gateway, "POST", "/api/v1/switch", {
		body: { model_id: modelId, timeout_s: SWITCH_TIMEOUT_S },
		signal: controller.signal,
		timeoutMs: SWITCH_TIMEOUT_MS,
	})
		.then((status) => {
			state.knownActive = status.active_model ?? modelId;
			state.lastError = undefined;
			const seconds = Math.round((Date.now() - startedAt) / 1000);
			notifySafe(ctx, seconds >= 2 ? `✅ AutoTuner: ${label} bereit (${seconds} s)` : `✅ AutoTuner: ${label} bereit`, "info");
			return status;
		})
		.catch((error: unknown) => {
			if (!(error instanceof AutoTunerApiError && error.code === "aborted")) {
				state.lastError = describeError(error, state.gateway);
				notifySafe(ctx, `❌ ${state.lastError}`, "error");
			}
			throw error;
		})
		.finally(() => {
			if (state.switching?.promise === promise) state.switching = undefined;
			setStatusSafe(ctx, undefined);
		});
	state.switching = { modelId, promise, controller };
	return promise;
}

function notifySafe(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error"): void {
	try {
		ctx.ui.notify(message, level);
	} catch {
		// The context may be gone after a session switch; nothing to report.
	}
}

function setStatusSafe(ctx: ExtensionContext, text: string | undefined): void {
	try {
		ctx.ui.setStatus(STATUS_KEY, text);
	} catch {
		// See notifySafe.
	}
}

async function activateInPi(pi: ExtensionAPI, ctx: ExtensionCommandContext, modelId: string): Promise<boolean> {
	let model = ctx.modelRegistry.find(PROVIDER_ID, modelId);
	if (!model) {
		try {
			await ctx.modelRegistry.refresh({ providers: [PROVIDER_ID], allowNetwork: true });
		} catch {
			// Fall through to the second lookup; the caller reports failure.
		}
		model = ctx.modelRegistry.find(PROVIDER_ID, modelId);
	}
	if (!model) return false;
	return pi.setModel(model);
}

const USAGE = [
	"Verwendung: /autotuner [status|models|switch <model-id>|stop|runtimes|refresh|health|help]",
	"Ohne Argument öffnet sich die Modellauswahl; /model listet dieselben Modelle unter dem Provider AutoTuner.",
].join("\n");

export default async function (pi: ExtensionAPI) {
	const state: GatewayState = {
		gateway: { root: `http://127.0.0.1:${DEFAULT_PORT}`, token: "", enabled: undefined, source: "default" },
		models: [],
		knownActive: undefined,
		switching: undefined,
		lastError: undefined,
		shuttingDown: false,
	};

	// Startup registration must not block Pi when AutoTuner is closed: connection
	// refusal returns instantly and discovery is capped at DISCOVERY_TIMEOUT_MS.
	await connect(pi, state);

	pi.on("session_start", async (_event, ctx) => {
		if (state.shuttingDown) return;
		if (isConfigured(state.gateway) && state.models.length === 0) {
			// AutoTuner may have been started or its API enabled after Pi loaded.
			await connect(pi, state);
		}
		if (ctx.model?.provider !== PROVIDER_ID || !ctx.hasUI) return;
		if (!isConfigured(state.gateway)) {
			notifySafe(ctx, setupHint(state.gateway), "warning");
		} else if (state.lastError) {
			notifySafe(ctx, `⚠️ ${state.lastError}`, "warning");
		}
	});

	pi.on("model_select", async (event, ctx) => {
		if (event.model.provider !== PROVIDER_ID) return;
		if (!isConfigured(state.gateway)) {
			notifySafe(ctx, setupHint(state.gateway), "warning");
			return;
		}
		// Restored sessions are not pre-warmed: a multi-gigabyte load should not
		// start merely because a session was reopened. The first request handles it.
		if (event.source === "restore") return;
		switchModel(state, ctx, event.model.id).catch(() => undefined);
	});

	pi.on("before_provider_request", async (event, ctx) => {
		const payload = event.payload as { model?: unknown } | undefined;
		if (ctx.model?.provider !== PROVIDER_ID || !isConfigured(state.gateway)) return undefined;
		const modelId = typeof payload?.model === "string" ? payload.model : ctx.model.id;
		if (state.switching?.modelId === modelId) {
			await state.switching.promise.catch(() => undefined);
		} else if (state.knownActive !== modelId) {
			// The proxy would switch on its own, but this keeps the status line
			// visible during a long load and reports failures before the request.
			await switchModel(state, ctx, modelId).catch(() => undefined);
		}
		return undefined;
	});

	pi.on("session_shutdown", async () => {
		state.shuttingDown = true;
		state.switching?.controller.abort();
	});

	pi.registerCommand("autotuner", {
		description: "AutoTuner: Modelle über die Control-API anzeigen, laden und wechseln",
		getArgumentCompletions(prefix) {
			const trimmed = prefix.trimStart();
			if (/^switch\s+/i.test(trimmed)) {
				const partial = trimmed.replace(/^switch\s+/i, "").toLowerCase();
				const items = state.models
					.filter((model) => model.id.toLowerCase().startsWith(partial) || model.name.toLowerCase().startsWith(partial))
					.map((model) => ({ value: `switch ${model.id}`, label: model.id, description: model.name }));
				return items.length > 0 ? items : null;
			}
			const items = SUBCOMMANDS.filter((item) => item.value.startsWith(trimmed.toLowerCase()));
			return items.length > 0 ? items : null;
		},
		handler: async (args, ctx) => {
			const [subcommand = "", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			const argument = rest.join(" ");
			const names = new Map(state.models.map((model) => [model.id, model.name]));

			switch (subcommand.toLowerCase()) {
				case "help":
				case "?":
					ctx.ui.notify(USAGE, "info");
					return;

				case "health": {
					try {
						const health = await gatewayRequest<{ status?: string; version?: string }>(state.gateway, "GET", "/health", {
							auth: false,
						});
						ctx.ui.notify(
							`AutoTuner-Gateway ${state.gateway.root}: ${health.status ?? "?"}${health.version ? ` (v${health.version})` : ""}`,
							"info",
						);
					} catch (error) {
						ctx.ui.notify(describeError(error, state.gateway), "error");
					}
					return;
				}

				case "refresh":
				case "connect": {
					const result = await connect(pi, state);
					if (!result.configured) ctx.ui.notify(setupHint(state.gateway), "warning");
					else if (!result.reachable) ctx.ui.notify(`⚠️ ${result.error}`, "warning");
					else ctx.ui.notify(`AutoTuner: ${result.count} Modelle registriert (Gateway ${state.gateway.root}).`, "info");
					return;
				}
			}

			if (!isConfigured(state.gateway)) {
				ctx.ui.notify(setupHint(state.gateway), "warning");
				return;
			}

			switch (subcommand.toLowerCase()) {
				case "status": {
					try {
						const status = await gatewayRequest<GatewayStatus>(state.gateway, "GET", "/api/v1/status");
						if (status.status === "ready" && status.active_model) state.knownActive = status.active_model;
						ctx.ui.notify(formatStatus(status, state.gateway, names), "info");
					} catch (error) {
						ctx.ui.notify(describeError(error, state.gateway), "error");
					}
					return;
				}

				case "models":
				case "list": {
					try {
						const { models, status } = await fetchCatalogue(state.gateway);
						if (models.length === 0) {
							ctx.ui.notify("AutoTuner meldet keine Modelle. Läuft der Modell-Scan noch?", "warning");
							return;
						}
						ctx.ui.notify(formatCatalogue(models, status?.active_model).join("\n"), "info");
					} catch (error) {
						ctx.ui.notify(describeError(error, state.gateway), "error");
					}
					return;
				}

				case "runtimes": {
					try {
						const payload = await gatewayRequest<RuntimesResponse>(state.gateway, "GET", "/api/v1/runtimes");
						const lines = formatRuntimes(payload);
						ctx.ui.notify(lines.length > 0 ? `${lines.join("\n")}\n● aktiv · ◆ Toolbar-Standard` : "AutoTuner meldet keine llama-server-Builds.", lines.length > 0 ? "info" : "warning");
					} catch (error) {
						ctx.ui.notify(describeError(error, state.gateway), "error");
					}
					return;
				}

				case "stop": {
					try {
						await gatewayRequest<GatewayStatus>(state.gateway, "POST", "/api/v1/stop", { timeoutMs: SWITCH_TIMEOUT_MS });
						state.knownActive = undefined;
						ctx.ui.notify("AutoTuner: API-verwalteter llama-server gestoppt.", "info");
					} catch (error) {
						ctx.ui.notify(describeError(error, state.gateway), "error");
					}
					return;
				}

				case "switch":
				case "load":
				case "use": {
					if (!argument) {
						ctx.ui.notify("Verwendung: /autotuner switch <model-id>", "warning");
						return;
					}
					const target =
						state.models.find((model) => model.id === argument) ??
						state.models.find((model) => model.id.toLowerCase() === argument.toLowerCase() || model.name.toLowerCase() === argument.toLowerCase());
					await switchAndActivate(target?.id ?? argument);
					return;
				}

				case "":
					break;

				default:
					ctx.ui.notify(`Unbekanntes Unterkommando "${subcommand}".\n${USAGE}`, "warning");
					return;
			}

			// Interactive switcher
			if (!ctx.hasUI) {
				ctx.ui.notify(USAGE, "info");
				return;
			}
			let catalogue: CatalogueModel[];
			let activeId: string | null | undefined;
			try {
				const result = await fetchCatalogue(state.gateway);
				catalogue = result.models;
				activeId = result.status?.active_model ?? state.knownActive;
			} catch (error) {
				ctx.ui.notify(describeError(error, state.gateway), "error");
				return;
			}
			if (catalogue.length === 0) {
				ctx.ui.notify("AutoTuner meldet keine Modelle. Läuft der Modell-Scan noch?", "warning");
				return;
			}
			const choices = formatCatalogue(catalogue, activeId);
			const choice = await ctx.ui.select("AutoTuner-Modell wählen", choices);
			if (!choice) return;
			const selected = catalogue[choices.indexOf(choice)];
			if (!selected) return;
			if (!selected.runnable) {
				ctx.ui.notify(
					`${selected.name} kann nicht als Server laufen${selected.unavailable_reason ? `: ${selected.unavailable_reason}` : "."}`,
					"warning",
				);
				return;
			}
			await switchAndActivate(selected.id);

			async function switchAndActivate(modelId: string): Promise<void> {
				try {
					await switchModel(state, ctx, modelId);
				} catch {
					return; // already reported by switchModel
				}
				if (!state.models.some((model) => model.id === modelId)) {
					await connect(pi, state);
				}
				const activated = await activateInPi(pi, ctx, modelId);
				if (!activated) {
					ctx.ui.notify(
						`AutoTuner hat ${modelName(state, modelId)} geladen, aber Pi kennt das Modell nicht. /autotuner refresh und dann /model ausführen.`,
						"warning",
					);
				}
			}
		},
	});
}
