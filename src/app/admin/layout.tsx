import Link from "next/link";
import type { ReactNode } from "react";

const navLinks = [
  { href: "/", label: "Player" },
  { href: "/admin/source", label: "Source" },
  { href: "/admin/media", label: "Media" },
  { href: "/admin/schedule", label: "Schedule" },
  { href: "/admin/channels", label: "Channels" },
  { href: "/admin/ftp-test", label: "FTP Test" },
  { href: "/admin/styling", label: "Styling" },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-black text-neutral-100 flex">
      <aside className="w-64 border-r border-white/10 bg-neutral-900/70 backdrop-blur">
        <div className="px-5 py-5">
          <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">Admin</p>
          <h1 className="text-lg font-semibold text-neutral-50">Control Panel</h1>
          <p className="text-xs text-neutral-500 mt-1">
            Manage channels and schedules
          </p>
        </div>
        <nav className="flex flex-col gap-1 px-3 pb-6">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-neutral-100 transition hover:bg-white/10 hover:text-white"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}

