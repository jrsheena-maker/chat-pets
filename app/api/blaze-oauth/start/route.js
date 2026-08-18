import { NextResponse } from "next/server";
import { generateAuthUrl } from "../../../../lib/blazeOAuth.mjs";

// GET /api/blaze-oauth/start -> leitet direkt zu Blazes Zustimmungsseite weiter.
export async function GET() {
  try {
    const url = await generateAuthUrl(
      process.env.BLAZE_CLIENT_ID,
      process.env.BLAZE_CLIENT_SECRET
    );
    return NextResponse.redirect(url);
  } catch (error) {
    return new NextResponse(`Fehler beim Starten der Blaze-Verknüpfung: ${error.message}`, {
      status: 500,
    });
  }
}
