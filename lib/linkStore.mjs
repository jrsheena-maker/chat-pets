// Verwaltet die Verknüpfung "Blaze-Chat-Konto <-> Wallet-Adresse".
// Bewusst getrennt vom NFT selbst (siehe Absprache): Besitz des Eis bleibt
// die Wallet-Adresse, diese Verknüpfung ist nur eine austauschbare Brücke,
// über die der Füttern-Bot weiß, wessen Ei er bei "!füttern" leveln soll.
//
// Wird sowohl von der Next.js-App (zum Code-Erzeugen) als auch vom
// separaten Chat-Bot-Dienst (zum Code-Einlösen) genutzt - deshalb als
// einfache JSON-Dateien auf der Platte statt im Arbeitsspeicher.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const CODES_FILE = path.join(DATA_DIR, "link-codes.json");
const LINKS_FILE = path.join(DATA_DIR, "blaze-links.json");

const CODE_TTL_MS = 10 * 60 * 1000; // Ein Code ist 10 Minuten gültig.
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O, 1/I - weniger Verwechslungsgefahr beim Abtippen im Chat

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file) {
  ensureDataDir();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

function writeJson(file, data) {
  ensureDataDir();
  writeFileSync(file, JSON.stringify(data, null, 2));
}

function randomCode() {
  let code = "EGG-";
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

/** Erzeugt einen neuen, zeitlich begrenzten Link-Code für eine Wallet-Adresse. */
export function createLinkCode(walletAddress) {
  const codes = readJson(CODES_FILE);

  // nebenbei abgelaufene Codes aufräumen
  const now = Date.now();
  for (const [existingCode, entry] of Object.entries(codes)) {
    if (now - entry.createdAt > CODE_TTL_MS) delete codes[existingCode];
  }

  const code = randomCode();
  codes[code] = { walletAddress, createdAt: now };
  writeJson(CODES_FILE, codes);

  return { code, expiresInMs: CODE_TTL_MS };
}

/**
 * Löst einen im Chat getippten Code ein und verknüpft die Blaze-Sender-ID
 * mit der Wallet-Adresse, die den Code erzeugt hat. Gibt bei Erfolg die
 * Wallet-Adresse zurück, sonst null (Code falsch/abgelaufen).
 */
export function redeemLinkCode(rawCode, blazeSender) {
  const code = rawCode.trim().toUpperCase();
  const codes = readJson(CODES_FILE);
  const entry = codes[code];
  if (!entry) return null;

  delete codes[code];
  writeJson(CODES_FILE, codes);

  if (Date.now() - entry.createdAt > CODE_TTL_MS) return null;

  const links = readJson(LINKS_FILE);
  links[blazeSender.id] = {
    walletAddress: entry.walletAddress,
    username: blazeSender.username,
    linkedAt: Date.now(),
  };
  writeJson(LINKS_FILE, links);

  return entry.walletAddress;
}

/** Liefert die verknüpfte Wallet-Adresse für ein Blaze-Konto (oder null). */
export function getLinkedWallet(blazeSenderId) {
  const links = readJson(LINKS_FILE);
  return links[blazeSenderId]?.walletAddress ?? null;
}
