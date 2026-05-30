/**
 * Stargate SG-1 Header Extension  (v0.77.0)
 *
 * Ersetzt den Standard-Start-Header durch ein offenes SGC-Kommandozentralen-
 * Layout. Statt einer fixen 44-Zeichen-Box wird die volle Terminalbreite
 * genutzt (zentriert, gecappt bei MAX_WIDTH), ohne Links/Rechts-Rahmen.
 *
 * Hero-Element ist ein rundes Stargate als Block-/Pixelart-Kunstwerk:
 *  - oben eine breite, abgedimmte Chevron-Krone über die ganze Konsole
 *  - mittig der gerundete Steinring mit blau schimmerndem Event-Horizon und
 *    treibenden Adress-Glyphen, Chevron-Lichtern rund herum und dem rot
 *    leuchtenden Erde-Chevron oben
 *  - der Event-Horizon-Beam tritt auf der Ring-Mittelzeile horizontal aus und
 *    läuft mit glühenden Emitter-Spitzen über die volle Breite
 *  - darunter der A-Frame-Standfuß und ein schwaches Reflexions-Echo
 * Alles breiten-adaptiv (zentriert, gecappt bei MAX_WIDTH), ohne Box-Rahmen.
 *
 * Darunter: STARGATE COMMAND // PI CONSOLE, Clearance, Connection, Tools.
 *
 * Aktualisiert live bei Skills-/Extensions-/Modell-Änderungen.
 * `/header`        – wechselt zwischen Voll- und Quiet-Modus
 * `/refresh-header`– scannt Skills & Extensions neu
 */

import type { Skill } from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, extname } from "node:path";

// ─── KONFIGURATION ─────────────────────────────────────────────────────────

/** Maximale Breite des Banners. Auf sehr breiten Fenstern wird zentriert. */
const MAX_WIDTH = 120;
/** Minimale Breite, ab der das volle Layout sinnvoll ist. */
const MIN_WIDTH = 46;
/** Linker/rechter Sicherheitsabstand zum Terminalrand. */
const SIDE_MARGIN = 2;

const DOT = "•";
const CHECK = "✓";
const WARN = "⚠";

/**
 * "Adress-Glyphen" für den Beam. Bewusst gut unterstützte geometrische
 * Symbole (kein exotisches APL), damit nichts als Tofu (□) rendert.
 * Nach Geschmack erweitern/austauschen.
 */
const GATE_GLYPHS = ["◈", "⊕", "⬡", "⊗", "✦", "⊙", "⬢", "◇", "✧", "⊛", "◬", "⬟"];

// Farbtypen aus dem Theme. Alle hier genutzten Keys existieren laut Theme-Doku
// (General/Status/Borders/Markdown …). `cast` hält uns versionsrobust.
type ThemeColor =
	| "text" | "accent" | "muted" | "dim"
	| "success" | "error" | "warning"
	| "border" | "borderAccent" | "borderMuted"
	| "mdLink" | "mdLinkUrl" | "mdCode" | "mdHeading";

/** Eine gefärbte Zelle für die Pixel-/Block-Komposition. */
type Cell = { c: string; k: ThemeColor };

// ─── ZUSTAND ───────────────────────────────────────────────────────────────

type ModelInfo = { provider: string; id: string };

const state = {
	quiet: false,
	skills: [] as string[],
	extensions: [] as string[],
};

// ─── ALLGEMEINE HELFER ───────────────────────────────────────────────────────

function homeDir(): string {
	return process.env.HOME || process.env.USERPROFILE || "";
}
function agentDir(): string {
	return join(homeDir(), ".pi", "agent");
}
function projectPiDir(): string {
	return join(process.cwd(), ".pi");
}

function readJsonFile(path: string): any | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
}

function readQuietStartup(): boolean {
	for (const path of [
		join(projectPiDir(), "settings.json"),
		join(agentDir(), "settings.json"),
	]) {
		const parsed = readJsonFile(path);
		if (parsed && typeof parsed.quietStartup === "boolean") return parsed.quietStartup;
	}
	return false;
}

/** Einfärben (versionsrobust gegenüber der genauen Theme-Color-Union). */
function fg(theme: Theme, kind: ThemeColor, s: string): string {
	return theme.fg(kind as any, s);
}

/** Plain-Text rechts mit Leerzeichen auffüllen (kein Abschneiden). */
function padRight(text: string, width: number): string {
	const w = visibleWidth(text);
	return w >= width ? text : text + " ".repeat(width - w);
}

