"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ─── Types ──────────────────────────────────────────────────────── */

type RemoteButton = {
  id: string;
  label: string;
  keys: string[];          // event.key values that trigger this button
  codes?: string[];        // event.code values (fallback match)
  appAction: string;       // what this does in the player
  row: number;
  col: number;
  colSpan?: number;
  color?: string;          // tailwind ring/bg accent
};

type KeyEvent = {
  id: number;
  key: string;
  code: string;
  keyCode: number;
  matched: string | null;  // button id if matched
  ts: number;
};

/* ─── Button map ─────────────────────────────────────────────────── */

const BUTTONS: RemoteButton[] = [
  // Row 0 — Power
  { id: "power",     label: "POWER",   keys: ["Power"],                       codes: ["Power"],             appAction: "—",                  row: 0, col: 1, color: "red" },

  // Row 1 — Number pad row 1
  { id: "1", label: "1", keys: ["1"], appAction: "Channel digit", row: 1, col: 0 },
  { id: "2", label: "2", keys: ["2"], appAction: "Channel digit", row: 1, col: 1 },
  { id: "3", label: "3", keys: ["3"], appAction: "Channel digit", row: 1, col: 2 },

  // Row 2 — Number pad row 2
  { id: "4", label: "4", keys: ["4"], appAction: "Channel digit", row: 2, col: 0 },
  { id: "5", label: "5", keys: ["5"], appAction: "Channel digit", row: 2, col: 1 },
  { id: "6", label: "6", keys: ["6"], appAction: "Channel digit", row: 2, col: 2 },

  // Row 3 — Number pad row 3
  { id: "7", label: "7", keys: ["7"], appAction: "Channel digit", row: 3, col: 0 },
  { id: "8", label: "8", keys: ["8"], appAction: "Channel digit", row: 3, col: 1 },
  { id: "9", label: "9", keys: ["9"], appAction: "Channel digit", row: 3, col: 2 },

  // Row 4 — 0 center
  { id: "0", label: "0", keys: ["0"], appAction: "Channel digit", row: 4, col: 1 },

  // Row 5 — D-pad: Up
  { id: "up",   label: "▲",  keys: ["ArrowUp"],    appAction: "Channel Up",   row: 5, col: 1 },

  // Row 6 — D-pad: Left / OK / Right
  { id: "left",  label: "◄",  keys: ["ArrowLeft"],  appAction: "Volume Down",  row: 6, col: 0 },
  { id: "ok",    label: "OK", keys: ["Enter"],       appAction: "Select / Confirm", row: 6, col: 1, color: "emerald" },
  { id: "right", label: "►",  keys: ["ArrowRight"],  appAction: "Volume Up",    row: 6, col: 2 },

  // Row 7 — D-pad: Down
  { id: "down", label: "▼", keys: ["ArrowDown"], appAction: "Channel Down", row: 7, col: 1 },

  // Row 8 — Vol / Mute / Ch
  { id: "vol-up",   label: "VOL +",  keys: ["AudioVolumeUp"],   codes: ["AudioVolumeUp"],   appAction: "Volume Up (media key)",   row: 8, col: 0 },
  { id: "mute",     label: "MUTE",   keys: ["AudioVolumeMute", "m"], codes: ["AudioVolumeMute"], appAction: "Toggle Mute",       row: 8, col: 1, color: "amber" },
  { id: "vol-down", label: "VOL −",  keys: ["AudioVolumeDown"], codes: ["AudioVolumeDown"], appAction: "Volume Down (media key)", row: 8, col: 2 },

  // Row 9 — Playback controls
  { id: "play",  label: "▶ ❚❚", keys: ["MediaPlayPause", " "],  codes: ["MediaPlayPause", "Space"], appAction: "Play / Pause",     row: 9, col: 1, color: "sky" },
  { id: "back",  label: "BACK",  keys: ["Backspace", "BrowserBack"],                                 appAction: "Back / Close Modal", row: 9, col: 0 },
  { id: "menu",  label: "MENU",  keys: ["ContextMenu", "F10"],                                       appAction: "Menu / Info",        row: 9, col: 2 },

  // Row 10 — Color / function keys
  { id: "red",    label: "RED",    keys: ["F1"], appAction: "Function 1", row: 10, col: 0, color: "red" },
  { id: "green",  label: "GREEN",  keys: ["F2"], appAction: "Function 2", row: 10, col: 1, color: "emerald" },
  { id: "blue",   label: "BLUE",   keys: ["F4"], appAction: "Function 3", row: 10, col: 2, color: "sky" },

  // Row 11 — Extra keys (common on remotes)
  { id: "info",       label: "INFO",      keys: ["i"],       appAction: "Toggle Info Modal",   row: 11, col: 0 },
  { id: "fullscreen", label: "FULL",      keys: ["f"],       appAction: "Toggle Fullscreen",   row: 11, col: 1 },
  { id: "escape",     label: "ESC",       keys: ["Escape"],  appAction: "Close Overlays",      row: 11, col: 2 },
];

