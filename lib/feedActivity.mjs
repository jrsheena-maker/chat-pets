// Merkt sich, welche Eier kürzlich gefüttert wurden - fürs OBS-Overlay.
// Wird vom Bot-Dienst (bei jeder erfolgreichen Fütterung) geschrieben und von
// der Overlay-Seite gelesen. Bewusst getrennt vom eigentlichen Vertrag: der
// Vertrag speichert kein "wann zuletzt gefüttert", nur das aktuelle Level.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "feed-activity.json");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson() {
  ensureDataDir();
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(data) {
  ensureDataDir();
  writeFileSync(FILE, JSON.stringify(data, null, 2));
}

/** Merkt sich, dass ein Ei gerade gefüttert wurde (für das OBS-Overlay). */
export function recordFeed(tokenId, walletAddress, level) {
  const data = readJson();
  data[tokenId.toString()] = {
    walletAddress,
    level: level.toString(),
    feedAt: Date.now(),
  };
  writeJson(data);
}

/** Liefert alle Eier, die innerhalb der letzten `windowMs` gefüttert wurden. */
export function getRecentlyFed(windowMs) {
  const data = readJson();
  const now = Date.now();
  return Object.entries(data)
    .filter(([, entry]) => now - entry.feedAt <= windowMs)
    .map(([tokenId, entry]) => ({
      tokenId,
      walletAddress: entry.walletAddress,
      level: Number(entry.level),
      feedAt: entry.feedAt,
    }));
}
