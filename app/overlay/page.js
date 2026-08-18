"use client";

import { useEffect, useRef, useState } from "react";

// Wie oft wir bei der App nachfragen, wer kürzlich gefüttert wurde.
const POLL_INTERVAL_MS = 5000;
// Wie oft jede Kreatur ein neues Zufallsziel bekommt - bewusst langsam/ruhig,
// damit es nicht vom eigentlichen Streaminhalt ablenkt.
const MOVE_INTERVAL_MS = 8000;

// Unsichtbare Wände: eine Kreatur darf diesen Bereich nie verlassen (in %,
// mit Sicherheitsabstand zum echten Bildschirmrand, damit sie nie abgeschnitten wirkt).
const SAFE_X_MIN = 4;
const SAFE_X_MAX = 96;
const SAFE_Y_MIN = 6;
const SAFE_Y_MAX = 97;

// Kreaturen laufen hauptsächlich in diesem Boden-Streifen (in % von oben) -
// ganz unten am Bildschirmrand, nicht in der Bildschirmmitte.
const GROUND_Y_MIN = 88;
const GROUND_Y_MAX = 96;
// Randbereiche, in denen "geklettert" werden darf.
const EDGE_LEFT_BAND = [SAFE_X_MIN, 14];
const EDGE_RIGHT_BAND = [86, SAFE_X_MAX];
// Wie hoch eine Kreatur beim Klettern maximal hochkommt.
const CLIMB_Y_MIN = SAFE_Y_MIN;
// Wie viele Runden eine Kreatur am Rand hochklettert, bevor sie zurück zum Boden geht.
const MIN_CLIMB_TICKS = 2;
const MAX_CLIMB_TICKS = 4;
// Wahrscheinlichkeit pro Runde, dass eine laufende Kreatur anfängt zu klettern -
// bewusst niedrig, damit Kreaturen fast immer am Boden bleiben.
const CLIMB_CHANCE = 0.04;

// Wie lange die sofortige "!feed wurde erkannt"-Reaktion sichtbar bleibt.
const FEED_REACTION_MS = 1200;
// Wie lange der auffälligere Level-Up-Effekt sichtbar bleibt.
const LEVEL_UP_REACTION_MS = 2200;

function spriteForLevel(level) {
  if (level >= 3) return "🐥";
  if (level >= 1) return "🐣";
  return "🥚";
}