/** Plain-Text in `width` zentrieren (mit Leerzeichen, ohne Abschneiden). */
function padCenter(text: string, width: number): string {
	const w = visibleWidth(text);
	if (w >= width) return text;
	const left = Math.floor((width - w) / 2);
	const right = width - w - left;
	return " ".repeat(left) + text + " ".repeat(right);
}

/** Auf exakt `width` sichtbare Zeichen bringen (truncate ODER pad-right). */
function fitPlain(text: any, width: number): string {
	const safe = text ? String(text) : "";
	const truncated = truncateToWidth(safe, width);
	const w = visibleWidth(truncated);
	return w >= width ? truncated : truncated + " ".repeat(width - w);
}

// ─── BANNER-GEOMETRIE ────────────────────────────────────────────────────────

/** Bestimmt die Beam-Breite und den linken Einzug zum Zentrieren. */
function geometry(width: number): { beamWidth: number; pad: number } {
	const usable = Math.max(10, width - SIDE_MARGIN * 2);
	const beamWidth = Math.max(Math.min(MIN_WIDTH, usable), Math.min(usable, MAX_WIDTH));
	const pad = Math.max(0, Math.floor((width - beamWidth) / 2));
	return { beamWidth, pad };
}

/** Eine vom linken Einzug abhängige Zeile zusammensetzen. */
function indented(pad: number, content: string): string {
	return " ".repeat(pad) + content;
}

/** Ein einfarbiges, in `beamWidth` zentriertes Motiv (Ring, Beine, Titel). */
function motif(theme: Theme, pad: number, text: string, beamWidth: number, kind: ThemeColor): string {
	return indented(pad, fg(theme, kind, padCenter(text, beamWidth)));
}

/**
 * Das Herzstück: ein rundes Stargate, mittig in `beamWidth` gesetzt.
 *  - gerundeter Steinring (Block-Dichte erzeugt die Krümmung; Aspektkorrektur 2:1)
 *  - blau schimmernder Event-Horizon im Inneren, mit ein paar treibenden Adress-Glyphen
 *  - kleine Chevron-Lichter rund um den Ring (oben hell, unten gedämpft)
 *  - rot leuchtendes Erde-Chevron oben, leicht aus dem Ring herausragend
 *  - der Event-Horizon-Beam tritt auf der Mittelzeile horizontal aus dem Gate
 *    und läuft mit glühenden Emitter-Spitzen über die volle Breite
 * Liefert fertige, `beamWidth` breite Zeilen.
 */