const MAX_ROWS = 12;

/* Color accent map */
const ACCENT: Record<string, { ring: string; bg: string; text: string }> = {
  red:     { ring: "ring-red-400",     bg: "bg-red-500/20",     text: "text-red-300" },
  emerald: { ring: "ring-emerald-400", bg: "bg-emerald-500/20", text: "text-emerald-300" },
  amber:   { ring: "ring-amber-400",   bg: "bg-amber-500/20",   text: "text-amber-300" },
  sky:     { ring: "ring-sky-400",     bg: "bg-sky-500/20",     text: "text-sky-300" },
};

const DEFAULT_ACCENT = { ring: "ring-white/30", bg: "bg-white/5", text: "text-neutral-200" };

/* ─── Component ──────────────────────────────────────────────────── */

export default function RemoteTesterPage() {
  const [events, setEvents] = useState<KeyEvent[]>([]);
  const [activeBtn, setActiveBtn] = useState<string | null>(null);
  const activeTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idCounter = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);

  const matchButton = useCallback((e: KeyboardEvent): string | null => {
    for (const btn of BUTTONS) {
      if (btn.keys.includes(e.key)) return btn.id;
      if (btn.codes?.includes(e.code)) return btn.id;
    }
    return null;
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const matched = matchButton(e);

      const evt: KeyEvent = {
        id: ++idCounter.current,
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        matched,
        ts: Date.now(),
      };

      setEvents((prev) => [evt, ...prev].slice(0, 50));

      if (matched) {
        setActiveBtn(matched);
        if (activeTimeout.current) clearTimeout(activeTimeout.current);
        activeTimeout.current = setTimeout(() => setActiveBtn(null), 300);
      }
    };

    window.addEventListener("keydown", handler, { capture: true });
    return () => window.removeEventListener("keydown", handler, { capture: true });
  }, [matchButton]);

  /* Auto-scroll log */
  useEffect(() => {
    logRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [events]);

  /* Group buttons by row */
  const rows: RemoteButton[][] = [];
  for (let r = 0; r < MAX_ROWS; r++) {
    rows.push(BUTTONS.filter((b) => b.row === r));
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-neutral-50">Remote Tester</h1>
        <p className="text-sm text-neutral-400">
          Press buttons on your USB remote to see which key events your browser receives.
          Matched buttons light up on the virtual remote below.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Virtual Remote ──────────────────────────────── */}
        <div className="flex flex-col items-center">
          <div className="w-full max-w-xs rounded-2xl border border-white/10 bg-neutral-900/70 p-6 shadow-xl">
            <div className="flex flex-col gap-2">
              {rows.map((row, ri) => {
                if (row.length === 0) return null;
                return (
                  <div key={ri} className="grid grid-cols-3 gap-2">
                    {[0, 1, 2].map((col) => {
                      const btn = row.find((b) => b.col === col);
                      if (!btn) return <div key={col} />;
                      const isActive = activeBtn === btn.id;
                      const accent = btn.color ? ACCENT[btn.color] : DEFAULT_ACCENT;
                      return (
                        <button
                          key={btn.id}
                          tabIndex={-1}
                          className={`
                            relative flex items-center justify-center rounded-lg border px-2 py-3 text-xs font-bold uppercase tracking-wide select-none transition-all duration-150
                            ${isActive
                              ? `${accent.bg} ${accent.text} border-transparent ring-2 ${accent.ring} scale-95`
                              : "border-white/10 bg-white/[0.03] text-neutral-400 hover:bg-white/[0.06]"
                            }
                          `}
                          style={{ gridColumn: `${col + 1} / span ${btn.colSpan ?? 1}` }}
                        >
                          {btn.label}
                          {isActive && (
                            <span className="absolute inset-0 rounded-lg animate-ping opacity-20 bg-white pointer-events-none" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 w-full max-w-xs text-xs text-neutral-500 space-y-1">
            <p>Buttons highlight when a matching key event is detected.</p>
            <p>If a button does not light up, check the event log for the raw key values your remote sends.</p>
          </div>
        </div>

        {/* ── Event Log + Key Map ─────────────────────────── */}
        <div className="flex flex-col gap-6">
          {/* Last Key */}
          {events.length > 0 && (
            <div className="rounded-lg border border-white/10 bg-neutral-900/60 p-4">
              <p className="text-xs text-neutral-500 mb-2 uppercase tracking-wide">Last Key Received</p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-neutral-500 text-xs">key</span>
                  <p className="font-mono text-neutral-100 truncate">{events[0].key === " " ? "Space" : events[0].key}</p>
                </div>
                <div>
                  <span className="text-neutral-500 text-xs">code</span>
                  <p className="font-mono text-neutral-100 truncate">{events[0].code}</p>
                </div>
                <div>
                  <span className="text-neutral-500 text-xs">keyCode</span>
                  <p className="font-mono text-neutral-100">{events[0].keyCode}</p>
                </div>
              </div>
              {events[0].matched && (
                <p className="mt-2 text-xs text-emerald-400">
                  Matched: <span className="font-semibold">{BUTTONS.find(b => b.id === events[0].matched)?.label}</span>
                  {" → "}
                  {BUTTONS.find(b => b.id === events[0].matched)?.appAction}
                </p>
              )}
              {!events[0].matched && (
                <p className="mt-2 text-xs text-amber-400">No matching remote button for this key</p>
              )}
            </div>
          )}

          {/* Event Log */}
          <div className="rounded-lg border border-white/10 bg-neutral-900/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <p className="text-xs text-neutral-500 uppercase tracking-wide">Event Log</p>
              <button
                onClick={() => setEvents([])}
                className="text-xs text-neutral-500 hover:text-neutral-300 transition"
              >
                Clear
              </button>
            </div>
            <div ref={logRef} className="max-h-64 overflow-y-auto">
              {events.length === 0 && (
                <div className="p-6 text-center text-sm text-neutral-600">
                  Press any key or remote button to begin…
                </div>
              )}
              {events.map((evt) => (
                <div
                  key={evt.id}
                  className={`flex items-center gap-3 px-4 py-2 text-xs border-b border-white/5 ${
                    evt.matched ? "bg-emerald-500/5" : ""
                  }`}
                >
                  <span className="font-mono text-neutral-400 w-20 shrink-0 truncate">
                    {evt.key === " " ? "Space" : evt.key}
                  </span>
                  <span className="font-mono text-neutral-500 w-36 shrink-0 truncate">
                    {evt.code}
                  </span>
                  <span className="font-mono text-neutral-600 w-10 shrink-0">{evt.keyCode}</span>
                  {evt.matched ? (
                    <span className="text-emerald-400 truncate">
                      {BUTTONS.find(b => b.id === evt.matched)?.appAction}
                    </span>
                  ) : (
                    <span className="text-neutral-600">unmapped</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Key Mapping Reference */}
          <div className="rounded-lg border border-white/10 bg-neutral-900/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-xs text-neutral-500 uppercase tracking-wide">Player Key Mappings</p>
            </div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/10 text-neutral-500">
                    <th className="text-left px-4 py-2 font-medium">Key</th>
                    <th className="text-left px-4 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {BUTTONS.map((btn) => (
                    <tr key={btn.id} className="border-b border-white/5">
                      <td className="px-4 py-1.5 font-mono text-neutral-300">
                        {btn.keys.map(k => k === " " ? "Space" : k).join(", ")}
                      </td>
                      <td className="px-4 py-1.5 text-neutral-400">{btn.appAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
