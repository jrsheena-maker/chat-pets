// Kurzlebiger "Live-Ereignis"-Kanal zwischen Bot-Dienst und Overlay-Seite.
// Getrennt von feedActivity.mjs (das ist der dauerhafte, bestätigte Zustand)
// - hier geht es nur um kurze, sofortige UI-Reaktionen, die auch mal falsch
// liegen dürfen (z.B. wenn eine Transaktion am Ende doch fehlschlägt), weil
// das Overlay den echten Zustand sowieso regelmäßig separat nachlädt.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "live-events.json");

// Nur die letzten paar Ereignisse behalten - das hier ist kein Verlauf,
// nur ein kurzer "Briefkasten" für die aktuell verbundenen Overlay-Tabs.
const MAX_EVENTS = 30;

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readEvents() {
  ensureDataDir();
  if (!existsSync(FILE)) return [];
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeEvents(events) {
  ensureDataDir();
  writeFileSync(FILE, JSON.stringify(events, null, 2));
}

/**
 * Meldet ein sofortiges UI-Ereignis fürs Overlay, z.B.:
 *  { type: "feed-attempt", tokenId, walletAddress }
 *  { type: "level-up", tokenId, walletAddress, newLevel }
 */
export function appendLiveEvent(event) {
  const events = readEvents();
  events.push({ ...event, ts: Date.now() });
  writeEvents(events.slice(-MAX_EVENTS));
}

/** Liefert alle Ereignisse, die NACH dem gegebenen Zeitstempel passiert sind. */
export function getEventsSince(sinceTs) {
  return readEvents().filter((e) => e.ts > sinceTs);
}