function buildGate(theme: Theme, beamWidth: number): string[] {
	const Ro = 9; //  Außenradius (Spalteneinheiten)
	const Ri = 6; //  Innenradius (Beginn des Event-Horizon)
	const ASPECT = 2.0; //  Zeichen sind ~2:1 hoch:breit → vertikal stauchen
	const cols = Ro * 2 + 1; // 19
	const rows = 2 * Math.floor(Ro / 2) + 1; // 9
	const cx = (cols - 1) / 2; // 9
	const cy = (rows - 1) / 2; // 4
	const midRow = cy;
	const gatePad = Math.max(0, Math.floor((beamWidth - cols) / 2));

	// 1) Ring + Puddle als lokales Gitter.
	const G: Cell[][] = [];
	for (let ry = 0; ry < rows; ry++) {
		const row: Cell[] = [];
		for (let cxi = 0; cxi < cols; cxi++) {
			const dx = cxi - cx;
			const dy = (ry - cy) * ASPECT;
			const r = Math.hypot(dx, dy);
			if (r >= Ri && r <= Ro) {
				const edge = r > Ro - 0.85 || r < Ri + 0.85;
				row.push({ c: edge ? "▓" : "█", k: edge ? "dim" : "muted" });
			} else if (r < Ri) {
				if ((ry * 3 + cxi) % 11 === 0) {
					row.push({ c: GATE_GLYPHS[(ry + cxi) % GATE_GLYPHS.length], k: "mdCode" });
				} else {
					const s = (cxi + ry) % 2 === 0;
					row.push({ c: s ? "▒" : "░", k: s ? "mdLink" : "mdLinkUrl" });
				}
			} else {
				row.push({ c: " ", k: "dim" });
			}
		}
		G.push(row);
	}

	// 2) Chevron-Lichter rund um den Ring (oben hell → unten gedämpft).
	const rr = (Ro + Ri) / 2;
	const placeChev = (deg: number, glyph: string, kind: ThemeColor) => {
		const a = (deg * Math.PI) / 180;
		const gx = Math.round(cx + Math.cos(a) * rr);
		const gy = Math.round(cy - (Math.sin(a) * rr) / ASPECT);
		if (gy >= 0 && gy < rows && gx >= 0 && gx < cols) G[gy][gx] = { c: glyph, k: kind };
	};
	for (let i = 1; i < 9; i++) {
		const ang = 90 + i * 40; // 9 Chevrons alle 40°, oben = Erde (separat)
		const upper = Math.sin((ang * Math.PI) / 180) > 0;
		placeChev(ang, "◈", upper ? "warning" : "muted");
	}

	// 3) Erde-Chevron oben: roter Kern mit Gold-Flügeln auf dem Ring.
	if (cx - 1 >= 0) G[0][cx - 1] = { c: "◣", k: "accent" };
	G[0][cx] = { c: "◆", k: "error" };
	if (cx + 1 < cols) G[0][cx + 1] = { c: "◢", k: "accent" };

	// 4) Beam-Zelle (volle Breite, nur auf der Mittelzeile) mit Emitter-Spitzen.
	const beamCell = (X: number): Cell => {
		if (X === 0) return { c: "◀", k: "error" };
		if (X === 1) return { c: "◀", k: "warning" };
		if (X === beamWidth - 1) return { c: "▶", k: "error" };
		if (X === beamWidth - 2) return { c: "▶", k: "warning" };
		const edge = X < 3 || X > beamWidth - 4;
		const s = X % 2 === 0;
		return { c: edge ? "░" : s ? "▓" : "▒", k: s ? "mdLink" : "mdLinkUrl" };
	};

	// 5) Komposition: erst die herausragende Erde-Chevron-Spitze, dann der Ring.
	const colorRow = (cells: Cell[]) => cells.map((c) => fg(theme, c.k, c.c)).join("");
	const out: string[] = [];

	const tip: Cell[] = Array.from({ length: beamWidth }, () => ({ c: " ", k: "dim" as ThemeColor }));
	tip[gatePad + cx] = { c: "▼", k: "error" };
	out.push(colorRow(tip));

	for (let ry = 0; ry < rows; ry++) {
		const cells: Cell[] = Array.from(
			{ length: beamWidth },
			() => ({ c: " ", k: "dim" as ThemeColor }),
		);
		if (ry === midRow) for (let X = 0; X < beamWidth; X++) cells[X] = beamCell(X);
		for (let cxi = 0; cxi < cols; cxi++) {
			const g = G[ry][cxi];
			if (g.c === " ") continue; // Lücken im Ring lassen den Beam/Hintergrund durch
			cells[gatePad + cxi] = g;
		}
		out.push(colorRow(cells));
	}

	return out;
}

/**
 * A-Frame-Standfuß unter dem Gate (wie in der Vorlage). Schmal oben, nach unten
 * spreizend; liefert fertige, `beamWidth` breite, zentrierte Zeilen.
 */
function buildStand(theme: Theme, beamWidth: number): string[] {
	const legs = ["╱ ╲", "╱   ╲", "╱     ╲"];
	return legs.map((s, i) =>
		fg(theme, i < 2 ? "muted" : "dim", padCenter(s, beamWidth)),
	);
}

/**
 * Chevron-Krone: eine breite, abgedimmte Reihe verriegelter Gate-Chevrons über
 * die ganze Konsole. Die Mitte bleibt frei – dort thront das eigentliche Gate.
 * Glow-Verlauf: heller (Gold) zur Mitte hin, dunkler am Rand.
 */
function buildCrown(theme: Theme, beamWidth: number): string {
	const cells: Cell[] = Array.from(
		{ length: beamWidth },
		() => ({ c: " ", k: "dim" as ThemeColor }),
	);
	const cx = beamWidth / 2;
	const clear = 12; // Mittenzone für das Gate aussparen

	let n = Math.max(7, Math.floor(beamWidth / 9));
	if (n % 2 === 0) n += 1; // ungerade → echtes Zentrum
	const centerK = (n - 1) / 2;

	for (let k = 0; k < n; k++) {
		if (k === centerK) continue;
		const pos = Math.round(((k + 1) * beamWidth) / (n + 1));
		if (Math.abs(pos - cx) <= clear || pos < 0 || pos >= beamWidth) continue;
		const d = Math.abs(pos - cx) / (beamWidth / 2); // 0 = Mitte, 1 = Rand
		const kind: ThemeColor = d < 0.3 ? "warning" : d < 0.6 ? "muted" : "dim";
		cells[pos] = { c: "▼", k: kind };
	}

	return cells.map((x) => fg(theme, x.k, x.c)).join("");
}

/**
 * Schwaches Reflexions-Echo unter dem Beam: zur Mitte hin dichterer Schimmer im
 * Beam-Blau – wirkt wie der Glow des Wurmlochs auf dem "Boden".
 */
