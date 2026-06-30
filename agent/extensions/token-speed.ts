/**
 * token-speed.ts — Footer-Erweiterung für den Pi Coding Agent (v0.80.2)
 *
 * Footer-Layout (von links nach rechts):
 *   ctx 4.0k/1.0M (0%)  ▓▓▓░░░░░░░░  ↑ 42 tok/s  [medium]  think 1.2k  talk 3.4k  write 8.0k     glm-5.2 (master)
 *   └── Kontext ──────┘  └─ Balken ┘  └ Speed ──┘  └ Level ┘ └──────── 3 akkumulierte Metriken ────────┘  └ Modell (rechtsbündig) ──┘
 *
 * ── Drei Metriken (über die gesamte Unterhaltung akkumuliert) ──────────────
 *   think  = Reasoning-/Thinking-Tokens      (aus `thinking_delta`)
 *   talk   = sichtbare Chat-Antwort-Tokens   (aus `text_delta`)
 *   write  = in Dateien geschriebene Tokens  (aus `toolcall_delta` für edit/write)
 *
 *   Die Werte sind PERMANENT sichtbar und summieren sich über alle
 *   Assistant-Nachrichten der Session. So weiß man am Ende genau, wie viele
 *   der verbrauchten Output-Tokens Thinking waren und wie viele tatsächliche
 *   Chat-Ausgabe bzw. in Dateien geschriebener Inhalt.
 *
 * ── Warum die Token-Geschwindigkeit jetzt korrekt ist ──────────────────────
 *   `Usage.output` enthält Thinking + Text + Tool-Call-Args GEMEINSAM (kein
 *   separates reasoning-Feld). Think-Tokens werden daher aus den
 *   `thinking_delta`-Stream-Events bestimmt und der autoritative
 *   `usage.output`-Wert wird proportional auf die drei Buckets aufgeteilt.
 *
 *   Die Geschwindigkeit misst das echte Decode-Fenster (erstes Delta →
 *   letztes Delta), NICHT message_start → message_end. Letzteres würde Prefill
 *   + TTFT (time-to-first-token) enthalten und die tok/s vor allem bei
 *   Cloud-Modellen (hohe TTFT) stark nach unten verfälschen. Das Decode-Fenster
 *   entspricht exakt dem, was llama.cpp als „eval tok/s" ausgibt — lokal UND
 *   in der Cloud.
 */

import { visibleWidth, truncateToWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "@earendil-works/pi-ai";
import type { AssistantMessageEvent } from "@earendil-works/pi-ai";

type ThinkingLevelOff = ThinkingLevel | "off";

/** Werkzeuge, deren Tool-Call-Argumente als „in Dateien geschrieben" zählen. */
const WRITING_TOOLS = new Set(["edit", "write", "multiedit", "multi_edit"]);

// ---------------------------------------------------------------------------
// Akkumulierte Session-Totals (authoritativ, über alle Nachrichten summiert).
// ---------------------------------------------------------------------------
interface Totals {
  thinking: number;
  talking: number;
  writing: number;
}

// ---------------------------------------------------------------------------
// Live-Zustand der laufenden Assistant-Nachricht.
// ---------------------------------------------------------------------------
interface MessageTracker {
  /** Zeitstempel (ms) des message_start (Fallback für das Zeitfenster). */
  startMs: number | null;
  /** Zeitstempel (ms) des ERSTEN Inhalts-Deltas (= Start des Decode-Fensters). */
  firstDeltaMs: number | null;
  /** Zeitstempel (ms) des LETZTEN Inhalts-Deltas (= Ende des Decode-Fensters). */
  lastDeltaMs: number | null;
  /** Zeichen aus thinking_delta. */
  thinkChars: number;
  /** Zeichen aus text_delta (Chat-Antwort). */
  talkChars: number;
  /** Zeichen aus toolcall_delta, aufgeschlüsselt nach contentIndex. */
  toolChars: Map<number, number>;
  /** Tool-Name pro contentIndex (für edit/write-Erkennung). */
  toolNames: Map<number, string>;
}

function newTracker(): MessageTracker {
  return {
    startMs: null,
    firstDeltaMs: null,
    lastDeltaMs: null,
    thinkChars: 0,
    talkChars: 0,
    toolChars: new Map(),
    toolNames: new Map(),
  };
}

interface SpeedState {
  ctx: ExtensionContext | undefined;
  thinkingLevel: ThinkingLevelOff;
  /** Live-Tracker der gerade streamenden Nachricht. */
  live: MessageTracker;
  /** Autoritativ akkumulierte Token-Totals über die ganze Session. */
  totals: Totals;
  /** tok/s der zuletzt abgeschlossenen Nachricht (bleibt nach Generierung sichtbar). */
  lastSpeedTokPerSec: number | null;
}

const state: SpeedState = {
  ctx: undefined,
  thinkingLevel: "off",
  live: newTracker(),
  totals: { thinking: 0, talking: 0, writing: 0 },
  lastSpeedTokPerSec: null,
};

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

/** Kompakte Token-Darstellung (123, 4.0k, 12k, 1.2M …). */
function formatTokens(count: number): string {
  if (count < 1000) return Math.round(count).toString();
  if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1000000) return `${Math.round(count / 1000)}k`;
  if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
  return `${Math.round(count / 1000000)}M`;
}

