/**
 * Google Analytics event tracking utilities
 * 
 * Events are only sent if GA is configured (NEXT_PUBLIC_GA_MEASUREMENT_ID is set).
 * All events use recommended GA4 event naming conventions.
 */

// Type-safe gtag function
declare global {
  interface Window {
    gtag?: (
      command: "event" | "config" | "js" | "set",
      targetOrEventName: string | Date,
      params?: Record<string, unknown>
    ) => void;
  }
}

/**
 * Check if analytics is available
 */
function isAnalyticsAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.gtag === "function";
}

/**
 * Set user properties that persist across sessions
 * These help segment users by their preferences
 */
export function setUserProperties(properties: {
  media_source?: "local" | "remote";
  crt_enabled?: boolean;
  preferred_channel?: string;
}) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("set", "user_properties", properties);
}

/**
 * Track channel selection
 */
export function trackChannelSelect(channelId: string, channelName?: string) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", "select_content", {
    content_type: "channel",
    content_id: channelId,
    content_name: channelName || channelId,
  });
}

/**
 * Track video playback start
 */
export function trackVideoStart(params: {
  videoTitle: string;
  videoPath: string;
  channelId: string;
  startOffset?: number;
}) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", "video_start", {
    video_title: params.videoTitle,
    video_path: params.videoPath,
    channel_id: params.channelId,
    start_offset_seconds: params.startOffset ?? 0,
  });
}

/**
 * Track fullscreen toggle
 */
export function trackFullscreenToggle(isFullscreen: boolean) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", isFullscreen ? "fullscreen_enter" : "fullscreen_exit", {
    event_category: "video_player",
  });
}

/**
 * Track mute toggle
 */
export function trackMuteToggle(isMuted: boolean) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", isMuted ? "mute" : "unmute", {
    event_category: "video_player",
  });
}

/**
 * Track CRT effect toggle (fun engagement metric)
 */
export function trackCrtToggle(isEnabled: boolean) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", "crt_toggle", {
    event_category: "video_player",
    crt_enabled: isEnabled,
  });
}

/**
 * Track page/feature engagement
 */
export function trackEngagement(action: string, label?: string) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", action, {
    event_category: "engagement",
    event_label: label,
  });
}

/**
 * Track video playback errors
 */
export function trackVideoError(params: {
  videoPath: string;
  channelId: string;
  errorType: "load_failed" | "playback_failed" | "buffer_stall";
  errorMessage?: string;
}) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", "video_error", {
    video_path: params.videoPath,
    channel_id: params.channelId,
    error_type: params.errorType,
    error_message: params.errorMessage,
  });
}

/**
 * Track watch duration when user leaves or switches content
 * Call this when: channel changes, page unloads, or video ends
 */
export function trackWatchDuration(params: {
  videoTitle: string;
  videoPath: string;
  channelId: string;
  watchedSeconds: number;
  totalDurationSeconds: number;
}) {
  if (!isAnalyticsAvailable()) return;
  
  // Calculate completion percentage
  const completionPercent = params.totalDurationSeconds > 0
    ? Math.round((params.watchedSeconds / params.totalDurationSeconds) * 100)
    : 0;
  
  // Only track if they watched at least 5 seconds (filters out accidental clicks)
  if (params.watchedSeconds < 5) return;
  
  window.gtag?.("event", "video_progress", {
    video_title: params.videoTitle,
    video_path: params.videoPath,
    channel_id: params.channelId,
    watched_seconds: Math.round(params.watchedSeconds),
    total_duration_seconds: Math.round(params.totalDurationSeconds),
    completion_percent: completionPercent,
    // GA4 engagement time metric (in milliseconds)
    engagement_time_msec: Math.round(params.watchedSeconds * 1000),
  });
}

/**
 * Track share actions
 */
export function trackShare(contentType: "channel" | "video", contentId: string) {
  if (!isAnalyticsAvailable()) return;
  
  window.gtag?.("event", "share", {
    method: "clipboard",
    content_type: contentType,
    item_id: contentId,
  });
}