function buildReflection(theme: Theme, beamWidth: number): string {
	const mid = beamWidth / 2;
	let out = "";
	for (let i = 0; i < beamWidth; i++) {
		const d = Math.abs(i - mid) / mid; // 0 = Mitte, 1 = Rand
		const ch = d < 0.3 ? "░" : d < 0.55 && i % 2 === 0 ? "░" : " ";
		out += fg(theme, "mdLinkUrl", ch);
	}
	return out;
}

// ─── INFO-ZEILEN (offen, mit Akzent-Gutter) ──────────────────────────────────

function fieldRow(
	theme: Theme,
	pad: number,
	label: string,
	value: string,
	valueKind: ThemeColor,
	suffix?: string,
): string {
	const gutter = fg(theme, "accent", "▎ ");
	const lbl = fg(theme, "muted", padRight(`${DOT} ${label}`, 14));
	const val = fg(theme, valueKind, value);
	const tail = suffix ? fg(theme, "dim", suffix) : "";
	return indented(pad, gutter + lbl + val + tail);
}

// ─── HEADER-RENDERER ──────────────────────────────────────────────────────────

function renderFullHeader(theme: Theme, model: ModelInfo | undefined, width: number): string[] {
	const { beamWidth, pad } = geometry(width);
	const lines: string[] = [];

	// Gate-Emblem: breite Chevron-Krone → rundes Stargate (mit horizontalem
	// Event-Horizon-Beam) → A-Frame-Standfuß → Reflexions-Echo.
	lines.push("");
	lines.push(indented(pad, buildCrown(theme, beamWidth)));
	for (const row of buildGate(theme, beamWidth)) lines.push(indented(pad, row));
	for (const row of buildStand(theme, beamWidth)) lines.push(indented(pad, row));
	lines.push(indented(pad, buildReflection(theme, beamWidth)));

	// Titel.
	lines.push("");
	lines.push(motif(theme, pad, "STARGATE COMMAND  //  PI CONSOLE", beamWidth, "accent"));
	lines.push(motif(theme, pad, "OFFWORLD LINK ACTIVE", beamWidth, "text"));

	// Offene Haarlinie (keine Box – Enden bleiben offen).
	lines.push(indented(pad, fg(theme, "border", "─".repeat(beamWidth))));
	lines.push("");

	// Info-Block.
	lines.push(fieldRow(theme, pad, "CLEARANCE", "ALPHA", "text", `   //   Pi v${VERSION}`));

	const connected = Boolean(model);
	lines.push(
		fieldRow(
			theme,
			pad,
			"CONNECTION",
			connected ? `${model!.provider}/${model!.id}` : "DISCONNECTED",
			connected ? "success" : "warning",
		),
	);
	lines.push(fieldRow(theme, pad, "TOOLS", "ACTIVE", "accent"));

	return lines;
}

function renderQuietHeader(theme: Theme, model: ModelInfo | undefined, width: number): string[] {
	const { beamWidth, pad } = geometry(width);

	const status = model
		? fg(theme, "success", `${CHECK} `) + fg(theme, "text", `${model.provider}/${model.id}`)
		: fg(theme, "warning", `${WARN} DISCONNECTED`);

	const left =
		fg(theme, "accent", "◯ SGC") +
		fg(theme, "dim", "  ·  ") +
		status +
		fg(theme, "dim", "  ·  ") +
		fg(theme, "dim", "offworld link active");

	const right = fg(theme, "dim", `Pi v${VERSION}`);

	const lw = visibleWidth(left);
	const rw = visibleWidth(right);
	let line: string;
	if (lw + 2 + rw <= beamWidth) {
		line = left + " ".repeat(beamWidth - lw - rw) + right;
	} else {
		line = truncateToWidth(left, beamWidth, "…");
	}

	return ["", indented(pad, line)];
}

// ─── RESSOURCEN-DISCOVERY (unverändert) ──────────────────────────────────────

