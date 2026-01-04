import path from "node:path";
import { Readable } from "node:stream";
import { Client } from "basic-ftp";
import type { Schedule } from "@/lib/schedule";

function getEnv() {
  const host = process.env.FTP_HOST?.trim();
  const user = process.env.FTP_USER?.trim();
  const password = process.env.FTP_PASS?.trim();
  const portRaw = process.env.FTP_PORT?.trim();
  const remotePath = process.env.FTP_REMOTE_PATH?.trim();
  const secureRaw = process.env.FTP_SECURE?.trim()?.toLowerCase();
  const port = portRaw ? Number(portRaw) : 21;
  const secure = secureRaw === "true" || secureRaw === "1";
  return { host, user, password, port, remotePath, secure };
}

export async function pushScheduleToRemote(schedule: Schedule): Promise<void> {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    throw new Error("FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH.");
  }

  const json = JSON.stringify(schedule, null, 2);
  const baseDir = path.posix.dirname(remotePath);
  const targetPath = path.posix.join(baseDir, "schedule.json");

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    if (baseDir && baseDir !== ".") {
      await client.ensureDir(baseDir);
    }
    const stream = Readable.from([json]);
    await client.uploadFrom(stream, targetPath);
  } finally {
    client.close();
  }
}

