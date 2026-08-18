import { NextResponse } from "next/server";
import { getRecentlyFed } from "../../../lib/feedActivity.mjs";

// Nur Kreaturen zeigen, die in den letzten 3 Stunden gefüttert wurden -
// sonst würde das Overlay über die Zeit hinweg immer voller werden.
const RECENT_WINDOW_MS = 3 * 60 * 60 * 1000;

export async function GET() {
  const creatures = getRecentlyFed(RECENT_WINDOW_MS);
  return NextResponse.json({ creatures });
}
