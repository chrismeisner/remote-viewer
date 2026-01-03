"use client";

import { useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

export default function Header() {
  return (
    <header className="border-b border-white/10 bg-slate-900/60 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4 text-slate-100">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-slate-300">
            Remote Viewer
          </p>
          <p className="text-sm text-slate-400">
            Tune into your local video channels
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-300">
          <MediaSourceBadge />
          <NowClocks />
        </div>
      </div>
    </header>
  );
}

function MediaSourceBadge() {
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncSource = () => {
      const stored = window.localStorage.getItem(MEDIA_SOURCE_KEY);
      setMediaSource(stored === "remote" ? "remote" : "local");
    };
    syncSource();
    window.addEventListener("storage", syncSource);
    window.addEventListener(MEDIA_SOURCE_EVENT, syncSource);
    return () => {
      window.removeEventListener("storage", syncSource);
      window.removeEventListener(MEDIA_SOURCE_EVENT, syncSource);
    };
  }, []);

  return (
    <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1">
      <span className="text-slate-400">Media</span>
      <span className="font-semibold text-slate-100">
        {mediaSource === "remote" ? "Remote" : "Local"}
      </span>
      {mediaSource === "remote" && (
        <span className="hidden sm:inline text-[11px] text-slate-400">
          {REMOTE_MEDIA_BASE}
        </span>
      )}
    </div>
  );
}

function NowClocks() {
  const [clock, setClock] = useState<string>("");
  const [clockUtc, setClockUtc] = useState<string>("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClock(now.toLocaleTimeString());
      setClockUtc(now.toLocaleTimeString("en-US", { timeZone: "UTC" }));
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1">
        <span className="text-slate-400">Local</span>
        <span className="font-mono text-slate-100">{clock}</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1">
        <span className="text-slate-400">UTC</span>
        <span className="font-mono text-slate-100">{clockUtc}</span>
      </div>
    </>
  );
}

