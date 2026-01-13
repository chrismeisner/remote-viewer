import { NextResponse } from "next/server";
import { listChannels, type ChannelInfo } from "@/lib/media";
import { isFtpConfigured, uploadJsonToFtp } from "@/lib/ftp";

type PushResult = {
  success: boolean;
  message: string;
  remotePath?: string;
  channels?: ChannelInfo[];
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
    const channels = await listChannels("local");
    const targetPath = await uploadJsonToFtp("channels.json", { channels });

    return NextResponse.json({
      success: true,
      message: `Uploaded channels.json to ${targetPath}`,
      remotePath: targetPath,
      channels,
    } satisfies PushResult);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { success: false, message: `Upload failed: ${msg}` } satisfies PushResult,
      { status: 500 },
    );
  }
}

