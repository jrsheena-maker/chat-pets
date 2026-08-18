import { NextResponse } from "next/server";
import { exchangeCode } from "../../../../lib/blazeOAuth.mjs";

// GET /api/blaze-oauth/callback?code=...&state=...
// Hierher leitet Blaze nach deiner Zustimmung zurück. Tauscht den Code gegen
// echte Tokens ein und speichert sie lokal - danach darf der Bot Chat-Nachrichten senden.
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return htmlResponse(`❌ Blaze hat die Anfrage abgelehnt: ${error}`);
  }
  if (!code || !state) {
    return htmlResponse("❌ Es fehlen code/state in der Antwort von Blaze.");
  }

  try {
    await exchangeCode(process.env.BLAZE_CLIENT_ID, process.env.BLAZE_CLIENT_SECRET, code, state);
    return htmlResponse("✅ Blaze-Chat ist jetzt verknüpft! Du kannst dieses Fenster schließen.");
  } catch (err) {
    return htmlResponse(`❌ Verknüpfung fehlgeschlagen: ${err.message}`);
  }
}

function htmlResponse(text) {
  return new NextResponse(
    `<!doctype html><html><body style="font-family:sans-serif;background:#0b1410;color:#efeae0;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:24px;"><p style="font-size:18px;max-width:400px;">${text}</p></body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}
