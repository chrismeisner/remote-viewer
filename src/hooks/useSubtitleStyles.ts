"use client";

import { useEffect } from "react";
import {
  type SubtitleSettings,
  DEFAULT_SUBTITLE_SETTINGS,
  fontFamilyCss,
  hexToRgba,
  subtitleTextShadow,
} from "@/lib/subtitle-styles";

const STYLE_ID = "dynamic-subtitle-cue-styles";
const OVERLAY_ID = "browser-subtitle-overlay";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Apply bottom-margin positioning to all VTTCues on every <video>.
 * Only relevant in "video" anchor mode.
 */
function applyCuePositions(margin: number) {
  const linePos = 100 - margin;
  document.querySelectorAll("video").forEach((video) => {
    for (let t = 0; t < video.textTracks.length; t++) {
      const track = video.textTracks[t];
      if (!track.cues) continue;
      for (let c = 0; c < track.cues.length; c++) {
        const cue = track.cues[c] as VTTCue;
        if (cue.snapToLines !== false || cue.line !== linePos) {
          cue.snapToLines = false;
          cue.line = linePos;
        }
      }
    }
  });
}

// ── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Apply default subtitle styles to all video players.
 * Injects a dynamic <style> tag that overrides native `video::cue` rendering.
 *
 * When `anchorMode` is "browser", creates a fixed overlay element instead.
 *
 * Call in each page that contains a <video> with subtitles (PlayerClient,
 * WatchClient, etc.).
 */
export function useSubtitleStyles() {
  // Use hardcoded defaults (no more fetching from API)
  const settings = DEFAULT_SUBTITLE_SETTINGS;

  // ── Inject <style> for ::cue ────────────────────────────────────────────
  useEffect(() => {

    const fontStack = fontFamilyCss(settings.fontFamily);
    const bgColor = hexToRgba(settings.backgroundColor, settings.backgroundOpacity);
    const shadow = subtitleTextShadow(settings.textShadow);

    const css =
      settings.anchorMode === "browser"
        ? `video::cue { display: none; }`
        : `
video::cue {
  font-family: ${fontStack};
  font-size: ${settings.fontSize}vw;
  line-height: ${settings.lineHeight};
  color: ${settings.textColor};
  background-color: ${bgColor};
  padding: ${settings.paddingVertical}em ${settings.paddingHorizontal}em;
  text-shadow: ${shadow};
}`;

    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement("style");
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = css;

    return () => {
      document.getElementById(STYLE_ID)?.remove();
    };
  }, [settings]);

  // ── Bottom-margin cue positioning (video mode) ─────────────────────────
  useEffect(() => {
    if (settings.anchorMode !== "video" || settings.bottomMargin === 0) return;

    const margin = settings.bottomMargin;
    applyCuePositions(margin);

    const handleTrackChange = () => applyCuePositions(margin);

    // Attach listeners to current videos
    const attachListeners = () => {
      document.querySelectorAll("video").forEach((video) => {
        video.textTracks.addEventListener("addtrack", handleTrackChange);
        for (let t = 0; t < video.textTracks.length; t++) {
          video.textTracks[t].addEventListener("cuechange", handleTrackChange);
        }
      });
    };
    attachListeners();

    // Watch for new <video> elements
    const observer = new MutationObserver(() => {
      applyCuePositions(margin);
      attachListeners();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      document.querySelectorAll("video").forEach((video) => {
        video.textTracks.removeEventListener("addtrack", handleTrackChange);
        for (let t = 0; t < video.textTracks.length; t++) {
          video.textTracks[t].removeEventListener("cuechange", handleTrackChange);
        }
      });
    };
  }, [settings]);

  // ── Browser-anchored subtitle overlay ──────────────────────────────────
  useEffect(() => {
    if (settings.anchorMode !== "browser") {
      document.getElementById(OVERLAY_ID)?.remove();
      return;
    }

    let overlay = document.getElementById(OVERLAY_ID) as HTMLDivElement | null;
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      Object.assign(overlay.style, {
        position: "fixed",
        left: "0",
        right: "0",
        textAlign: "center",
        zIndex: "9999",
        pointerEvents: "none",
        transition: "opacity 0.15s ease",
        display: "inline-block",
        maxWidth: "80%",
      });
      document.body.appendChild(overlay);
    }

    const fontStack = fontFamilyCss(settings.fontFamily);
    const bgColor = hexToRgba(settings.backgroundColor, settings.backgroundOpacity);
    const shadow = subtitleTextShadow(settings.textShadow);

    Object.assign(overlay.style, {
      bottom: `${settings.bottomMargin}%`,
      fontFamily: fontStack,
      fontSize: `${settings.fontSize}vw`,
      lineHeight: String(settings.lineHeight),
      color: settings.textColor,
      backgroundColor: bgColor,
      padding: `${settings.paddingVertical}em ${settings.paddingHorizontal}em`,
      textShadow: shadow,
    });

    // Track active VTT cues and mirror text into the overlay
    let rafId: number | null = null;
    function tick() {
      if (!overlay) return;
      let text = "";
      document.querySelectorAll("video").forEach((video) => {
        for (let t = 0; t < video.textTracks.length; t++) {
          const track = video.textTracks[t];
          if (track.mode !== "showing" || !track.activeCues) continue;
          for (let c = 0; c < track.activeCues.length; c++) {
            const cue = track.activeCues[c] as VTTCue;
            if (cue.text) {
              if (text) text += "\n";
              text += cue.text
                .replace(/<v\s+[^>]*>/gi, "")
                .replace(/<\/v>/gi, "")
                .replace(/<i>/gi, "<em>")
                .replace(/<\/i>/gi, "</em>")
                .replace(/<b>/gi, "<strong>")
                .replace(/<\/b>/gi, "</strong>");
            }
          }
        }
      });
      overlay.innerHTML = text;
      overlay.style.opacity = text ? "1" : "0";
      rafId = requestAnimationFrame(tick);
    }
    tick();

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      document.getElementById(OVERLAY_ID)?.remove();
    };
  }, [settings]);

  return settings;
}
