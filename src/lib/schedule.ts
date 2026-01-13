export type ScheduleSlot = {
  start: string; // HH:MM 24h
  end: string; // HH:MM 24h
  file: string; // relative path inside MEDIA_ROOT
  title?: string;
};

export type ChannelSchedule = {
  slots: ScheduleSlot[];
  shortName?: string;
  active?: boolean; // Default true if undefined
};

// Single schedule.json containing all channels
export type Schedule = {
  channels: Record<string, ChannelSchedule>;
  version?: number;
};

/**
 * @deprecated Use ChannelSchedule instead. This alias exists for backwards compatibility.
 */
export type DailySchedule = ChannelSchedule;

const timePattern = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

export function parseTimeToSeconds(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(timePattern);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Calculate the duration of a slot in seconds.
 * If end < start, the slot crosses midnight (e.g., 23:00 -> 01:00 = 2 hours).
 */
export function slotDurationSeconds(startSeconds: number, endSeconds: number): number {
  if (endSeconds > startSeconds) {
    return endSeconds - startSeconds;
  }
  // Crosses midnight: time from start to 24:00, plus time from 00:00 to end
  return (86400 - startSeconds) + endSeconds;
}

/**
 * Calculate the effective end seconds for a slot (may exceed 86400 if crossing midnight).
 * This is useful for range comparisons within a single day cycle.
 */
export function effectiveEndSeconds(startSeconds: number, endSeconds: number): number {
  if (endSeconds > startSeconds) {
    return endSeconds;
  }
  // Crosses midnight: treat end as next-day time
  return endSeconds + 86400;
}

export function validateChannelSchedule(schedule: ChannelSchedule, channelId?: string) {
  const prefix = channelId ? `Channel ${channelId}: ` : "";
  if (!schedule || !Array.isArray(schedule.slots)) {
    throw new Error(`${prefix}Schedule requires slots`);
  }

  let previous = -1;
  for (const slot of schedule.slots) {
    const startSeconds = parseTimeToSeconds(slot.start);
    const endSeconds = parseTimeToSeconds(slot.end);
    if (startSeconds === null) {
      throw new Error(`${prefix}Invalid start time: ${slot.start}`);
    }
    if (endSeconds === null) {
      throw new Error(`${prefix}Invalid end time: ${slot.end}`);
    }
    // Allow midnight-crossing slots (end < start means it wraps past midnight)
    // Only reject if start === end (zero-duration slot)
    if (startSeconds === endSeconds) {
      throw new Error(`${prefix}Slot cannot have zero duration (${slot.start} -> ${slot.end})`);
    }
    if (startSeconds <= previous) {
      throw new Error(`${prefix}Start times must be ascending`);
    }
    previous = startSeconds;
    if (!slot.file) {
      throw new Error(`${prefix}Missing file path at ${slot.start}`);
    }
  }
}

export function validateSchedule(schedule: Schedule) {
  if (!schedule || typeof schedule.channels !== "object") {
    throw new Error("Schedule requires channels object");
  }

  for (const [channelId, channelSchedule] of Object.entries(schedule.channels)) {
    validateChannelSchedule(channelSchedule, channelId);
  }
}

/**
 * @deprecated Use validateChannelSchedule instead.
 */
export function validateDailySchedule(schedule: ChannelSchedule) {
  validateChannelSchedule(schedule);
}

