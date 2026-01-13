import { NextResponse } from "next/server";
import { loadFullSchedule } from "@/lib/media";
import { isFtpConfigured, uploadJsonToFtp } from "@/lib/ftp";

type PushResult = {
  success: boolean;
  message: string;
  remotePath?: string;
};

export const runtime = "nodejs";

export async function POST() {
  if (!isFtpConfigured()) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Missing FTP env vars (FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH). Set these in your environment.",
      } satisfies PushResult,
      { status: 400 },
    );
  }

  try {
    const schedule = await loadFullSchedule("local");
    const targetPath = await uploadJsonToFtp("schedule.json", schedule);

    const channelCount = Object.keys(schedule.channels).length;
    return NextResponse.json({
      success: true,
      message: `Uploaded schedule.json (${channelCount} channel${channelCount === 1 ? "" : "s"}) to ${targetPath}`,
      remotePath: targetPath,
    } satisfies PushResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Upload failed: ${msg}` } satisfies PushResult,
      { status: 500 },
    );
  }
}

