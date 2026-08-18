import { getEventsSince } from "../../../../lib/liveEvents.mjs";

// Server-Sent-Events-Kanal: hält die Verbindung offen und schickt neue
// Live-Ereignisse (feed-attempt, level-up), sobald der Bot-Dienst sie
// meldet - alle ~300ms nachgeschaut, damit es sich "sofort" anfühlt.
const POLL_MS = 300;
const KEEPALIVE_MS = 15000;

export async function GET() {
  const encoder = new TextEncoder();
  let pollTimer;
  let keepAliveTimer;

  const stream = new ReadableStream({
    start(controller) {
      let lastTs = Date.now();
      let closed = false;

      const safeEnqueue = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // Verbindung ist schon zu (Tab geschlossen o.ä.) - einfach stoppen.
          closed = true;
          clearInterval(pollTimer);
          clearInterval(keepAliveTimer);
        }
      };

      pollTimer = setInterval(() => {
        const events = getEventsSince(lastTs);
        for (const event of events) {
          safeEnqueue(`data: ${JSON.stringify(event)}\n\n`);
          lastTs = Math.max(lastTs, event.ts);
        }
      }, POLL_MS);

      // Kommentarzeilen (kein "data:") halten manche Proxys/Browser wach,
      // ohne dass das Overlay sie als echtes Ereignis interpretiert.
      keepAliveTimer = setInterval(() => {
        safeEnqueue(`: keep-alive\n\n`);
      }, KEEPALIVE_MS);
    },
    cancel() {
      clearInterval(pollTimer);
      clearInterval(keepAliveTimer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
