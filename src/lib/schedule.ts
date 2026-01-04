export type ScheduleSlot = {
  start: string; // HH:MM 24h
  end: string; // HH:MM 24h
  file: string; // relative path inside MEDIA_ROOT
  title?: string;
};

export type ChannelSchedule = {
  slots: ScheduleSlot[];
  shortName?: string;
};

// Single schedule.json containing all channels
export type Schedule = {
  channels: Record<string, ChannelSchedule>;
  version?: number;
};

// Legacy type for backward compatibility during migration
export type DailySchedule = {
  slots: ScheduleSlot[];
  version?: number;
};

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
    if (endSeconds <= startSeconds) {
      throw new Error(`${prefix}End time must be after start time (${slot.start} -> ${slot.end})`);
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

// Legacy validation for backward compatibility
export function validateDailySchedule(schedule: DailySchedule) {
  validateChannelSchedule(schedule);
}

