// Füttern-Bot: liest den Blaze-Chat mit und führt bei bestimmten Nachrichten
// echte Blockchain-Transaktionen aus. Läuft als eigenständiges Programm,
// getrennt von der Next.js-Website (npm run dev) - beide laufen parallel.
//
// Befehle im Chat:
//   !link CODE   -> verknüpft den Blaze-Account des Schreibers mit der
//                   Wallet, die diesen Code auf der Website erzeugt hat.
//   !feed        -> erhöht das Level des Eis der schreibenden Person um 1
//                   (nur wenn ihr Blaze-Account schon verknüpft ist).
//
// Start:  npm run bot   (in einem eigenen Terminal-Fenster, während
//         "npm run dev" in einem anderen Fenster weiterläuft)

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// WICHTIG: .env.local muss geladen sein, BEVOR wir die anderen Module laden,
// weil die (z.B. der thirdweb-Client) beim Import direkt process.env lesen.
// Deshalb hier bewusst dynamische imports statt normaler import-Statements.
dotenv.config({ path: path.join(__dirname, "..", ".env.local") });

const {
  NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
  BLAZE_CLIENT_ID,
  BLAZE_CLIENT_SECRET,
  BLAZE_CHANNEL_ID,
  SERVER_WALLET_PRIVATE_KEY,
} = process.env;

for (const [name, value] of Object.entries({
  NEXT_PUBLIC_THIRDWEB_CLIENT_ID,
  BLAZE_CLIENT_ID,
  BLAZE_CLIENT_SECRET,
  BLAZE_CHANNEL_ID,
  SERVER_WALLET_PRIVATE_KEY,
})) {
  if (!value) {
    console.error(`❌ Fehlt in .env.local: ${name}`);
    process.exit(1);
  }
}

const { io } = await import("socket.io-client");
const {
  getContractEvents,
  prepareContractCall,
  prepareEvent,
  readContract,
  sendTransaction,
  waitForReceipt,
} = await import("thirdweb");
const { avalancheFuji } = await import("thirdweb/chains");
const { privateKeyToAccount } = await import("thirdweb/wallets");
const { eggContract, EGG_DEPLOY_BLOCK } = await import("./contract.mjs");
const { thirdwebClient } = await import("./client.mjs");
const { redeemLinkCode, getLinkedWallet } = await import("../lib/linkStore.mjs");
const { getValidUserAccessToken, hasStoredTokens } = await import("../lib/blazeOAuth.mjs");
const { recordFeed } = await import("../lib/feedActivity.mjs");
const { getCachedToken, setCachedToken, bumpCachedLevel } = await import("../lib/tokenCache.mjs");
const { appendLiveEvent } = await import("../lib/liveEvents.mjs");

const serverAccount = privateKeyToAccount({
  client: thirdwebClient,
  privateKey: SERVER_WALLET_PRIVATE_KEY,
});

console.log("🥚 Füttern-Bot startet...");
console.log("   Server-Wallet:", serverAccount.address);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Wiederholt eine (Netzwerk-)Aktion bei kurzen Aussetzern automatisch, statt
// die ganze Fütterung wegen eines einzelnen "fetch failed" abzubrechen.
async function withRetry(fn, { attempts = 3, delayMs = 1500, label = "" } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      console.warn(
        `   ⚠ ${label} fehlgeschlagen (Versuch ${attempt}/${attempts}): ${error.message || error}`
      );
      if (attempt < attempts) await sleep(delayMs);
    }
  }
  throw lastError;
}

// Wird in main() gesetzt, sobald wir einen App-Token von Blaze haben -
// feedWallet()/handleChatMessage() brauchen ihn, um im Chat zu antworten.
let appToken;

