import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Client } from "basic-ftp";

type TestResult = {
  success: boolean;
  message: string;
  cwd?: string;
  entries?: Array<{ name: string; type: string; size?: number }>;
  writeTest?: { success: boolean; message: string };
};

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

export const runtime = "nodejs";

export async function GET() {
  const { host, user, password, port, remotePath, secure } = getEnv();
  if (!host || !user || !password || !remotePath) {
    return NextResponse.json(
      {
        success: false,
        message: "Missing FTP env vars (FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH)",
      } satisfies TestResult,
      { status: 400 },
    );
  }

  const client = new Client(15000);
  try {
    await client.access({ host, port, user, password, secure });
    const targetDir = path.posix.dirname(remotePath);
    const list = await client.list(targetDir);
    const entries = list.map((e) => ({
      name: e.name,
      type: e.type,
      size: e.size,
    }));

    let writeTest: { success: boolean; message: string } | undefined;
    try {
      const testName = `.ftp-test-${Date.now()}.txt`;
      const remoteTestPath = path.posix.join(targetDir, testName);
      const content = `ftp test at ${new Date().toISOString()}\n`;
      const stream = Readable.from([content]);
      await client.uploadFrom(stream, remoteTestPath);
      await client.remove(remoteTestPath);
      writeTest = { success: true, message: `Uploaded and deleted ${testName}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeTest = { success: false, message: `Write test failed: ${msg}` };
    }

    return NextResponse.json({
      success: true,
      message: `Connected and listed ${targetDir}`,
      cwd: targetDir,
      entries,
      writeTest,
    } satisfies TestResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        success: false,
        message: `FTP test failed: ${message}`,
      } satisfies TestResult,
      { status: 500 },
    );
  } finally {
    client.close();
  }
}

