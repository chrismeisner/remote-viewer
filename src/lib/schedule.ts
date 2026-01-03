export type ScheduleSlot = {
  start: string; // HH:MM 24h
  end: string; // HH:MM 24h
  file: string; // relative path inside MEDIA_ROOT
  title?: string;
};

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

export function validateSchedule(schedule: DailySchedule) {
  if (!schedule || !Array.isArray(schedule.slots)) {
    throw new Error("Schedule requires slots");
  }

  let previous = -1;
  for (const slot of schedule.slots) {
    const startSeconds = parseTimeToSeconds(slot.start);
    const endSeconds = parseTimeToSeconds(slot.end);
    if (startSeconds === null) {
      throw new Error(`Invalid start time: ${slot.start}`);
    }
    if (endSeconds === null) {
      throw new Error(`Invalid end time: ${slot.end}`);
    }
    if (endSeconds <= startSeconds) {
      throw new Error(`End time must be after start time (${slot.start} -> ${slot.end})`);
    }
    if (startSeconds <= previous) {
      throw new Error("Start times must be ascending");
    }
    previous = startSeconds;
    if (!slot.file) {
      throw new Error(`Missing file path at ${slot.start}`);
    }
  }
}