// --- Blaze: App Access Token holen (gilt laut Blaze ca. 7 Tage) ---
async function getBlazeAppToken() {
  const res = await fetch("https://blaze.stream/bapi/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: BLAZE_CLIENT_ID,
      clientSecret: BLAZE_CLIENT_SECRET,
      grantType: "client_credentials",
    }),
  });
  if (!res.ok) {
    throw new Error(`Blaze-Token-Anfrage fehlgeschlagen: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.accessToken;
}

// --- Eine Bestätigung als Chat-Nachricht zurückschicken ---
// Braucht einen ECHTEN Blaze-Nutzer-Token (channel.moderate-Scope) - der
// App-Token allein reicht zum Senden nicht aus (nur zum Mitlesen).
async function sendChatMessage(message) {
  try {
    const userToken = await getValidUserAccessToken(BLAZE_CLIENT_ID, BLAZE_CLIENT_SECRET);
    if (!userToken) {
      console.log(
        "   ℹ Chat-Bestätigung übersprungen: Blaze-Chat noch nicht verknüpft. Öffne http://localhost:3000/api/blaze-oauth/start und stimme einmalig zu."
      );
      return;
    }

    await withRetry(
      async () => {
        const res = await fetch("https://api.blaze.stream/v1/chats/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${userToken}`,
            "client-id": BLAZE_CLIENT_ID,
          },
          body: JSON.stringify({ channelId: BLAZE_CHANNEL_ID, message }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} - ${await res.text()}`);
        }
      },
      { label: "Chat-Nachricht senden", attempts: 3, delayMs: 1000 }
    );
  } catch (error) {
    console.error("   ⚠ Chat-Nachricht konnte nicht gesendet werden:", error.message || error);
  }
}

// --- Token-ID + aktuelles Level einer Wallet einmalig von der Chain holen ---
// (nur nötig, wenn wir sie noch nicht im lokalen Cache haben)
async function lookupTokenFromChain(walletAddress) {
  const transferToWallet = prepareEvent({
    signature:
      "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
    filters: { to: walletAddress },
  });

  const events = await getContractEvents({
    contract: eggContract,
    events: [transferToWallet],
    fromBlock: EGG_DEPLOY_BLOCK,
  });

  const lastTransfer = events[events.length - 1];
  if (!lastTransfer) return null;

  const tokenId = lastTransfer.args.tokenId;
  const level = await readContract({
    contract: eggContract,
    method: "function levelOf(uint256) view returns (uint256)",
    params: [tokenId],
  });

  return { tokenId, level: Number(level) };
}

// --- Ein Ei anhand der Wallet-Adresse finden und füttern ---
// Gibt bei Erfolg { tokenId, predictedLevel, confirmedLevel, tierChanged } zurück.
//
// onPredicted(...) wird SOFORT aufgerufen, sobald wir wissen, welches Level
// das Ei gleich haben wird - eine reine lokale Vorhersage (letzter bekannter
// Stand + 1), NICHT durch Nachschauen auf der Chain. So kann der Aufrufer
// (die Chat-Bestätigung) sofort reagieren, ohne auf die Blockchain zu warten.
// Die eigentliche Bestätigung/Korrektur passiert erst danach, im Rückgabewert.
async function feedWallet(walletAddress, { onPredicted } = {}) {
  let cached = getCachedToken(walletAddress);

  if (!cached) {
    // Erstes Füttern dieser Wallet seit es den Cache gibt: einmalig auf der
    // Chain nachschauen. Ab jetzt merken wir uns Token-ID + Level lokal und
    // müssen nie wieder danach suchen - das spart die zwei langsamsten
    // Schritte bei jeder weiteren Fütterung UND macht die Vorhersage möglich.
    const found = await lookupTokenFromChain(walletAddress);
    if (!found) {
      console.log(`   ⚠ Keine Token-ID für Wallet ${walletAddress} gefunden - übersprungen.`);
      return null;
    }
    cached = found;
    setCachedToken(walletAddress, cached.tokenId, cached.level);
  }

  const previousLevel = cached.level;
  const predictedLevel = previousLevel + 1;

  // Vorhersage sofort raus - noch bevor die Transaktion überhaupt gesendet wird.
  onPredicted?.({ tokenId: cached.tokenId, predictedLevel });

  const transaction = prepareContractCall({
    contract: eggContract,
    method: "function feed(uint256 tokenId)",
    params: [cached.tokenId],
  });

  // sendTransaction: wenn das schon fehlschlägt, ist noch nichts auf der
  // Chain passiert - ein Wiederholungsversuch ist hier gefahrlos.
  const result = await withRetry(() => sendTransaction({ transaction, account: serverAccount }), {
    label: "Transaktion senden",
  });

  // waitForReceipt: die Transaktion wurde bereits verschickt, hier NUR auf
  // die Bestätigung erneut warten (nicht nochmal senden!), falls die
  // Netzwerkverbindung beim Abfragen kurz aussetzt.
  await withRetry(
    () =>
      waitForReceipt({
        client: thirdwebClient,
        chain: avalancheFuji,
        transactionHash: result.transactionHash,
      }),
    { label: "Auf Bestätigung warten", attempts: 4, delayMs: 2000 }
  );
  console.log(`   ✅ Ei #${cached.tokenId} gefüttert. Tx: ${result.transactionHash}`);

  // Level lokal hochzählen statt nochmal von der Chain zu lesen - wir sind
  // die Einzigen, die feed() aufrufen dürfen, kennen den neuen Stand also
  // sicher. Im Normalfall ist das exakt die Vorhersage von oben.
  const confirmedLevel = bumpCachedLevel(walletAddress);
  const tierChanged = spriteTier(previousLevel) !== spriteTier(confirmedLevel);

  return { tokenId: cached.tokenId, predictedLevel, confirmedLevel, tierChanged };
}

// Muss zu app/overlay/page.js's spriteForLevel()-Stufen passen (🥚 -> 🐣 -> 🐥).
function spriteTier(level) {
  if (level >= 3) return 2;
  if (level >= 1) return 1;
  return 0;
}

