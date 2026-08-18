// Merkt sich pro Wallet die Token-ID und das zuletzt bekannte Level, damit
// der Bot nicht bei jeder einzelnen Fütterung die komplette Blockchain-
// Historie neu durchsuchen und das Level extra abfragen muss. Die Token-ID
// einer Wallet ändert sich nie (ein Ei pro Wallet), das Level kennen wir
// nach der ersten Fütterung selbst - wir sind schließlich die Einzigen,
// die feed() aufrufen.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "token-cache.json");

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

/** Liefert { tokenId, level } für eine Wallet, oder undefined wenn noch unbekannt. */
export function getCachedToken(walletAddress) {
  const data = readJson();
  return data[walletAddress];
}

/** Speichert Token-ID + (aktuelles) Level für eine Wallet - z.B. nach der ersten Fütterung. */
export function setCachedToken(walletAddress, tokenId, level) {
  const data = readJson();
  data[walletAddress] = { tokenId: tokenId.toString(), level: Number(level) };
  writeJson(data);
}

/** Zählt das gemerkte Level einer Wallet um 1 hoch und gibt den neuen Wert zurück. */
export function bumpCachedLevel(walletAddress) {
  const data = readJson();
  const entry = data[walletAddress];
  if (!entry) return null;
  entry.level += 1;
  writeJson(data);
  return entry.level;
}
