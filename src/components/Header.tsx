"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  MEDIA_SOURCE_EVENT,
  MEDIA_SOURCE_KEY,
  REMOTE_MEDIA_BASE,
  type MediaSource,
} from "@/constants/media";

export default function Header() {
  return (
    <header className="site-header border-b border-white/10 bg-neutral-900/80 backdrop-blur">
      <div className="header-inner mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4 text-neutral-100">
        <div>
          <Link
            href="/"
            className="text-sm font-semibold text-neutral-300 hover:text-neutral-100"
          >
            Remote Viewer
          </Link>
        </div>
        <div className="flex items-center gap-3 text-xs text-neutral-300">
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
      <span className="font-semibold text-neutral-100">
        {mediaSource === "remote" ? "Remote" : "Local"}
      </span>
      {mediaSource === "remote" && (
        <span className="hidden sm:inline text-[11px] text-neutral-400">
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
        <span className="text-neutral-400">Local</span>
        <span className="font-mono text-neutral-100">{clock}</span>
      </div>
      <div className="flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-1">
        <span className="text-neutral-400">UTC</span>
        <span className="font-mono text-neutral-100">{clockUtc}</span>
      </div>
    </>
  );
}

