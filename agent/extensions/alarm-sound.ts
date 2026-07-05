import { exec } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ALARM_PATH = join(homedir(), ".pi", "agent", "extensions", "audio", "alarm.mp3");

let alarmProcess: ReturnType<typeof exec> | null = null;

function playAlarm(): void {
  if (alarmProcess) {
    // Falls noch ein alter Sound läuft, zuerst killen
    try {
      alarmProcess.kill("SIGTERM");
    } catch {
      // Prozess vielleicht schon tot
    }
  }

  try {
    // ffplay spielt den Ton ab ohne Video-Fenster (-nodisp),
    // -volume 30 setzt die Lautstärke auf 30%
    alarmProcess = exec(
      `ffplay -nodisp -autoexit -loglevel quiet -volume 30 "${ALARM_PATH}"`,
      { timeout: 30000 }
    );
  } catch {
    // Ignoriere Fehler wenn ffmpeg nicht verfügbar
    alarmProcess = null;
  }
}

function stopAlarm(): void {
  if (alarmProcess) {
    try {
      alarmProcess.kill("SIGTERM");
    } catch {
      // Prozess vielleicht schon tot
    }
    alarmProcess = null;
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", async (_event, ctx) => {
    // Neuer Prompt → laufenden Sound stoppen
    if (ctx.mode === "tui" || ctx.mode === "rpc") {
      stopAlarm();
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    // Agent fertig → Sound abspielen
    if (ctx.mode === "tui" || ctx.mode === "rpc") {
      playAlarm();
    }
  });
}
