"use client";

import { useEffect, useState } from "react";

export default function TimeAdminPage() {
  const [now, setNow] = useState(() => new Date());
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timeString = now.toLocaleTimeString();
  const dateString = now.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-8">
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">
              Time Admin
            </p>
            <p className="text-sm text-neutral-400">
              Live clock and current site time zone (server local time)
            </p>
          </div>
          <div className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-xs text-neutral-200">
            Time zone: <span className="font-mono">{timeZone}</span>
          </div>
        </header>

        <div className="rounded-2xl border border-white/10 bg-neutral-900/70 p-6 shadow-xl shadow-black/30">
          <div className="text-sm text-neutral-300">{dateString}</div>
          <div className="mt-2 text-5xl font-semibold tracking-tight text-white sm:text-6xl">
            {timeString}
          </div>
        </div>
      </div>
    </div>
  );
}

