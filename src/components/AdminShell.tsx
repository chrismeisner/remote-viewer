"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useSession, signOut } from "next-auth/react";

const SIDEBAR_KEY = "adminSidebarOpen";

const navLinks = [
  { href: "/", label: "Player" },
  { href: "/admin/source", label: "Source" },
  { href: "/admin/media", label: "Media" },
  { href: "/admin/covers", label: "Covers" },
  { href: "/admin/channels", label: "Channels" },
  { href: "/admin/changelog", label: "Changelog" },
  { href: "/admin/data-health", label: "Data Health" },
  { href: "/admin/video-health", label: "Video Health" },
  { href: "/admin/ftp-test", label: "FTP Test" },
  { href: "/admin/styling", label: "Styling" },
  { href: "/admin/agent", label: "Agent" },
];

export default function AdminShell({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [open, setOpen] = useState(true);
  // avoid flash: read localStorage on mount
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = window.localStorage.getItem(SIDEBAR_KEY);
    if (stored === "false") setOpen(false);
    setMounted(true);
  }, []);

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      window.localStorage.setItem(SIDEBAR_KEY, String(next));
      return next;
    });
  }

  return (
    <div className="min-h-dvh bg-black text-neutral-100 flex">
      {/* Sidebar */}
      <aside
        className={`sticky top-0 h-screen overflow-y-auto border-r border-white/10 bg-neutral-900/70 backdrop-blur
          transition-[width] duration-200 ease-in-out ${
            open ? "w-64" : "w-10"
          } ${!mounted ? "opacity-0" : "opacity-100"}`}
      >
        {/* Toggle button */}
        <button
          onClick={toggle}
          className="flex items-center justify-center w-full h-10 text-neutral-400 hover:text-white hover:bg-white/10 transition"
          aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform duration-200 ${
              open ? "" : "rotate-180"
            }`}
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>

        {/* Header & Nav – hidden when collapsed */}
        {open && (
          <>
            <div className="px-5 py-3">
              <p className="text-xs uppercase text-neutral-400">Admin</p>
              <h1 className="text-lg font-semibold text-neutral-50">
                Control Panel
              </h1>
              <p className="text-xs text-neutral-500 mt-1">
                Manage channels and schedules
              </p>
            </div>

            <nav className="flex flex-col gap-1 px-3 pb-4">
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

            {/* Signed-in user info */}
            {session?.user && (
              <div className="mt-auto border-t border-white/10 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  {session.user.image && (
                    <img
                      src={session.user.image}
                      alt=""
                      className="h-6 w-6 rounded-full"
                    />
                  )}
                  <span className="text-xs text-neutral-400 truncate">
                    {session.user.email}
                  </span>
                </div>
                <button
                  onClick={() => signOut({ callbackUrl: "/" })}
                  className="text-xs text-neutral-500 hover:text-red-400 transition"
                >
                  Sign out
                </button>
              </div>
            )}
          </>
        )}
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
      </main>
    </div>
  );
}