function collectExtensionsFromSettings(): string[] {
	const found = new Set<string>();

	const settingsCandidates = [
		join(projectPiDir(), "settings.json"),
		join(agentDir(), "settings.json"),
	];

	for (const settingsPath of settingsCandidates) {
		const parsed = readJsonFile(settingsPath);
		if (!parsed) continue;

		if (Array.isArray(parsed.extensions)) {
			for (const entry of parsed.extensions) {
				if (typeof entry !== "string") continue;
				found.add(basename(entry));
			}
		}

		if (Array.isArray(parsed.packages)) {
			for (const pkg of parsed.packages) {
				if (typeof pkg === "string") {
					found.add(pkg);
					continue;
				}
				if (pkg && typeof pkg === "object") {
					if (typeof pkg.source === "string") found.add(pkg.source);
					if (Array.isArray(pkg.extensions)) {
						for (const ext of pkg.extensions) {
							if (typeof ext === "string") found.add(basename(ext));
						}
					}
				}
			}
		}
	}

	const scanRoots = [join(agentDir(), "extensions"), join(projectPiDir(), "extensions")];
	for (const root of scanRoots) {
		if (!existsSync(root)) continue;
		try {
			for (const entry of readdirSync(root, { withFileTypes: true })) {
				if (entry.isFile()) {
					if ([".ts", ".js", ".mjs", ".cjs"].includes(extname(entry.name))) {
						found.add(entry.name);
					}
				} else if (entry.isDirectory()) {
					found.add(entry.name);
				}
			}
		} catch {
			// ignore
		}
	}

	return [...found].sort((a, b) => a.localeCompare(b));
}

function fallbackExtensionsFromTools(pi: ExtensionAPI): string[] {
	try {
		return pi
			.getAllTools()
			.filter((t: any) => {
				const scope = t?.sourceInfo?.scope;
				return scope === "user" || scope === "project";
			})
			.map((t: any) => t?.name)
			.filter((name: unknown): name is string => typeof name === "string")
			.filter((name, index, arr) => arr.indexOf(name) === index)
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

function refreshExtensions(pi: ExtensionAPI) {
	const discovered = collectExtensionsFromSettings();
	state.extensions = discovered.length > 0 ? discovered : fallbackExtensionsFromTools(pi);
}

function extractSkillNames(skills: Skill[] | undefined): string[] {
	if (!skills || !Array.isArray(skills)) return [];
	return skills
		.filter((s) => s && typeof s.name === "string" && s.name.trim().length > 0)
		.map((s) => s.name.trim());
}

// ─── EXTENSION ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	state.quiet = readQuietStartup();

	function applyHeader(ctx: any) {
		if (!ctx?.hasUI) return;

		const build = (th: Theme, w: number): string[] => {
			const model = ctx.model
				? { provider: ctx.model.provider, id: ctx.model.id }
				: undefined;
			const ls = state.quiet
				? renderQuietHeader(th, model, w)
				: renderFullHeader(th, model, w);
			return ls.map((line) => fitPlain(line, w));
		};

		ctx.ui.setHeader((_tui: unknown, theme: Theme) => ({
			render(width: number): string[] {
				return build(theme, width);
			},
			invalidate() {
				// Bei Theme-Wechsel neu aufbauen (Farben dürfen nicht eingebrannt
				// bleiben). Stateless render genügt – wir setzen den Header neu.
				ctx.ui.setHeader((_t: unknown, th: Theme) => ({
					render(w: number): string[] {
						return build(th, w);
					},
					invalidate() {},
				}));
			},
		}));
	}

	pi.on("session_start", async (_event, ctx) => {
		refreshExtensions(pi);
		applyHeader(ctx);
	});

	pi.on("resources_discover", async (_event, ctx) => {
		// The skill list is reported via `before_agent_start`
		// (`systemPromptOptions.skills`). `resources_discover` is the hook for
		// *contributing* skill/prompt/theme paths (its result type carries
		// `skillPaths`), not for reading resolved ones, so here we only refresh
		// extensions and re-apply the header. Re-applying via `applyHeader`
		// (which calls `ctx.ui.setHeader`) is what triggers a re-render.
		refreshExtensions(pi);
		applyHeader(ctx);
	});

	pi.on("before_agent_start", async (event, ctx) => {
		// `systemPromptOptions.skills` is the authoritative loaded-skills list.
		const loadedSkills = extractSkillNames(event.systemPromptOptions?.skills);
		if (loadedSkills.length > 0) state.skills = loadedSkills;

		refreshExtensions(pi);
		applyHeader(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		refreshExtensions(pi);
		applyHeader(ctx);
	});

	pi.registerCommand("header", {
		description: "Toggle stargate header (full / quiet)",
		handler: async (_args, ctx) => {
			state.quiet = !state.quiet;
			applyHeader(ctx);
			ctx.ui.notify(
				state.quiet ? "Stargate header: quiet mode" : "Stargate header: full mode",
				"info",
			);
		},
	});

	pi.registerCommand("refresh-header", {
		description: "Refresh stargate header (re-scan skills and extensions)",
		handler: async (_args, ctx) => {
			refreshExtensions(pi);
			applyHeader(ctx);
			ctx.ui.notify("Stargate header refreshed", "info");
		},
	});
}
