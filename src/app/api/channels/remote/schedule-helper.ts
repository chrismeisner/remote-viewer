import type { Schedule } from "@/lib/schedule";
import { uploadJsonToFtp } from "@/lib/ftp";

export async function pushScheduleToRemote(schedule: Schedule): Promise<void> {
  await uploadJsonToFtp("schedule.json", schedule);
}

