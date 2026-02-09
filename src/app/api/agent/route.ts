import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

/**
 * Stream event protocol (NDJSON — one JSON object per line):
 *   {"type":"status","status":"searching"}   — web search started
 *   {"type":"text","delta":"..."}            — text content chunk
 */
function ndjson(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n";
}

export async function POST(request: NextRequest) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY not configured" },
        { status: 500 }
      );
    }

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const body = await request.json();
    const { messages, model = "gpt-4o", maxTokens = 4096, fullContext, systemNote } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Build system instructions with full application context
    let instructions = `You are a helpful assistant for Remote Viewer, a media scheduling and playback system that creates TV-like channels from a video library.

You have deep knowledge of this application:
- Users can configure a media source (local filesystem or remote FTP/CDN)
- Media files are video files (mp4, mkv, etc.) that can be scheduled on channels
- Channels can be "24hour" (time-slot based, like a TV schedule) or "looping" (continuous playlist loop)
- Each channel can be active or inactive
- 24-hour channels have time slots (start/end times mapped to files)
- Looping channels have playlists that repeat continuously based on a global clock
- The system resolves "now playing" based on the current time and schedule

The application context below includes media metadata when available (title, year, director, plot, tags/actors, IMDB URLs, etc.). ALWAYS check the metadata in the context FIRST before searching the web. Only use web search when the information is not already in the metadata — for example, if a file has no director listed, or the user asks for details beyond what's stored.

You also have access to web search for questions the metadata can't answer — deeper plot details, reviews, related recommendations, box office data, or any factual information not in the context. When you use web search results, naturally cite your sources.

Be concise and helpful. When answering questions about the current state of the application, reference the context data provided below. When the user asks about what's playing, what's available, or scheduling, use the real data.`;

    if (systemNote) {
      instructions += `\n\n--- ADDITIONAL INSTRUCTIONS ---\n\n${systemNote}`;
    }

    if (fullContext) {
      instructions += `\n\n--- CURRENT APPLICATION STATE ---\n\n${fullContext}`;
    }

    console.log(`[Agent] Request: model=${model}, maxTokens=${maxTokens}, messages=${messages.length}, hasContext=${!!fullContext}`);
    
    // Use the Responses API with web search tool
    const stream = await openai.responses.create({
      model,
      instructions,
      input: messages.map((m: { role: string; content: string }) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      tools: [{ type: "web_search" as const }],
      max_output_tokens: maxTokens,
      stream: true,
    });

    // Stream NDJSON events to the client
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          let hasContent = false;
          let searchSignalSent = false;

          for await (const event of stream) {
            const eventType = event.type;

            // Detect web search events and signal the client
            if (
              !searchSignalSent &&
              typeof eventType === "string" &&
              eventType.includes("web_search_call")
            ) {
              searchSignalSent = true;
              controller.enqueue(
                encoder.encode(ndjson({ type: "status", status: "searching" }))
              );
            }

            // Stream text output deltas
            if (eventType === "response.output_text.delta") {
              const delta = (event as { type: string; delta?: string }).delta;
              if (delta) {
                hasContent = true;
                controller.enqueue(
                  encoder.encode(ndjson({ type: "text", delta }))
                );
              }
            }
          }

          if (!hasContent) {
            console.log("[Agent] Stream completed with no content");
          }
          controller.close();
        } catch (err) {
          console.error("[Agent] Stream error:", err);
          controller.error(err);
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Agent API error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET endpoint to check connection status
export async function GET() {
  const configured = !!process.env.OPENAI_API_KEY;
  return NextResponse.json({ configured });
}