/** Grobe Token-Schätzung aus Zeichenanzahl (~4 Zeichen pro Token). */
function estimateTokens(chars: number): number {
  return chars <= 0 ? 0 : Math.max(1, Math.round(chars / 4));
}

/** Theme-Farbe passend zum Thinking-Level (gültige ThemeColor-Werte in v0.80.2). */
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

/** Summe aller Map-Werte. */
function sumMap(map: Map<number, number>): number {
  let s = 0;
  for (const v of map.values()) s += v;
  return s;
}

/** Zeichen, die in dieser Nachricht auf „writing" (edit/write) entfallen. */
function writingCharsOf(t: MessageTracker): number {
  let s = 0;
  for (const [idx, chars] of t.toolChars) {
    if (WRITING_TOOLS.has(t.toolNames.get(idx) ?? "")) s += chars;
  }
  return s;
}

/** Zeichen der Tool-Calls, die NICHT writing sind (bash/grep/… — „other"). */
function otherToolCharsOf(t: MessageTracker): number {
  let s = 0;
  for (const [idx, chars] of t.toolChars) {
    if (!WRITING_TOOLS.has(t.toolNames.get(idx) ?? "")) s += chars;
  }
  return s;
}

/** Registriert einen Inhalts-Delta-Zeitpunkt für das Decode-Fenster. */
function noteDelta(t: MessageTracker, now: number): void {
  if (t.firstDeltaMs === null) t.firstDeltaMs = now;
  t.lastDeltaMs = now;
}

