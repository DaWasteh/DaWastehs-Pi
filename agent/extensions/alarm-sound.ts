import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentEndEvent, ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Honour PI_CODING_AGENT_DIR like every other extension instead of assuming ~/.pi/agent.
const ALARM_PATH = join(
  process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"),
  "extensions",
  "audio",
  "alarm.mp3",
);
const ALARM_VOLUME = 30;
const ALARM_TIMEOUT_MS = 30_000;
const USER_INPUT_TOOL_NAMES = new Set(["ask_user_question"]);

type AlarmReason = "user-input" | "confirmation" | "agent-complete" | "manual-test";

type DialogUI = {
  confirm(title: string, message: string, options?: unknown): Promise<boolean>;
  select(title: string, options: string[], dialogOptions?: unknown): Promise<string | undefined>;
};

type DialogAlarmState = {
  originalConfirm: DialogUI["confirm"];
  originalSelect: DialogUI["select"];
  onOpen: (reason: AlarmReason) => void;
  onClose: (reason: AlarmReason) => void;
  wrappedConfirm?: DialogUI["confirm"];
  wrappedSelect?: DialogUI["select"];
};

const DIALOG_ALARM_STATE = Symbol.for("pi.alarm-sound.dialog-wrapper.v1");

export function selectionNeedsAttention(title: string, options: string[]): boolean {
  const normalizedOptions = options.map((option) => option.trim().toLowerCase());
  const hasAllow = normalizedOptions.some((option) => /^(?:yes|ja|allow|approve|authorize|trust|continue|run|zulassen|erlauben|vertrauen|fortfahren|ausführen)/.test(option));
  const hasDeny = normalizedOptions.some((option) => /^(?:no|nein|deny|decline|cancel|do\s+not\s+trust|abbrechen|ablehnen|nicht\s+vertrauen|block)/.test(option));
  if (!hasAllow || !hasDeny) return false;
  return /(?:permission|approval|authorize|allow|danger|destructive|delete|remove|install|trust|sandbox|mcp|freigab|zulassen|erlaub|gefähr|risiko|löschen|entfern|installier|vertrau)/i.test(title);
}

export function installDialogAlarm(
  ui: DialogUI,
  onOpen: (reason: AlarmReason) => void,
  onClose: (reason: AlarmReason) => void,
): void {
  const target = ui as DialogUI & { [DIALOG_ALARM_STATE]?: DialogAlarmState };
  const existing = target[DIALOG_ALARM_STATE];
  if (existing) {
    existing.onOpen = onOpen;
    existing.onClose = onClose;
    return;
  }

  const state: DialogAlarmState = {
    originalConfirm: ui.confirm.bind(ui),
    originalSelect: ui.select.bind(ui),
    onOpen,
    onClose,
  };
  target[DIALOG_ALARM_STATE] = state;

  state.wrappedConfirm = async (title, message, options) => {
    state.onOpen("confirmation");
    try {
      return await state.originalConfirm(title, message, options);
    } finally {
      state.onClose("confirmation");
    }
  };
  state.wrappedSelect = async (title, options, dialogOptions) => {
    if (!selectionNeedsAttention(title, options)) {
      return state.originalSelect(title, options, dialogOptions);
    }
    state.onOpen("confirmation");
    try {
      return await state.originalSelect(title, options, dialogOptions);
    } finally {
      state.onClose("confirmation");
    }
  };
  target.confirm = state.wrappedConfirm;
  target.select = state.wrappedSelect;
}

export function uninstallDialogAlarm(ui: DialogUI): void {
  const target = ui as DialogUI & { [DIALOG_ALARM_STATE]?: DialogAlarmState };
  const state = target[DIALOG_ALARM_STATE];
  if (!state) return;
  if (target.confirm === state.wrappedConfirm) target.confirm = state.originalConfirm;
  if (target.select === state.wrappedSelect) target.select = state.originalSelect;
  delete target[DIALOG_ALARM_STATE];
}

let alarmProcess: ChildProcess | null = null;
let activeAlarmReason: AlarmReason | null = null;
let alarmEnabled = true;
let lastAlarmError: string | null = null;
let lastAgentRunCompleted = false;

function rememberError(error: unknown): void {
  lastAlarmError = error instanceof Error ? error.message : String(error);
}

