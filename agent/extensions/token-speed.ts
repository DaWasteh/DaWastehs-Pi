/**
 * token-speed.ts — Footer-Erweiterung für den Pi Coding Agent (v0.76.0)
 *
 * Footer-Layout (von links nach rechts):
 *   ctx 4.0k/1.0M (0%)  ▓▓▓░░░░░░░░  ↑ 42 tok/s  [medium]  think 1.2k  out 133            gemini-flash-lite-latest (master)
 *   └── Kontext ──────┘  └─ Balken ┘  └ Speed ──┘  └ Level ┘ └ Think ──┘ └ Out┘            └── Modell (rechtsbündig) ──┘
 *
 * Wichtige Korrekturen ggü. der defekten Version:
 *  1. Thinking-Level-Badge wird beim Start aus pi.getThinkingLevel() initialisiert
 *     (das Event `thinking_level_select` feuert NICHT beim Start) und bei
 *     `model_select` neu gelesen.
 *  2. Es gibt KEIN usage.reasoning / usage.thinking in v0.76.0. Die Think-Tokens
 *     werden daher aus den `thinking_delta`-Streaming-Events geschätzt.
 *  3. Speed wird selbst gemessen (message_start → message_end) und nach dem Ende
 *     persistiert, damit „↑ N tok/s" auch nach der Generierung sichtbar bleibt.
 *  4. Keine ungültige Theme-Farbe „info" mehr — es werden die echten
 *     thinking*-Farben bzw. accent/dim verwendet.
 */

import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

type ThinkingLevelOff = ThinkingLevel | "off";

// ---------------------------------------------------------------------------
// Geteilter, veränderlicher Zustand (vom Footer-Render gelesen, von Events
// aktualisiert). Der Host rendert den Footer nach jedem Agent-Event neu, daher
// genügt es, hier den jeweils aktuellsten Stand zu halten.
// ---------------------------------------------------------------------------
interface SpeedState {
  /** Letzter aktiver ExtensionContext (für model / getContextUsage). */
  ctx: ExtensionContext | undefined;
  /** Aktuelles Thinking-Level inkl. "off". */
  thinkingLevel: ThinkingLevelOff;
  /** Zeitstempel (ms) des Generierungsstarts der laufenden Assistant-Nachricht. */
  streamStart: number | null;
  /** Während des Streamings akkumulierte Zeichen (Text + Thinking) für die Live-Schätzung. */
  streamedTextChars: number;
  streamedThinkChars: number;
  /** Persistierte Werte der letzten abgeschlossenen Generierung. */
  lastSpeedTokPerSec: number | null;
  lastOutputTokens: number | null;
  lastThinkTokens: number | null;
}

