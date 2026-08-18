// Verwaltet die einmalige OAuth-Erlaubnis von deinem Blaze-Account, damit der
// Bot Chat-Nachrichten SENDEN darf (channel.moderate-Scope). Der App-Token
// alleine reicht dafür nicht aus - nur Lesen von Chat-Nachrichten geht damit.
//
// Ablauf: /api/blaze-oauth/start -> Blaze-Zustimmungsseite -> Blaze leitet
// zurück zu /api/blaze-oauth/callback -> Tokens werden hier gespeichert.

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, "..", "data");
const PENDING_FILE = path.join(DATA_DIR, "blaze-oauth-pending.json");
const TOKENS_FILE = path.join(DATA_DIR, "blaze-oauth-tokens.json");

const REDIRECT_URI = "http://localhost:3000/api/blaze-oauth/callback";
const SCOPES = ["channel.moderate", "users.bot", "offline.access"];

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readJson(file) {
  ensureDataDir();
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  ensureDataDir();
  writeFileSync(file, JSON.stringify(data, null, 2));
}

/** Fordert von Blaze eine Zustimmungs-URL an und merkt sich state+codeVerifier. */
export async function generateAuthUrl(clientId, clientSecret) {
  const res = await fetch("https://blaze.stream/bapi/oauth2/generate-auth-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      clientSecret,
      redirectUri: REDIRECT_URI,
      scopes: SCOPES,
    }),
  });
  if (!res.ok) {
    throw new Error(`generate-auth-url fehlgeschlagen: HTTP ${res.status} - ${await res.text()}`);
  }
  const data = await res.json();
  writeJson(PENDING_FILE, { state: data.state, codeVerifier: data.codeVerifier });
  return data.url;
}

/** Tauscht den von Blaze zurückgegebenen Code gegen echte Tokens ein. */
export async function exchangeCode(clientId, clientSecret, code, state) {
  const pending = readJson(PENDING_FILE);
  if (!pending || pending.state !== state) {
    throw new Error("Unbekannter oder abgelaufener OAuth-state - bitte Verknüpfung neu starten.");
  }

  const res = await fetch("https://blaze.stream/bapi/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      clientSecret,
      code,
      codeVerifier: pending.codeVerifier,
      redirectUri: REDIRECT_URI,
      grantType: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token-Austausch fehlgeschlagen: HTTP ${res.status} - ${await res.text()}`);
  }
  const data = await res.json();

  writeJson(TOKENS_FILE, {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  });

  if (existsSync(PENDING_FILE)) unlinkSync(PENDING_FILE);
}

/** Erneuert den Access Token über den gespeicherten Refresh Token. */
async function refreshAccessToken(clientId, clientSecret) {
  const tokens = readJson(TOKENS_FILE);
  if (!tokens?.refreshToken) {
    throw new Error("Kein Blaze-Refresh-Token vorhanden - bitte einmalig neu verknüpfen.");
  }

  const res = await fetch("https://blaze.stream/bapi/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      clientSecret,
      refreshToken: tokens.refreshToken,
      grantType: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`Token-Erneuerung fehlgeschlagen: HTTP ${res.status} - ${await res.text()}`);
  }
  const data = await res.json();

  const updated = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken ?? tokens.refreshToken,
    expiresAt: Date.now() + data.expiresIn * 1000,
  };
  writeJson(TOKENS_FILE, updated);
  return updated;
}

/** Liefert einen gültigen Access Token, erneuert ihn bei Bedarf automatisch. */
export async function getValidUserAccessToken(clientId, clientSecret) {
  let tokens = readJson(TOKENS_FILE);
  if (!tokens) return null;

  // 60 Sekunden Puffer vor Ablauf schon erneuern
  if (Date.now() > tokens.expiresAt - 60_000) {
    tokens = await refreshAccessToken(clientId, clientSecret);
  }
  return tokens.accessToken;
}

export function hasStoredTokens() {
  return readJson(TOKENS_FILE) !== null;
}