function psString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildPowerShellPlayerScript(filePath: string): string {
  // PresentationCore/System.Windows.Media.MediaPlayer can play mp3 on a stock
  // Windows install. This is the fallback for systems without ffplay/ffmpeg.
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$player = [System.Windows.Media.MediaPlayer]::new()
$player.Open([System.Uri]::new(${psString(filePath)}))
$player.Volume = ${ALARM_VOLUME / 100}
$player.Play()
$deadline = [DateTime]::UtcNow.AddMilliseconds(${ALARM_TIMEOUT_MS})
while (-not $player.NaturalDuration.HasTimeSpan -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 50
}
if ($player.NaturalDuration.HasTimeSpan) {
  $end = [DateTime]::UtcNow.Add($player.NaturalDuration.TimeSpan).AddMilliseconds(500)
  if ($end -gt $deadline) { $end = $deadline }
  while ([DateTime]::UtcNow -lt $end) {
    Start-Sleep -Milliseconds 100
  }
} else {
  Start-Sleep -Seconds 5
}
$player.Close()
`;
}

function startProcess(
  command: string,
  args: string[],
  handlers: {
    onSpawn?: () => void;
    onError?: (error: Error) => void;
    onExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
  } = {},
): ChildProcess | null {
  let child: ChildProcess;

  try {
    child = spawn(command, args, { stdio: "ignore", windowsHide: true });
  } catch (error) {
    handlers.onError?.(error as Error);
    return null;
  }

  const timeout = setTimeout(() => {
    if (!child.killed) child.kill("SIGTERM");
  }, ALARM_TIMEOUT_MS);

  child.once("spawn", () => {
    handlers.onSpawn?.();
  });

  child.once("error", (error) => {
    clearTimeout(timeout);
    const wasActive = alarmProcess === child;
    if (wasActive) handlers.onError?.(error);
    if (alarmProcess === child) {
      alarmProcess = null;
      activeAlarmReason = null;
    }
  });

  child.once("exit", (code, signal) => {
    clearTimeout(timeout);
    const wasActive = alarmProcess === child;
    if (wasActive) handlers.onExit?.(code, signal);
    if (alarmProcess === child) {
      alarmProcess = null;
      activeAlarmReason = null;
    }
  });

  alarmProcess = child;
  return child;
}

function startWindowsPlayer(): boolean {
  if (process.platform !== "win32") return false;

  const encodedCommand = Buffer.from(buildPowerShellPlayerScript(ALARM_PATH), "utf16le").toString("base64");
  const child = startProcess(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-EncodedCommand", encodedCommand],
    {
      onError: rememberError,
      onExit: (code, signal) => {
        if (signal === null && code !== null && code !== 0) {
          lastAlarmError = `PowerShell audio player exited with code ${code}`;
        }
      },
    },
  );

  return child !== null;
}

function startFfplayOrFallback(reason: AlarmReason): void {
  let spawned = false;
  let fallbackStarted = false;

  const startFallback = (error: unknown) => {
    if (fallbackStarted) return;
    fallbackStarted = true;

    activeAlarmReason = reason;
    if (!startWindowsPlayer()) {
      activeAlarmReason = null;
      rememberError(error);
    }
  };

  startProcess(
    "ffplay",
    ["-nodisp", "-autoexit", "-loglevel", "quiet", "-volume", String(ALARM_VOLUME), ALARM_PATH],
    {
      onSpawn: () => {
        spawned = true;
      },
      onError: startFallback,
      onExit: (code, signal) => {
        if (spawned && signal === null && code !== null && code !== 0) {
          startFallback(new Error(`ffplay exited with code ${code}`));
        }
      },
    },
  );
}

function playAlarm(reason: AlarmReason): void {
  if (!alarmEnabled) return;
  if (activeAlarmReason === reason && alarmProcess && !alarmProcess.killed) return;

  stopAlarm();
  activeAlarmReason = reason;
  lastAlarmError = null;

  if (!existsSync(ALARM_PATH)) {
    activeAlarmReason = null;
    lastAlarmError = `Alarm-Datei fehlt: ${ALARM_PATH}`;
    return;
  }

  startFfplayOrFallback(reason);
}

function stopAlarm(reason?: AlarmReason): void {
  if (reason !== undefined && activeAlarmReason !== reason) return;

  const child = alarmProcess;
  alarmProcess = null;
  activeAlarmReason = null;

  if (child && !child.killed) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Prozess vielleicht schon tot
    }
  }
}

function shouldPlayForMode(ctx: unknown): boolean {
  const mode = (ctx as { mode?: string }).mode;
  return mode === "tui" || mode === "rpc";
}

function isAssistantMessage(message: unknown): message is { role: "assistant"; stopReason: string } {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { role?: unknown }).role === "assistant" &&
    typeof (message as { stopReason?: unknown }).stopReason === "string"
  );
}

function getLastAssistantMessage(messages: AgentEndEvent["messages"]): { role: "assistant"; stopReason: string } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (isAssistantMessage(message)) return message;
  }

  return null;
}

function shouldPlayForAgentEnd(event: AgentEndEvent): boolean {
  // agent_end feuert auch bei Provider-/Reconnect-Fehlern, Abbrüchen und Length-Stops.
  // Nur ein finales "stop" bedeutet: Pi ist wirklich mit der Antwort/Aufgabe fertig.
  return getLastAssistantMessage(event.messages)?.stopReason === "stop";
}

export default function (pi: ExtensionAPI) {
  const installForContext = (ctx: unknown) => {
    const candidate = ctx as { mode?: string; hasUI?: boolean; ui?: Partial<DialogUI> };
    if (!candidate.hasUI || !candidate.ui || typeof candidate.ui.confirm !== "function" || typeof candidate.ui.select !== "function") return;
    installDialogAlarm(candidate.ui as DialogUI, playAlarm, stopAlarm);
  };

  const unsubscribeAttention = pi.events?.on?.("pi:user-attention-required", () => playAlarm("user-input"));
  const unsubscribeResolved = pi.events?.on?.("pi:user-attention-resolved", () => stopAlarm("user-input"));

  pi.on("project_trust", async (_event, ctx) => {
    installForContext(ctx);
    return { trusted: "undecided" as const };
  });

  pi.on("session_start", async (_event, ctx) => {
    installForContext(ctx);
  });

  pi.on("agent_start", async (_event, ctx) => {
    // Neuer Low-Level-Lauf → laufenden Sound stoppen und Abschlussstatus zurücksetzen.
    lastAgentRunCompleted = false;
    if (shouldPlayForMode(ctx)) {
      stopAlarm();
    }
  });

  pi.on("tool_execution_start", async (event, ctx) => {
    // Tools wie ask_user_question blockieren auf Userinput, bevor agent_end feuert.
    if (shouldPlayForMode(ctx) && USER_INPUT_TOOL_NAMES.has(event.toolName)) {
      playAlarm("user-input");
    }
  });

  pi.on("tool_execution_end", async (event, ctx) => {
    // Sobald die Antwort vorliegt, nicht weiterklingeln während der Agent weiterarbeitet.
    if (shouldPlayForMode(ctx) && USER_INPUT_TOOL_NAMES.has(event.toolName)) {
      stopAlarm("user-input");
    }
  });

  pi.on("agent_end", async (event) => {
    // agent_end beendet nur einen Low-Level-Lauf. Pi 0.83 kann danach noch
    // automatisch retryen, komprimieren oder eine Follow-up-Nachricht ausführen.
    lastAgentRunCompleted = shouldPlayForAgentEnd(event);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    // Erst jetzt garantiert Pi, dass keine automatische Fortsetzung mehr folgt.
    if (shouldPlayForMode(ctx) && lastAgentRunCompleted) {
      lastAgentRunCompleted = false;
      playAlarm("agent-complete");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    stopAlarm();
    const candidate = ctx as { ui?: Partial<DialogUI> };
    if (candidate.ui && typeof candidate.ui.confirm === "function" && typeof candidate.ui.select === "function") {
      uninstallDialogAlarm(candidate.ui as DialogUI);
    }
    unsubscribeAttention?.();
    unsubscribeResolved?.();
  });

  pi.registerCommand("alarm-sounds", {
    description: "Alarm-Sound aktivieren/deaktivieren/testen/prüfen (on/off/test/status)",
    handler: async (args, ctx) => {
      const arg = args.trim().toLowerCase();

      if (arg === "on") {
        alarmEnabled = true;
        ctx.ui.notify("Alarm-Sound aktiviert", "info");
      } else if (arg === "off") {
        alarmEnabled = false;
        stopAlarm();
        ctx.ui.notify("Alarm-Sound deaktiviert", "info");
      } else if (arg === "test") {
        playAlarm("manual-test");
        ctx.ui.notify(
          lastAlarmError ? `Alarm-Test konnte nicht starten: ${lastAlarmError}` : "Alarm-Test gestartet",
          lastAlarmError ? "error" : "info",
        );
      } else if (arg === "status") {
        ctx.ui.notify(
          `Alarm: ${alarmEnabled ? "aktiv" : "aus"}; Wiedergabe: ${activeAlarmReason ?? "inaktiv"}${lastAlarmError ? `; letzter Fehler: ${lastAlarmError}` : ""}`,
          lastAlarmError ? "warning" : "info",
        );
      } else {
        ctx.ui.notify(
          `Nutzung: /alarm-sounds on|off|test|status (aktuell: ${alarmEnabled ? "on" : "off"})`,
          "warning",
        );
      }
    },
  });
}