// ---------------------------------------------------------------------------
// Extension-Einstiegspunkt
// ---------------------------------------------------------------------------
export default function tokenSpeed(pi: ExtensionAPI): void {
  // ---- Footer registrieren -------------------------------------------------
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
        const live = state.live;

        // --- Kontextnutzung --------------------------------------------------
        const usage = state.ctx?.getContextUsage();
        const contextWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
        const pct = usage?.percent ?? null;
        const pctStr = pct === null ? "?" : `${pct.toFixed(0)}%`;
        const ctxTokens = usage?.tokens ?? null;
        const ctxText =
          `ctx ${ctxTokens === null ? "?" : formatTokens(ctxTokens)}` +
          `/${formatTokens(contextWindow)} (${pctStr})`;

        const bar = contextBar(pct ?? 0);

        // --- Live-Werte: akkumulierte Totals + Schätzung der laufenden Nachricht
        const streaming = live.firstDeltaMs !== null;
        const liveThink = estimateTokens(live.thinkChars);
        const liveTalk = estimateTokens(live.talkChars);
        const liveWrite = estimateTokens(writingCharsOf(live));

        const thinkVal = state.totals.thinking + (streaming ? liveThink : 0);
        const talkVal = state.totals.talking + (streaming ? liveTalk : 0);
        const writeVal = state.totals.writing + (streaming ? liveWrite : 0);
        const hasAny = thinkVal > 0 || talkVal > 0 || writeVal > 0 || streaming;

        // --- Speed: live während des Streamings, sonst der persistierte Wert ---
        let speed: number | null = null;
        if (streaming) {
          const now = Date.now();
          const liveMs = live.firstDeltaMs !== null ? now - live.firstDeltaMs : 0;
          if (liveMs > 250) {
            const liveTokens = liveThink + liveTalk + estimateTokens(sumMap(live.toolChars));
            speed = liveTokens / (liveMs / 1000);
          }
        } else if (state.lastSpeedTokPerSec !== null) {
          speed = state.lastSpeedTokPerSec;
        }

        // --- Segmente (linke Gruppe) ----------------------------------------
        const segments: string[] = [];
        segments.push(theme.fg("dim", ctxText));
        segments.push(theme.fg("dim", bar));

        if (speed !== null && speed > 0) {
          segments.push(theme.fg("accent", `↑ ${Math.round(speed)} tok/s`));
        }

        // Thinking-Level-Badge: nur wenn das Modell Reasoning unterstützt.
        if (model?.reasoning && state.thinkingLevel !== "off") {
          segments.push(
            theme.fg(thinkingColor(state.thinkingLevel), `[${state.thinkingLevel}]`),
          );
        }

        // --- Drei akkumulierte Metriken (permanent sichtbar ab erster Aktivität)
        if (hasAny) {
          segments.push(theme.fg("thinkingMedium", `think ${formatTokens(thinkVal)}`));
          segments.push(theme.fg("success", `talk ${formatTokens(talkVal)}`));
          segments.push(theme.fg("toolDiffAdded", `write ${formatTokens(writeVal)}`));
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

  // Neue/geladene/gabelte Session: Totals zurücksetzen (nur diese Instanz zählt).
  pi.on("session_start", (_event, ctx) => {
    refreshThinkingLevel();
    state.totals = { thinking: 0, talking: 0, writing: 0 };
    state.live = newTracker();
    state.lastSpeedTokPerSec = null;
    installFooter(ctx);
  });

  pi.on("model_select", (_event, ctx) => {
    state.ctx = ctx;
    refreshThinkingLevel();
  });

  pi.on("thinking_level_select", (event) => {
    state.thinkingLevel = event.level as ThinkingLevelOff;
  });

  // Generierungsstart: Tracker zurücksetzen + Stoppuhr starten.
  pi.on("message_start", (event, ctx) => {
    state.ctx = ctx;
    if (event.message.role !== "assistant") return;
    state.live = newTracker();
    state.live.startMs = Date.now();
  });

  // Streaming: Zeichen + Decode-Fenster pro Bucket akkumulieren.
  pi.on("message_update", (event, ctx) => {
    state.ctx = ctx;
    const ev: AssistantMessageEvent = event.assistantMessageEvent;
    const now = Date.now();
    const live = state.live;

    switch (ev.type) {
      case "thinking_delta":
        live.thinkChars += ev.delta.length;
        noteDelta(live, now);
        break;
      case "text_delta":
        live.talkChars += ev.delta.length;
        noteDelta(live, now);
        break;
      case "toolcall_delta":
        live.toolChars.set(ev.contentIndex, (live.toolChars.get(ev.contentIndex) ?? 0) + ev.delta.length);
        noteDelta(live, now);
        break;
      case "toolcall_start": {
        // Name steht oft schon im partiellen ToolCall bereit (vor den Argumenten).
        const c = ev.partial.content[ev.contentIndex];
        if (c && c.type === "toolCall" && c.name) {
          live.toolNames.set(ev.contentIndex, c.name);
        }
        break;
      }
      case "toolcall_end":
        live.toolNames.set(ev.contentIndex, ev.toolCall.name);
        break;
      default:
        break;
    }
  });

  // Generierungsende: autoritativen usage.output proportional splitten + Speed.
  pi.on("message_end", (event, ctx) => {
    state.ctx = ctx;
    const live = state.live;

    if (event.message.role !== "assistant") {
      // Keine Assistant-Nachricht — Live-Tracker verwerfen.
      state.live = newTracker();
      return;
    }

    const usage = event.message.usage;
    // usage.output = Thinking + Text + Tool-Args GEMEINSAM (alle generierten Tokens).
    const output = typeof usage?.output === "number" && usage.output > 0 ? usage.output : null;

    const tC = live.thinkChars;
    const kC = live.talkChars;
    const wC = writingCharsOf(live);
    const oC = otherToolCharsOf(live); // bash/grep/… (bleibt ohne eigenes Label)
    const totalChars = tC + kC + wC + oC;

    let thinkTokens: number;
    let talkTokens: number;
    let writeTokens: number;

    if (output !== null && totalChars > 0) {
      // Autoritativen usage.output proportional auf die Buckets aufteilen,
      // sodass die Summe exakt den realen Output-Tokens entspricht.
      thinkTokens = Math.round((output * tC) / totalChars);
      writeTokens = Math.round((output * wC) / totalChars);
      talkTokens = output - thinkTokens - writeTokens; // Rest → talk (Rundung auffangen)
    } else {
      // Kein usage.output verfügbar → reine Zeichen-Schätzung.
      thinkTokens = estimateTokens(tC);
      talkTokens = estimateTokens(kC);
      writeTokens = estimateTokens(wC);
    }

    state.totals.thinking += thinkTokens;
    state.totals.talking += talkTokens;
    state.totals.writing += writeTokens;

    // --- Speed über das echte Decode-Fenster (first delta → last delta) -----
    const genTokens = output ?? estimateTokens(totalChars);
    let elapsedSec = 0;
    if (live.lastDeltaMs !== null && live.firstDeltaMs !== null && live.lastDeltaMs > live.firstDeltaMs) {
      elapsedSec = (live.lastDeltaMs - live.firstDeltaMs) / 1000;
    } else if (live.startMs !== null) {
      // Fallback: gesamtes message_start → message_end (falls kein Delta registriert).
      elapsedSec = (Date.now() - live.startMs) / 1000;
    }
    if (elapsedSec > 0) {
      state.lastSpeedTokPerSec = genTokens / elapsedSec;
    }

    // Streaming beendet.
    state.live = newTracker();
  });
}