const state: SpeedState = {
  ctx: undefined,
  thinkingLevel: "off",
  streamStart: null,
  streamedTextChars: 0,
  streamedThinkChars: 0,
  lastSpeedTokPerSec: null,
  lastOutputTokens: null,
  lastThinkTokens: null,
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Kompakte Token-Darstellung (123, 4.0k, 12k, 1.2M …) — wie im eingebauten Footer. */
function formatTokens(count: number): string {
  if (count < 1000) return count.toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** Grobe Token-Schätzung aus Zeichenanzahl (~4 Zeichen pro Token). */
function estimateTokens(chars: number): number {
  return chars <= 0 ? 0 : Math.max(1, Math.round(chars / 4));
}

/** Theme-Farbe passend zum Thinking-Level (gültige ThemeColor-Werte in v0.76.0). */
function thinkingColor(level: ThinkingLevelOff):
  | "thinkingOff" | "thinkingMinimal" | "thinkingLow"
  | "thinkingMedium" | "thinkingHigh" | "thinkingXhigh" {
  switch (level) {
    case "minimal": return "thinkingMinimal";
    case "low": return "thinkingLow";
    case "medium": return "thinkingMedium";
    case "high": return "thinkingHigh";
    case "xhigh": return "thinkingXhigh";
    default: return "thinkingOff";
  }
}

/** Einfacher Fortschrittsbalken für den Kontextverbrauch. */
function contextBar(percent: number, cells = 10): string {
  const filled = Math.max(0, Math.min(cells, Math.round((percent / 100) * cells)));
  return "▓".repeat(filled) + "░".repeat(cells - filled);
}

// ---------------------------------------------------------------------------
// Extension-Einstiegspunkt
// ---------------------------------------------------------------------------
export default function tokenSpeed(pi: ExtensionAPI): void {
  // ---- Footer registrieren -------------------------------------------------
  // Wird einmalig beim Session-Start gesetzt; der Render-Callback liest jeweils
  // den aktuellsten `state`.
  function installFooter(ctx: ExtensionContext): void {
    state.ctx = ctx;
    if (!ctx.hasUI) return;

    ctx.ui.setFooter((_tui, theme, footerData) => ({
      invalidate() {
        /* zustandslos – nichts zu invalidieren */
      },
      dispose() {
        /* keine Ressourcen zu räumen */
      },
      render(width: number): string[] {
        const model = state.ctx?.model;

        // --- Kontextnutzung --------------------------------------------------
        const usage = state.ctx?.getContextUsage();
        const contextWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
        const pct = usage?.percent ?? null;
        const pctStr = pct === null ? "?" : `${pct.toFixed(0)}%`;
        const ctxTokens = usage?.tokens ?? null;
        const ctxText =
          `ctx ${ctxTokens === null ? "?" : formatTokens(ctxTokens)}` +
          `/${formatTokens(contextWindow)} (${pctStr})`;

        // --- Balken ----------------------------------------------------------
        const bar = contextBar(pct ?? 0);

        // --- Segmente (linke Gruppe) ----------------------------------------
        const segments: string[] = [];
        segments.push(theme.fg("dim", ctxText));
        segments.push(theme.fg("dim", bar));

        // Speed: live während des Streamings, sonst der persistierte Wert.
        let speed: number | null = null;
        if (state.streamStart !== null) {
          const elapsed = (Date.now() - state.streamStart) / 1000;
          if (elapsed > 0.25) {
            const liveTokens =
              estimateTokens(state.streamedTextChars) +
              estimateTokens(state.streamedThinkChars);
            speed = liveTokens / elapsed;
          }
        } else if (state.lastSpeedTokPerSec !== null) {
          speed = state.lastSpeedTokPerSec;
        }
        if (speed !== null && speed > 0) {
          segments.push(theme.fg("accent", `↑ ${Math.round(speed)} tok/s`));
        }

        // Thinking-Level-Badge: nur wenn das Modell Reasoning unterstützt.
        if (model?.reasoning && state.thinkingLevel !== "off") {
          segments.push(
            theme.fg(thinkingColor(state.thinkingLevel), `[${state.thinkingLevel}]`),
          );
        }

        // Think-Tokens (geschätzt) — nur wenn vorhanden.
        const thinkTokens =
          state.streamStart !== null
            ? estimateTokens(state.streamedThinkChars)
            : state.lastThinkTokens ?? 0;
        if (thinkTokens > 0) {
          segments.push(theme.fg("dim", `think ${formatTokens(thinkTokens)}`));
        }

        // Out-Tokens.
        const outTokens =
          state.streamStart !== null
            ? estimateTokens(state.streamedTextChars)
            : state.lastOutputTokens ?? 0;
        if (outTokens > 0) {
          segments.push(theme.fg("success", `out ${formatTokens(outTokens)}`));
        }

        let left = segments.join("  ");

        // --- Modell (rechtsbündig) + Git-Branch -----------------------------
        const branch = footerData.getGitBranch();
        const modelName = model?.id ?? "no-model";
        const right = theme.fg("dim", branch ? `${modelName} (${branch})` : modelName);

        const leftWidth = visibleWidth(left);
        const rightWidth = visibleWidth(right);
        const minPad = 2;

        let line: string;
        if (leftWidth + minPad + rightWidth <= width) {
          line = left + " ".repeat(width - leftWidth - rightWidth) + right;
        } else if (width - minPad - rightWidth > 0) {
          left = truncateToWidth(left, width - minPad - rightWidth, "…");
          const lw = visibleWidth(left);
          line = left + " ".repeat(Math.max(0, width - lw - rightWidth)) + right;
        } else {
          line = truncateToWidth(left, width, "…");
        }

        return [line];
      },
    }));
  }

  // ---- Thinking-Level initial laden + bei Änderungen nachziehen -----------
  function refreshThinkingLevel(): void {
    try {
      state.thinkingLevel = pi.getThinkingLevel() as ThinkingLevelOff;
    } catch {
      /* getThinkingLevel evtl. nicht verfügbar – Wert beibehalten */
    }
  }

  // ---- Event-Handler -------------------------------------------------------
  pi.on("session_start", (_event, ctx) => {
    refreshThinkingLevel(); // WICHTIG: nicht erst auf thinking_level_select warten
    installFooter(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    state.ctx = ctx;
    refreshThinkingLevel(); // Level kann sich an Modellgrenzen ändern
  });

  pi.on("thinking_level_select", (event) => {
    state.thinkingLevel = event.level as ThinkingLevelOff;
  });

  // Generierungsstart: Stoppuhr + Zähler zurücksetzen.
  pi.on("message_start", (event, ctx) => {
    state.ctx = ctx;
    if (event.message.role !== "assistant") return;
    state.streamStart = Date.now();
    state.streamedTextChars = 0;
    state.streamedThinkChars = 0;
  });

  // Streaming: Text- und Thinking-Zeichen für Live-Speed/Tokens akkumulieren.
  pi.on("message_update", (event, ctx) => {
    state.ctx = ctx;
    const ev = event.assistantMessageEvent;
    if (ev.type === "text_delta") {
      state.streamedTextChars += ev.delta.length;
    } else if (ev.type === "thinking_delta") {
      state.streamedThinkChars += ev.delta.length;
    }
  });

  // Generierungsende: exakte Out-Tokens aus usage, Speed final berechnen & merken.
  pi.on("message_end", (event, ctx) => {
    state.ctx = ctx;
    if (event.message.role !== "assistant") {
      state.streamStart = null;
      return;
    }

    const elapsed =
      state.streamStart !== null ? (Date.now() - state.streamStart) / 1000 : 0;

    // usage.output ist der exakte Output-Tokenwert (Reasoning ist hier mit eingerechnet,
    // ein separates reasoning-Feld existiert in v0.76.0 nicht).
    const output = event.message.usage?.output ?? estimateTokens(state.streamedTextChars);

    state.lastOutputTokens = output;
    state.lastThinkTokens = estimateTokens(state.streamedThinkChars);
    state.lastSpeedTokPerSec =
      elapsed > 0 ? output / elapsed : state.lastSpeedTokPerSec;

    // Streaming beendet.
    state.streamStart = null;
  });
}
