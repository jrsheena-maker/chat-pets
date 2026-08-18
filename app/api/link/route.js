import { NextResponse } from "next/server";
import { createLinkCode } from "../../../lib/linkStore.mjs";

// POST /api/link  { walletAddress }  ->  { code, expiresInMs }
// Erzeugt einen kurzen Code, den man im Blaze-Chat mit "!link CODE" eintippt,
// um den Chat-Account mit der eigenen Wallet zu verknüpfen.
export async function POST(request) {
  const body = await request.json().catch(() => null);
  const walletAddress = body?.walletAddress;

  if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
    return NextResponse.json({ error: "Ungültige Wallet-Adresse" }, { status: 400 });
  }

  const { code, expiresInMs } = createLinkCode(walletAddress);
  return NextResponse.json({ code, expiresInMs });
}