function randomPercent(min, max) {
  return Math.random() * (max - min) + min;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Zusätzliche Sicherheitsnetz-Klammer: egal was oben berechnet wird, die
// Kreatur landet nie außerhalb des sichtbaren Bereichs.
function clampToScreen(state) {
  return {
    ...state,
    x: clamp(state.x, SAFE_X_MIN, SAFE_X_MAX),
    y: clamp(state.y, SAFE_Y_MIN, SAFE_Y_MAX),
  };
}

function initialCreatureState() {
  return clampToScreen({
    x: randomPercent(10, 90),
    y: randomPercent(GROUND_Y_MIN, GROUND_Y_MAX),
    mode: "ground",
    ticksInMode: 0,
  });
}

// Berechnet den nächsten Schritt für eine Kreatur: fast immer gemütlich am
// Boden entlanglaufen, nur selten an einem Rand hoch- und wieder runterklettern.
function nextCreatureState(state) {
  const ticksInMode = state.ticksInMode + 1;

  if (state.mode === "climbing") {
    const climbDuration = state.climbDuration ?? MIN_CLIMB_TICKS;
    const onLeftEdge = state.x <= (EDGE_LEFT_BAND[1] + EDGE_RIGHT_BAND[0]) / 2;

    if (ticksInMode >= climbDuration) {
      // Fertig geklettert - zurück zum Boden, in der Nähe des Randes.
      const x = onLeftEdge ? randomPercent(12, 24) : randomPercent(76, 88);
      return clampToScreen({
        x,
        y: randomPercent(GROUND_Y_MIN, GROUND_Y_MAX),
        mode: "ground",
        ticksInMode: 0,
      });
    }
    // Weiter am Rand hoch/runter bewegen.
    const edgeX = onLeftEdge
      ? randomPercent(EDGE_LEFT_BAND[0], EDGE_LEFT_BAND[1])
      : randomPercent(EDGE_RIGHT_BAND[0], EDGE_RIGHT_BAND[1]);
    return clampToScreen({
      x: edgeX,
      y: randomPercent(CLIMB_Y_MIN, GROUND_Y_MIN),
      mode: "climbing",
      ticksInMode,
      climbDuration,
    });
  }

  // mode === "ground"
  if (Math.random() < CLIMB_CHANCE) {
    const goLeft = state.x < 50;
    const x = goLeft
      ? randomPercent(EDGE_LEFT_BAND[0], EDGE_LEFT_BAND[1])
      : randomPercent(EDGE_RIGHT_BAND[0], EDGE_RIGHT_BAND[1]);
    const climbDuration = Math.round(randomPercent(MIN_CLIMB_TICKS, MAX_CLIMB_TICKS));
    return clampToScreen({
      x,
      y: randomPercent(CLIMB_Y_MIN, GROUND_Y_MIN),
      mode: "climbing",
      ticksInMode: 0,
      climbDuration,
    });
  }

  // Gemütlich ein Stück am Boden weiterlaufen (kein Sprung quer über den Screen).
  const x = state.x + randomPercent(-14, 14);
  return clampToScreen({
    x,
    y: randomPercent(GROUND_Y_MIN, GROUND_Y_MAX),
    mode: "ground",
    ticksInMode: 0,
  });
}

export default function Overlay() {
  const [creatures, setCreatures] = useState([]);
  // tokenId -> { x, y } in Prozent, für die Positions-Animation.
  const [positions, setPositions] = useState({});
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

  // tokenId -> { type: "feed" | "levelup", key } - steuert die kurzen
  // Reaktions-Effekte. "key" sorgt dafür, dass die Animation auch neu
  // startet, wenn kurz hintereinander zweimal gefüttert wird.
  const [reactions, setReactions] = useState({});
  // tokenId -> optimistisch schon "vorgezogenes" Level nach einem Level-Up-
  // Ereignis, bis der nächste normale Poll den echten Wert bestätigt.
  const [optimisticLevels, setOptimisticLevels] = useState({});

  // Seite transparent machen - diese Seite ist nur für OBS gedacht, nicht
  // für normale Besucher:innen, deshalb überschreiben wir hier gezielt den
  // sonst dunklen Hintergrund aus globals.css. Wichtig: globals.css setzt
  // den Hintergrund auf HTML *und* BODY - beide müssen überschrieben werden,
  // sonst schimmert der dunkle html-Hintergrund weiterhin als "schwarze Box" durch.
  useEffect(() => {
    const prevBodyBg = document.body.style.background;
    const prevHtmlBg = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    return () => {
      document.body.style.background = prevBodyBg;
      document.documentElement.style.background = prevHtmlBg;
    };
  }, []);

  // Regelmäßig nachfragen, wer kürzlich gefüttert wurde.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch("/api/overlay", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setCreatures(data.creatures || []);
      } catch (error) {
        console.error("Overlay-Abfrage fehlgeschlagen:", error);
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Live-Kanal für sofortige Reaktionen (deutlich schneller als der normale
  // 5-Sekunden-Poll oben) - der Bot meldet hier "!feed erkannt" schon,
  // bevor die Blockchain-Bestätigung überhaupt da ist.
  useEffect(() => {
    const source = new EventSource("/api/overlay/events");

    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        return;
      }
      const { type, tokenId } = payload;
      if (!tokenId || (type !== "feed-attempt" && type !== "level-up")) return;

      const reactionType = type === "level-up" ? "levelup" : "feed";
      const duration = type === "level-up" ? LEVEL_UP_REACTION_MS : FEED_REACTION_MS;

      setReactions((prev) => ({
        ...prev,
        [tokenId]: { type: reactionType, key: Date.now() },
      }));
      setTimeout(() => {
        setReactions((prev) => {
          if (prev[tokenId]?.type !== reactionType) return prev;
          const next = { ...prev };
          delete next[tokenId];
          return next;
        });
      }, duration);

      if (type === "level-up" && typeof payload.newLevel === "number") {
        setOptimisticLevels((prev) => ({ ...prev, [tokenId]: payload.newLevel }));
      }
    };

    source.onerror = () => {
      // EventSource verbindet sich bei Verbindungsabbrüchen von selbst neu,
      // hier reicht ein stilles Loggen.
      console.warn("Overlay-Live-Verbindung unterbrochen, versuche erneut...");
    };

    return () => source.close();
  }, []);

  // Neuen Kreaturen eine Startposition am Boden geben, verschwundene aufräumen.
  useEffect(() => {
    setPositions((prev) => {
      const next = { ...prev };
      const currentIds = new Set(creatures.map((c) => c.tokenId));

      for (const creature of creatures) {
        if (!next[creature.tokenId]) {
          next[creature.tokenId] = initialCreatureState();
        }
      }
      for (const id of Object.keys(next)) {
        if (!currentIds.has(id)) delete next[id];
      }
      return next;
    });
  }, [creatures]);

  // Alle paar Sekunden jeder Kreatur einen neuen, kleinen Schritt geben - der
  // CSS-Übergang (siehe unten) sorgt für die sanfte, gemütliche Bewegung dorthin.
  useEffect(() => {
    const interval = setInterval(() => {
      setPositions((prev) => {
        const next = {};
        for (const [id, state] of Object.entries(prev)) {
          next[id] = nextCreatureState(state);
        }
        return next;
      });
    }, MOVE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        background: "transparent",
      }}
    >
      <style>{`
        @keyframes egg-hop {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-14px); }
        }
        @keyframes egg-hop-excited {
          0%, 100% { transform: translateY(0) scale(1); }
          50% { transform: translateY(-22px) scale(1.15); }
        }
        @keyframes reaction-glow {
          0%, 100% { filter: drop-shadow(0 4px 4px rgba(0,0,0,0.4)) drop-shadow(0 0 0px #ffd94a); }
          50% { filter: drop-shadow(0 4px 4px rgba(0,0,0,0.4)) drop-shadow(0 0 18px #ffd94a); }
        }
        @keyframes sparkle-pop {
          0% { transform: translate(-50%, -50%) scale(0); opacity: 0; }
          25% { transform: translate(-50%, -150%) scale(1.1); opacity: 1; }
          100% { transform: translate(-50%, -260%) scale(0.7); opacity: 0; }
        }
        @keyframes level-up-badge {
          0% { transform: translate(-50%, 0) scale(0.5); opacity: 0; }
          20% { transform: translate(-50%, -12px) scale(1.15); opacity: 1; }
          80% { transform: translate(-50%, -12px) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -28px) scale(1); opacity: 0; }
        }
      `}</style>

      {creatures.map((creature) => {
        const pos = positions[creature.tokenId];
        if (!pos) return null;

        const reaction = reactions[creature.tokenId];
        const isReacting = Boolean(reaction);
        const isLevelUp = reaction?.type === "levelup";
        const effectiveLevel = Math.max(creature.level, optimisticLevels[creature.tokenId] ?? 0);

        return (
          <div
            key={creature.tokenId}
            style={{
              position: "absolute",
              left: `${pos.x}%`,
              top: `${pos.y}%`,
              // (x, y) ist die Mitte der Kreatur, nicht die Ecke - so bleibt
              // immer ein Sicherheitsabstand zum Bildschirmrand erhalten.
              transform: "translate(-50%, -50%)",
              transition: `left ${MOVE_INTERVAL_MS}ms ease-in-out, top ${MOVE_INTERVAL_MS}ms ease-in-out`,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "2px",
            }}
          >
            {/* Sofortige Reaktion (!feed erkannt) und Level-Up: ein paar
                Funken, die kurz nach oben wegploppen. Bei Level-Up mehr davon. */}
            {isReacting && (
              <div style={{ position: "absolute", left: "50%", top: "40%", pointerEvents: "none" }}>
                {Array.from({ length: isLevelUp ? 6 : 3 }).map((_, i) => (
                  <span
                    key={`${reaction.key}-${i}`}
                    style={{
                      position: "absolute",
                      left: `${(i - (isLevelUp ? 2.5 : 1)) * 16}px`,
                      top: 0,
                      fontSize: isLevelUp ? "20px" : "14px",
                      animation: `sparkle-pop ${isLevelUp ? LEVEL_UP_REACTION_MS : FEED_REACTION_MS}ms ease-out forwards`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  >
                    ✨
                  </span>
                ))}
              </div>
            )}

            {isLevelUp && (
              <span
                style={{
                  position: "absolute",
                  left: "50%",
                  top: "-8px",
                  fontSize: "13px",
                  fontWeight: 800,
                  color: "#ffd94a",
                  textShadow: "0 2px 4px rgba(0,0,0,0.6)",
                  whiteSpace: "nowrap",
                  animation: `level-up-badge ${LEVEL_UP_REACTION_MS}ms ease-out forwards`,
                }}
              >
                LEVEL UP!
              </span>
            )}

            <span
              style={{
                fontSize: "48px",
                lineHeight: 1,
                display: "inline-block",
                animation: isReacting
                  ? `egg-hop-excited 0.35s ease-in-out infinite, reaction-glow 0.6s ease-in-out infinite`
                  : "egg-hop 0.6s ease-in-out infinite",
                filter: "drop-shadow(0 4px 4px rgba(0,0,0,0.4))",
              }}
            >
              {spriteForLevel(effectiveLevel)}
            </span>
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#fff",
                background: "rgba(0,0,0,0.5)",
                padding: "1px 6px",
                borderRadius: "999px",
              }}
            >
              Lvl {effectiveLevel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