async function handleChatMessage(payload) {
  const text = (payload.message || "").trim();
  const sender = payload.sender;

  if (/^!link\s+\S+/i.test(text)) {
    const code = text.replace(/^!link\s+/i, "");
    const wallet = redeemLinkCode(code, sender);
    if (wallet) {
      console.log(`🔗 ${sender.username} hat sich mit Wallet ${wallet} verknüpft.`);
      await sendChatMessage(`🔗 @${sender.username} your Blaze account is now linked to your egg!`);
    } else {
      console.log(`   ⚠ Ungültiger/abgelaufener Link-Code von ${sender.username}: "${code}"`);
    }
    return;
  }

  if (/^!feed$/i.test(text)) {
    const wallet = getLinkedWallet(sender.id);
    if (!wallet) {
      console.log(
        `   ⚠ ${sender.username} hat "!feed" geschrieben, ist aber noch nicht verknüpft (fehlt "!link CODE").`
      );
      return;
    }
    console.log(`🍗 ${sender.username} füttert sein Ei (Wallet ${wallet})...`);

    // Wird direkt bei feedWallet() aufgerufen, sobald die Vorhersage feststeht
    // (bevor die Transaktion überhaupt gesendet wird): sofortige Overlay-
    // Reaktion + sofortige Chat-Bestätigung mit dem vorhergesagten Level.
    // Bewusst NICHT awaited (sendChatMessage läuft im Hintergrund weiter) -
    // sonst würde das Warten auf die Chat-API die Vorhersage wieder verzögern.
    const handlePrediction = ({ tokenId, predictedLevel }) => {
      appendLiveEvent({ type: "feed-attempt", tokenId, walletAddress: wallet });
      sendChatMessage(`🥚 ${sender.username}'s egg is now Level ${predictedLevel}!`);
    };

    try {
      const fed = await feedWallet(wallet, { onPredicted: handlePrediction });
      if (fed) {
        recordFeed(fed.tokenId, wallet, fed.confirmedLevel);

        // Normalfall: Vorhersage stimmte - keine weitere Nachricht nötig.
        // Nur bei einer (seltenen) Abweichung wird im Chat korrigiert.
        if (fed.confirmedLevel !== fed.predictedLevel) {
          await sendChatMessage(
            `↩️ Correction: ${sender.username}'s egg is actually Level ${fed.confirmedLevel}.`
          );
        }

        if (fed.tierChanged) {
          appendLiveEvent({
            type: "level-up",
            tokenId: fed.tokenId,
            walletAddress: wallet,
            newLevel: fed.confirmedLevel,
          });
        }
      }
    } catch (error) {
      console.error(`   ❌ Füttern fehlgeschlagen:`, error.message || error);
      // Wir haben schon eine (jetzt falsche) Vorhersage in den Chat geschickt -
      // das muss richtiggestellt werden, sonst wirkt es als wäre gefüttert worden.
      await sendChatMessage(
        `⚠️ Sorry ${sender.username}, feeding your egg failed. Please try "!feed" again.`
      );
    }
  }
}

// --- Verbindung zu Blaze aufbauen ---
async function main() {
  appToken = await getBlazeAppToken();
  console.log("✅ Blaze App-Token erhalten.");

  const socket = io("https://blaze.stream", { path: "/ws" });

  socket.on("connect", () => {
    console.log("✅ Mit Blaze verbunden, warte auf Session...");
  });

  socket.on("disconnect", () => {
    console.log("⚠ Verbindung zu Blaze getrennt - versuche automatisch erneut...");
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Verbindungsfehler:", err.message);
  });

  socket.on("eventsub", async (msg) => {
    const messageType = msg?.metadata?.messageType;
    const subscriptionType = msg?.metadata?.subscriptionType;

    if (messageType === "session_welcome") {
      const sessionId = msg.payload?.sessionId ?? msg.sessionId;
      console.log("✅ Session erhalten, abonniere Chat-Nachrichten...");

      const subRes = await fetch("https://api.blaze.stream/v1/events/subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${appToken}`,
          "Client-Id": BLAZE_CLIENT_ID,
        },
        body: JSON.stringify({
          type: "channel.chat.message",
          version: "1",
          sessionId,
          condition: { channelId: BLAZE_CHANNEL_ID },
        }),
      });

      if (!subRes.ok) {
        console.error(
          `❌ Chat-Abo fehlgeschlagen: HTTP ${subRes.status} - ${await subRes.text()}`
        );
        return;
      }
      console.log("🎧 Chat wird jetzt live mitgelesen. Warte auf Nachrichten...");
      return;
    }

    if (subscriptionType === "channel.chat.message") {
      handleChatMessage(msg.payload).catch((err) =>
        console.error("❌ Fehler beim Verarbeiten der Chat-Nachricht:", err)
      );
    }
  });
}

main().catch((error) => {
  console.error("❌ Füttern-Bot konnte nicht starten:", error);
  process.exit(1);
});
