import { NextRequest, NextResponse } from "next/server";
import {
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  renameChannel,
  loadFullSchedule,
} from "@/lib/media";
import { normalizeChannelId, isFtpConfigured, uploadJsonToFtp } from "@/lib/ftp";
import { pushScheduleToRemote } from "./schedule-helper";

export const runtime = "nodejs";

/**
 * Push both schedule.json and channels.json to remote.
 * schedule.json is the source of truth; channels.json is for backwards compatibility.
 */
async function pushToRemote(): Promise<void> {
  if (!isFtpConfigured()) {
    throw new Error("FTP not configured. Set FTP_HOST, FTP_USER, FTP_PASS, FTP_REMOTE_PATH.");
  }

  const schedule = await loadFullSchedule("local");

  // Push schedule.json (source of truth)
  await pushScheduleToRemote(schedule);

  // Also push channels.json for backwards compatibility with older clients
  const channels = Object.entries(schedule.channels).map(([id, ch]) => ({
    id,
    shortName: ch.shortName,
    active: ch.active ?? true,
  }));
  await uploadJsonToFtp("channels.json", { channels });
}

// GET - List remote channels (reads from local, which should be in sync with remote)
export async function GET() {
  try {
    const channels = await listChannels("local");
    return NextResponse.json({ channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to list channels";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// POST - Create a new remote channel
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName.trim() : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    const normalizedId = normalizeChannelId(id);
    if (!normalizedId) {
      return NextResponse.json({ error: "Invalid channel ID" }, { status: 400 });
    }

    // Check if channel already exists
    const existingChannels = await listChannels("local");
    if (existingChannels.some((ch) => ch.id === normalizedId)) {
      return NextResponse.json({ error: "Channel already exists" }, { status: 400 });
    }

    // Create channel in local schedule.json
    const result = await createChannel(normalizedId, shortName);

    // Push to remote
    await pushToRemote();

    const channels = await listChannels("local");
    return NextResponse.json({
      channel: {
        id: result.channel,
        shortName: result.shortName,
        active: true,
      },
      channels,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// PATCH - Update a remote channel
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    const newIdRaw = typeof body?.newId === "string" ? body.newId.trim() : "";
    const shortName = typeof body?.shortName === "string" ? body.shortName : undefined;
    const active = typeof body?.active === "boolean" ? body.active : undefined;

    if (!id) {
      return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
    }

    // Check if channel exists
    const existingChannels = await listChannels("local");
    if (!existingChannels.some((ch) => ch.id === id)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Handle ID change (rename)
    let targetId = id;
    if (newIdRaw) {
      const normalizedNewId = normalizeChannelId(newIdRaw);
      if (!normalizedNewId) {
        return NextResponse.json({ error: "Invalid new channel ID" }, { status: 400 });
      }
      if (normalizedNewId !== id) {
        if (existingChannels.some((ch) => ch.id === normalizedNewId)) {
          return NextResponse.json({ error: "Channel ID already exists" }, { status: 400 });
        }
        await renameChannel(id, normalizedNewId);
        targetId = normalizedNewId;
      }
    }

    // Update other properties
    const updates: { shortName?: string; active?: boolean } = {};
    if (shortName !== undefined) updates.shortName = shortName;
    if (active !== undefined) updates.active = active;

    if (Object.keys(updates).length > 0) {
      await updateChannel(targetId, updates);
    }

    // Push to remote
    await pushToRemote();

    const channels = await listChannels("local");
    const updatedChannel = channels.find((ch) => ch.id === targetId) || { id: targetId, active: true };
    return NextResponse.json({ channel: updatedChannel, channels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE - Delete a remote channel and its schedule
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Channel ID is required" }, { status: 400 });
  }

  try {
    // Check if channel exists
    const existingChannels = await listChannels("local");
    if (!existingChannels.some((ch) => ch.id === id)) {
      return NextResponse.json({ error: "Channel not found" }, { status: 404 });
    }

    // Delete from local schedule.json
    await deleteChannel(id);

    // Push to remote
    await pushToRemote();

    const channels = await listChannels("local");
    return NextResponse.json({ ok: true, channels, deletedSchedule: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to delete channel";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
