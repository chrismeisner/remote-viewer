"use client";

import Link from "next/link";

const links = [
  {
    href: "/admin/media",
    title: "Media Library",
    desc: "Browse and manage all media files (single source of truth).",
  },
  {
    href: "/admin/schedule",
    title: "Schedule Admin",
    desc: "Edit the 24h schedule for a channel.",
  },
  {
    href: "/admin/channels",
    title: "Channel Admin",
    desc: "Create or remove channels and jump to their schedules.",
  },
  {
    href: "/admin/styling",
    title: "Styling Guide",
    desc: "View global Tailwind styles and design tokens.",
  },
  {
    href: "/",
    title: "Player",
    desc: "Preview the current channel playback.",
  },
];

export default function AdminHome() {
  return (
    <div className="flex flex-col gap-6 text-neutral-100">
      <div>
        <p className="text-sm uppercase tracking-[0.2em] text-neutral-300">
          Admin
        </p>
        <h1 className="text-xl font-semibold text-neutral-50">Control Panel</h1>
        <p className="text-sm text-neutral-400">
          Choose a tool to manage channels or schedules.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-xl border border-white/10 bg-neutral-900/70 p-4 shadow-lg shadow-black/40 transition hover:border-white/20 hover:bg-neutral-900"
          >
            <p className="text-sm font-semibold text-neutral-50">{link.title}</p>
            <p className="text-sm text-neutral-400 mt-1">{link.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}

