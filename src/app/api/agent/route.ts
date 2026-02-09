import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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
    const { messages, model = "gpt-4o", maxTokens = 1024, fullContext } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    // Build system prompt with full application context
    let systemContent = `You are a helpful assistant for Remote Viewer, a media scheduling and playback system that creates TV-like channels from a video library.

You have deep knowledge of this application:
- Users can configure a media source (local filesystem or remote FTP/CDN)
- Media files are video files (mp4, mkv, etc.) that can be scheduled on channels
- Channels can be "24hour" (time-slot based, like a TV schedule) or "looping" (continuous playlist loop)
- Each channel can be active or inactive
- 24-hour channels have time slots (start/end times mapped to files)
- Looping channels have playlists that repeat continuously based on a global clock
- The system resolves "now playing" based on the current time and schedule

Be concise and helpful. When answering questions about the current state, reference the context data provided below. When the user asks about what's playing, what's available, or scheduling, use the real data.`;

    if (fullContext) {
      systemContent += `\n\n--- CURRENT APPLICATION STATE ---\n\n${fullContext}`;
    }

    const systemMessage = {
      role: "system" as const,
      content: systemContent,
    };

    console.log(`[Agent] Request: model=${model}, maxTokens=${maxTokens}, messages=${messages.length}, hasContext=${!!fullContext}`);
    
    const completion = await openai.chat.completions.create({
      model,
      messages: [systemMessage, ...messages],
      max_completion_tokens: maxTokens,
      stream: true,
    });

    // Create a streaming response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let hasContent = false;
          for await (const chunk of completion) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              hasContent = true;
              controller.enqueue(encoder.encode(content));
            }
            // Check for finish reason
            const finishReason = chunk.choices[0]?.finish_reason;
            if (finishReason && finishReason !== "stop") {
              console.log("Stream finished with reason:", finishReason);
            }
          }
          if (!hasContent) {
            console.log("Stream completed with no content");
          }
          controller.close();
        } catch (err) {
          console.error("Stream error:", err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
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
