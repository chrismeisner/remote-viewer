import type { Schedule } from "@/lib/schedule";
import { uploadJsonToFtp } from "@/lib/ftp";

/**
 * Normalize schedule for pushing to remote.
 * Ensures all channels have explicit active field (defaults to true if missing).
 */
function normalizeScheduleForPush(schedule: Schedule): Schedule {
  const normalizedChannels: Schedule["channels"] = {};
  
  for (const [id, channel] of Object.entries(schedule.channels)) {
    normalizedChannels[id] = {
      ...channel,
      active: channel.active ?? true, // Explicit default
    };
  }
  
  return {
    ...schedule,
    channels: normalizedChannels,
  };
}

export async function pushScheduleToRemote(schedule: Schedule): Promise<void> {
  const normalizedSchedule = normalizeScheduleForPush(schedule);
  await uploadJsonToFtp("schedule.json", normalizedSchedule);
}

