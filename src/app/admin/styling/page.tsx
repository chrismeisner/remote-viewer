"use client";

export default function StylingPage() {
  const themeColors = [
    { name: "background", value: "#000000", css: "var(--background)" },
    { name: "foreground", value: "#d4d4d4", css: "var(--foreground)" },
  ];

  const neutralColors = [
    { name: "neutral-50", value: "#fafafa" },
    { name: "neutral-100", value: "#f5f5f5" },
    { name: "neutral-200", value: "#e5e5e5" },
    { name: "neutral-300", value: "#d4d4d4" },
    { name: "neutral-400", value: "#a3a3a3" },
    { name: "neutral-500", value: "#737373" },
    { name: "neutral-600", value: "#525252" },
    { name: "neutral-700", value: "#404040" },
    { name: "neutral-800", value: "#262626" },
    { name: "neutral-900", value: "#171717" },
    { name: "neutral-950", value: "#0a0a0a" },
  ];

  const fontSizes = [
    { name: "text-xs", size: "0.75rem", class: "text-xs" },
    { name: "text-sm", size: "0.875rem", class: "text-sm" },
    { name: "text-base", size: "1rem", class: "text-base" },
    { name: "text-lg", size: "1.125rem", class: "text-lg" },
    { name: "text-xl", size: "1.25rem", class: "text-xl" },
    { name: "text-2xl", size: "1.5rem", class: "text-2xl" },
    { name: "text-3xl", size: "1.875rem", class: "text-3xl" },
    { name: "text-4xl", size: "2.25rem", class: "text-4xl" },
  ];

  const spacingExamples = [
    { name: "p-1", pixels: "4px" },
    { name: "p-2", pixels: "8px" },
    { name: "p-3", pixels: "12px" },
    { name: "p-4", pixels: "16px" },
    { name: "p-5", pixels: "20px" },
    { name: "p-6", pixels: "24px" },
    { name: "p-8", pixels: "32px" },
  ];

  return (
    <div className="flex flex-col gap-8 text-neutral-100">
      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-[0.2em] text-neutral-400">
          Admin
        </p>
        <h1 className="text-xl font-semibold text-neutral-50">Styling Guide</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Global Tailwind styles and design tokens in use across the app.
        </p>
      </div>

      {/* Theme Colors */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">
          Theme Colors
        </h2>
        <p className="text-sm text-neutral-400 mb-4">
          Custom CSS variables defined in <code className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">globals.css</code>
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {themeColors.map((color) => (
            <div
              key={color.name}
              className="flex items-center gap-4 rounded-lg border border-white/10 bg-neutral-900/70 p-4"
            >
              <div
                className="h-12 w-12 rounded-lg border border-white/20"
                style={{ backgroundColor: color.value }}
              />
              <div>
                <p className="text-sm font-semibold text-neutral-50">
                  --{color.name}
                </p>
                <p className="text-xs text-neutral-400 font-mono">{color.value}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Neutral Palette */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">
          Neutral Gray Palette
        </h2>
        <p className="text-sm text-neutral-400 mb-4">
          True grayscale palette (no blue tint) used throughout the app.
        </p>
        <div className="grid gap-2">
          {neutralColors.map((color) => (
            <div
              key={color.name}
              className="flex items-center gap-4 rounded-lg overflow-hidden"
            >
              <div
                className="h-10 w-24 flex-shrink-0"
                style={{ backgroundColor: color.value }}
              />
              <p className="text-sm font-mono text-neutral-300 w-28">
                {color.name}
              </p>
              <p className="text-xs font-mono text-neutral-500">{color.value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Typography */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">Typography</h2>
        <p className="text-sm text-neutral-400 mb-4">
          Font sizes using Inter (primary font).
        </p>
        <div className="rounded-xl border border-white/10 bg-neutral-900/70 overflow-hidden">
          {fontSizes.map((font, i) => (
            <div
              key={font.name}
              className={`flex items-center gap-6 px-4 py-3 ${
                i !== fontSizes.length - 1 ? "border-b border-white/5" : ""
              }`}
            >
              <p className="text-xs font-mono text-neutral-500 w-20">
                {font.name}
              </p>
              <p className="text-xs font-mono text-neutral-500 w-20">
                {font.size}
              </p>
              <p className={font.class}>The quick brown fox</p>
            </div>
          ))}
        </div>
      </section>

      {/* Font Weights */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">
          Font Weights
        </h2>
        <div className="rounded-xl border border-white/10 bg-neutral-900/70 overflow-hidden">
          {[
            { name: "font-normal", weight: "400" },
            { name: "font-medium", weight: "500" },
            { name: "font-semibold", weight: "600" },
            { name: "font-bold", weight: "700" },
          ].map((font, i, arr) => (
            <div
              key={font.name}
              className={`flex items-center gap-6 px-4 py-3 ${
                i !== arr.length - 1 ? "border-b border-white/5" : ""
              }`}
            >
              <p className="text-xs font-mono text-neutral-500 w-28">
                {font.name}
              </p>
              <p className="text-xs font-mono text-neutral-500 w-12">
                {font.weight}
              </p>
              <p className={`text-lg ${font.name}`}>The quick brown fox</p>
            </div>
          ))}
        </div>
      </section>

      {/* Spacing */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">Spacing</h2>
        <p className="text-sm text-neutral-400 mb-4">
          Tailwind spacing scale (applies to padding, margin, gap, etc.)
        </p>
        <div className="flex flex-wrap items-end gap-4">
          {spacingExamples.map((space) => (
            <div key={space.name} className="flex flex-col items-center gap-2">
              <div
                className="bg-emerald-500/30 border border-emerald-500"
                style={{
                  width: space.pixels,
                  height: space.pixels,
                }}
              />
              <p className="text-xs font-mono text-neutral-400">{space.name}</p>
              <p className="text-xs font-mono text-neutral-600">{space.pixels}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Border Radius */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">
          Border Radius
        </h2>
        <div className="flex flex-wrap items-center gap-6">
          {[
            { name: "rounded", class: "rounded" },
            { name: "rounded-md", class: "rounded-md" },
            { name: "rounded-lg", class: "rounded-lg" },
            { name: "rounded-xl", class: "rounded-xl" },
            { name: "rounded-2xl", class: "rounded-2xl" },
            { name: "rounded-full", class: "rounded-full" },
          ].map((r) => (
            <div key={r.name} className="flex flex-col items-center gap-2">
              <div
                className={`h-16 w-16 bg-neutral-700 border border-white/20 ${r.class}`}
              />
              <p className="text-xs font-mono text-neutral-400">{r.name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Shadows */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">Shadows</h2>
        <div className="flex flex-wrap items-center gap-6">
          {[
            { name: "shadow-sm", class: "shadow-sm" },
            { name: "shadow", class: "shadow" },
            { name: "shadow-md", class: "shadow-md" },
            { name: "shadow-lg", class: "shadow-lg" },
            { name: "shadow-xl", class: "shadow-xl" },
          ].map((s) => (
            <div key={s.name} className="flex flex-col items-center gap-2">
              <div
                className={`h-16 w-16 bg-neutral-800 rounded-lg ${s.class} shadow-black/50`}
              />
              <p className="text-xs font-mono text-neutral-400">{s.name}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CRT Effects */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">
          CRT Effects
        </h2>
        <p className="text-sm text-neutral-400 mb-4">
          Custom CSS classes defined in <code className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">globals.css</code> for retro TV effects.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-sm font-mono text-neutral-400 mb-2">.crt-frame</p>
            <div className="crt-frame bg-neutral-900 p-6 aspect-video flex items-center justify-center">
              <p className="text-lg">CRT Frame Effect</p>
            </div>
          </div>
          <div>
            <p className="text-sm font-mono text-neutral-400 mb-2">
              .channel-overlay
            </p>
            <div className="bg-neutral-900 p-6 rounded-lg border border-white/10">
              <div className="channel-overlay">
                <span className="channel-number">CH 03</span>
                <span className="channel-name">Sample Channel</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HomeVideo Font */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">
          Custom Fonts
        </h2>
        <p className="text-sm text-neutral-400 mb-4">
          Custom fonts loaded via <code className="px-1.5 py-0.5 bg-neutral-800 rounded text-neutral-300">@font-face</code> in globals.css.
        </p>
        <div className="rounded-xl border border-white/10 bg-neutral-900/70 p-6">
          <p className="text-xs font-mono text-neutral-500 mb-2">
            font-family: &quot;HomeVideo&quot;
          </p>
          <p
            className="text-3xl text-neutral-100"
            style={{ fontFamily: "HomeVideo" }}
          >
            ABCDEFGHIJKLMNOPQRSTUVWXYZ
          </p>
          <p
            className="text-3xl text-neutral-100 mt-2"
            style={{ fontFamily: "HomeVideo" }}
          >
            0123456789
          </p>
        </div>
      </section>

      {/* Common Components */}
      <section>
        <h2 className="text-lg font-semibold text-neutral-50 mb-3">
          Common UI Patterns
        </h2>
        <p className="text-sm text-neutral-400 mb-4">
          Reusable styling patterns used throughout the admin.
        </p>

        <div className="space-y-6">
          {/* Cards */}
          <div>
            <p className="text-sm font-mono text-neutral-400 mb-2">Card</p>
            <div className="rounded-xl border border-white/10 bg-neutral-900/70 p-4 shadow-lg shadow-black/40 max-w-sm">
              <p className="text-sm font-semibold text-neutral-50">Card Title</p>
              <p className="text-sm text-neutral-400 mt-1">
                Card description text goes here.
              </p>
            </div>
          </div>

          {/* Buttons */}
          <div>
            <p className="text-sm font-mono text-neutral-400 mb-2">Buttons</p>
            <div className="flex flex-wrap gap-3">
              <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-500">
                Primary
              </button>
              <button className="rounded-lg bg-neutral-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-neutral-600">
                Secondary
              </button>
              <button className="rounded-lg border border-white/20 bg-transparent px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                Outline
              </button>
              <button className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-500">
                Danger
              </button>
            </div>
          </div>

          {/* Inputs */}
          <div>
            <p className="text-sm font-mono text-neutral-400 mb-2">Inputs</p>
            <div className="flex flex-wrap gap-3 max-w-md">
              <input
                type="text"
                placeholder="Text input..."
                className="flex-1 rounded-lg border border-white/20 bg-neutral-800 px-3 py-2 text-sm text-white placeholder:text-neutral-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              />
              <select className="rounded-lg border border-white/20 bg-neutral-800 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500">
                <option>Select option</option>
                <option>Option 1</option>
                <option>Option 2</option>
              </select>
            </div>
          </div>

          {/* Badges */}
          <div>
            <p className="text-sm font-mono text-neutral-400 mb-2">Badges</p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                Success
              </span>
              <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-xs font-medium text-amber-400">
                Warning
              </span>
              <span className="rounded-full bg-red-500/20 px-2.5 py-0.5 text-xs font-medium text-red-400">
                Error
              </span>
              <span className="rounded-full bg-neutral-500/20 px-2.5 py-0.5 text-xs font-medium text-neutral-400">
                Neutral
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
