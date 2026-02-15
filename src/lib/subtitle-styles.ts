/**
 * Shared subtitle display constants.
 *
 * Single source of truth for subtitle settings types, defaults,
 * font stacks, and rendering helpers. Used by:
 *   - useSubtitleStyles hook (player / watch pages)
 *   - subtitle serving and validation utilities
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type SubtitleFontFamily = "homevideo" | "sans-serif" | "monospace";
export type SubtitleAnchorMode = "video" | "browser";

export type SubtitleSettings = {
  fontFamily: SubtitleFontFamily;
  fontSize: number;            // vw units, e.g. 1.8
  lineHeight: number;          // unitless multiplier, e.g. 1.4
  textColor: string;           // hex color, e.g. "#d4d4d4"
  backgroundColor: string;     // hex color, e.g. "#000000"
  backgroundOpacity: number;   // 0–100
  textShadow: boolean;
  bottomMargin: number;        // percentage from bottom, 0–25
  anchorMode: SubtitleAnchorMode;
  paddingVertical: number;     // em units
  paddingHorizontal: number;   // em units
};

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  fontFamily: "homevideo",
  fontSize: 1.8,
  lineHeight: 1.1,
  textColor: "#d4d4d4",
  backgroundColor: "#000000",
  backgroundOpacity: 75,
  textShadow: false,
  bottomMargin: 5,
  anchorMode: "video",
  paddingVertical: 0.4,
  paddingHorizontal: 0.6,
};

// ── Font options ─────────────────────────────────────────────────────────────

export type SubtitleFontOption = {
  value: SubtitleFontFamily;
  label: string;
  css: string;
};

export const SUBTITLE_FONT_OPTIONS: SubtitleFontOption[] = [
  {
    value: "homevideo",
    label: "HomeVideo",
    css: '"HomeVideo", "DM Mono", ui-monospace, SFMono-Regular, monospace',
  },
  {
    value: "sans-serif",
    label: "Sans-serif",
    css: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  {
    value: "monospace",
    label: "Monospace",
    css: '"DM Mono", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  },
];

/** Look up the CSS font-family stack for a given font key. */
export function fontFamilyCss(family: SubtitleFontFamily): string {
  return (
    SUBTITLE_FONT_OPTIONS.find((o) => o.value === family)?.css ??
    SUBTITLE_FONT_OPTIONS[0].css
  );
}

// ── Rendering helpers ────────────────────────────────────────────────────────

/** Convert a hex colour + 0–100 opacity to an rgba() string. */
export function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

/** Build the CSS text-shadow value based on the textShadow toggle. */
export function subtitleTextShadow(enabled: boolean): string {
  return enabled
    ? "1px 1px 2px rgba(0,0,0,0.9), 0 0 8px rgba(0,0,0,0.6)"
    : "none";
}

// ── Validation (shared between client and server) ────────────────────────────

const VALID_FONT_FAMILIES: SubtitleFontFamily[] = ["homevideo", "sans-serif", "monospace"];
const VALID_ANCHOR_MODES: SubtitleAnchorMode[] = ["video", "browser"];
const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Clamp a value between min and max. */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/**
 * Validate and normalise a partial settings object, merging with defaults.
 * Safe to call on either client or server.
 */
export function validateSubtitleSettings(
  partial: Partial<SubtitleSettings>
): SubtitleSettings {
  const s: SubtitleSettings = { ...DEFAULT_SUBTITLE_SETTINGS, ...partial };

  s.fontSize = clamp(s.fontSize, 0.5, 5);
  s.lineHeight = clamp(s.lineHeight, 0.8, 3);
  s.backgroundOpacity = clamp(s.backgroundOpacity, 0, 100);
  s.bottomMargin = clamp(s.bottomMargin, 0, 25);
  s.paddingVertical = clamp(s.paddingVertical, 0, 2);
  s.paddingHorizontal = clamp(s.paddingHorizontal, 0, 3);

  if (!VALID_FONT_FAMILIES.includes(s.fontFamily)) {
    s.fontFamily = DEFAULT_SUBTITLE_SETTINGS.fontFamily;
  }
  if (!VALID_ANCHOR_MODES.includes(s.anchorMode)) {
    s.anchorMode = DEFAULT_SUBTITLE_SETTINGS.anchorMode;
  }
  if (!HEX_PATTERN.test(s.textColor)) {
    s.textColor = DEFAULT_SUBTITLE_SETTINGS.textColor;
  }
  if (!HEX_PATTERN.test(s.backgroundColor)) {
    s.backgroundColor = DEFAULT_SUBTITLE_SETTINGS.backgroundColor;
  }

  return s;
}
