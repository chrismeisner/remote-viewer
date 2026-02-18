"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { Modal, ModalTitle } from "@/components/Modal";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  isSearching?: boolean;
};

type StreamEvent =
  | { type: "status"; status: string }
  | { type: "text"; delta: string };

type MediaMetadata = {
  title?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  director?: string | null;
  category?: string | null;
  makingOf?: string | null;
  plot?: string | null;
  type?: "film" | "tv" | "documentary" | "sports" | "concert" | "other" | null;
  season?: number | null;
  episode?: number | null;
  coverUrl?: string | null;
  coverLocal?: string | null;
  coverPath?: string | null;
  tags?: string[] | null;
  subtitleFile?: string | null;
};

type NowPlaying = {
  title: string;
  relPath: string;
  durationSeconds: number;
  startOffsetSeconds: number;
};

type Effort = "normal" | "high" | "extra";

type PlayerChatOverlayProps = {
  open: boolean;
  onClose: () => void;
  nowPlaying: NowPlaying | null;
  metadata: MediaMetadata | null;
};

const EFFORT_CONFIG: Record<Effort, { maxTokens: number; promptSuffix: string }> = {
  normal: {
    maxTokens: 2048,
    promptSuffix: "Keep responses brief — 1-2 sentences max. Be direct and to the point.",
  },
  high: {
    maxTokens: 4096,
    promptSuffix: "Keep responses short (2-4 sentences unless the user asks for more detail).",
  },
  extra: {
    maxTokens: 8192,
    promptSuffix: "Give thorough, detailed responses. Include context, trivia, and interesting details. Use lists or sections when helpful.",
  },
};

function buildWelcomeMessage(
  nowPlaying: NowPlaying | null,
  metadata: MediaMetadata | null
): string {
  if (!nowPlaying) return "Hi! Nothing is playing right now. Switch to a channel and I'll tell you about what's on.";

  const title = metadata?.title || nowPlaying.title;
  const year = metadata?.year ? ` (${metadata.year})` : "";
  const director = metadata?.director ? `, directed by ${metadata.director}` : "";

  const typeLabel =
    metadata?.type === "film" ? "a film" :
    metadata?.type === "tv" ? "a TV show" :
    metadata?.type === "documentary" ? "a documentary" :
    metadata?.type === "sports" ? "a sports event" :
    metadata?.type === "concert" ? "a concert" :
    "something";

  let msg = `Hi! You're watching **${title}**${year}`;
  if (metadata?.type) msg += ` — ${typeLabel}`;
  if (director) msg += `${director}`;
  msg += ".";

  if (metadata?.plot) {
    const shortPlot = metadata.plot.length > 160
      ? metadata.plot.slice(0, 160).replace(/\s+\S*$/, "") + "..."
      : metadata.plot;
    msg += ` ${shortPlot}`;
  }

  msg += "\n\nAnything you'd like to know about it?";
  return msg;
}

function buildSystemPrompt(
  nowPlaying: NowPlaying | null,
  metadata: MediaMetadata | null,
  effort: Effort
): string {
  let context = "The viewer is watching content on Remote Viewer, a TV-like media scheduling system.\n\n";

  if (nowPlaying) {
    context += `CURRENTLY PLAYING:\n`;
    context += `- File: ${nowPlaying.relPath}\n`;
    context += `- Duration: ${Math.round(nowPlaying.durationSeconds / 60)} minutes\n`;
  }

  if (metadata) {
    if (metadata.title) context += `- Title: ${metadata.title}\n`;
    if (metadata.year) context += `- Year: ${metadata.year}\n`;
    if (metadata.releaseDate) context += `- Release Date: ${metadata.releaseDate}\n`;
    if (metadata.director) context += `- Director: ${metadata.director}\n`;
    if (metadata.type) context += `- Type: ${metadata.type}\n`;
    if (metadata.category) context += `- Genre: ${metadata.category}\n`;
    if (metadata.season) context += `- Season: ${metadata.season}\n`;
    if (metadata.episode) context += `- Episode: ${metadata.episode}\n`;
    if (metadata.plot) context += `- Plot: ${metadata.plot}\n`;
    if (metadata.makingOf) context += `- Production Notes: ${metadata.makingOf}\n`;
    if (metadata.tags?.length) context += `- Tags/Cast: ${metadata.tags.join(", ")}\n`;
  }

  return `You are an AI assistant embedded in a video player overlay. The viewer pressed a button to ask about what they're currently watching. Be friendly, concise, and conversational — this is a small chat overlay, not a documentation page.

You have access to web search for questions the metadata below can't answer — deeper plot details, cast bios, reviews, trivia, box office data, behind-the-scenes info, sequel/prequel info, or any factual question. When you use web search results, cite sources naturally.

ALWAYS check the metadata below FIRST before searching the web. Only search when the information isn't already available.

${EFFORT_CONFIG[effort].promptSuffix}

${context}`;
}

export default function PlayerChatOverlay({
  open,
  onClose,
  nowPlaying,
  metadata,
}: PlayerChatOverlayProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [effort, setEffort] = useState<Effort>("high");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastMediaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    fetch("/api/agent")
      .then((res) => res.json())
      .then((data) => setIsConfigured(data.configured))
      .catch(() => setIsConfigured(false));
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (open && isConfigured) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, isConfigured]);

  // Seed welcome message when overlay opens or media changes
  useEffect(() => {
    if (!open || !isConfigured) return;
    const mediaKey = nowPlaying?.relPath || null;

    if (mediaKey !== lastMediaRef.current) {
      lastMediaRef.current = mediaKey;
      const welcome: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: buildWelcomeMessage(nowPlaying, metadata),
        timestamp: new Date(),
      };
      setMessages([welcome]);
      setInput("");
      setError(null);
    }
  }, [open, isConfigured, nowPlaying, metadata]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    const assistantId = crypto.randomUUID();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", timestamp: new Date() },
    ]);

    try {
      const apiMessages = [...messages, userMessage]
        .filter((m) => !(m.role === "assistant" && m === messages[0] && messages.length === 1))
        .map((m) => ({ role: m.role, content: m.content }));

      const systemNote = buildSystemPrompt(nowPlaying, metadata, effort);
      const { maxTokens } = EFFORT_CONFIG[effort];

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: "gpt-4o",
          maxTokens,
          systemNote,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response body");

      let fullContent = "";
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event: StreamEvent = JSON.parse(line);
            if (event.type === "status" && event.status === "searching") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, isSearching: true } : m
                )
              );
            } else if (event.type === "text") {
              fullContent += event.delta;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: fullContent, isSearching: false }
                    : m
                )
              );
            }
          } catch {
            // skip malformed lines
          }
        }
      }

      if (!fullContent.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "Sorry, I couldn't generate a response. Please try again.", isSearching: false }
              : m
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, messages, nowPlaying, metadata, effort]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  if (!open) return null;

  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-2xl">
      <div className="flex items-center gap-3">
        <ModalTitle>Ask AI</ModalTitle>
        <select
          value={effort}
          onChange={(e) => setEffort(e.target.value as Effort)}
          className="h-7 rounded border border-white/15 bg-white/5 px-2 text-xs text-neutral-300 outline-none transition-colors hover:border-white/30 focus:border-emerald-500 cursor-pointer"
        >
          <option value="normal" className="bg-neutral-900 text-neutral-200">Normal</option>
          <option value="high" className="bg-neutral-900 text-neutral-200">High</option>
          <option value="extra" className="bg-neutral-900 text-neutral-200">Extra</option>
        </select>
      </div>

      {isConfigured === null ? (
        <div className="mt-4 flex justify-center py-8">
          <div className="size-6 rounded-full border-2 border-neutral-700 border-t-emerald-400 animate-spin" />
        </div>
      ) : !isConfigured ? (
        <div className="mt-4 flex flex-col items-center py-8 text-center">
          <div className="size-10 rounded-full bg-neutral-800 flex items-center justify-center mb-3">
            <svg className="size-5 text-neutral-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <p className="text-sm font-medium text-neutral-100 mb-1">AI Unavailable</p>
          <p className="text-xs text-neutral-500">OpenAI API key is not configured.</p>
        </div>
      ) : (
        <div className="mt-3 flex flex-col" style={{ maxHeight: "min(60vh, 500px)" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto min-h-0 space-y-3 pr-1">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-2 ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 size-6 rounded-full bg-emerald-500/20 flex items-center justify-center mt-0.5">
                    <svg className="size-3 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-md px-3 py-2 ${
                    message.role === "user"
                      ? "bg-emerald-600 text-neutral-100"
                      : "bg-white/10 text-neutral-100"
                  }`}
                >
                  <div className="prose prose-sm prose-invert max-w-none text-sm">
                    <ReactMarkdown
                      components={{
                        a: ({ node, ...props }) => (
                          <a {...props} className="text-blue-400 hover:text-blue-300 underline" target="_blank" rel="noopener noreferrer" />
                        ),
                        ul: ({ node, ...props }) => <ul {...props} className="list-disc list-inside my-1" />,
                        ol: ({ node, ...props }) => <ol {...props} className="list-decimal list-inside my-1" />,
                        code: ({ node, ...props }) => <code {...props} className="bg-neutral-700 px-1 py-0.5 rounded text-xs" />,
                        p: ({ node, ...props }) => <p {...props} className="my-1" />,
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  {message.isSearching && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="size-3 border-2 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
                      <span className="text-xs text-emerald-400">Searching the web...</span>
                    </div>
                  )}
                  {message.content === "" && isLoading && !message.isSearching && (
                    <div className="flex items-center gap-1 py-1">
                      <div className="size-1.5 bg-neutral-500 rounded-full animate-bounce" />
                      <div className="size-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                      <div className="size-1.5 bg-neutral-500 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                    </div>
                  )}
                  <p className="text-xs text-neutral-500 mt-1 tabular-nums">{formatTime(message.timestamp)}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Error */}
          {error && (
            <div className="mt-2">
              <div className="rounded-md border border-red-800 bg-red-950 px-3 py-2 flex items-start gap-2">
                <svg className="size-4 text-red-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-red-400">{error}</p>
              </div>
            </div>
          )}

          {/* Input */}
          <div className="mt-3 flex items-end gap-2">
            <label htmlFor="player-chat-input" className="sr-only">Message</label>
            <textarea
              id="player-chat-input"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this..."
              disabled={isLoading}
              rows={1}
              className="flex-1 resize-none h-10 rounded-md border border-white/15 bg-white/5 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none transition-colors duration-150 focus:border-emerald-500 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={sendMessage}
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 size-10 flex items-center justify-center rounded-md bg-emerald-600 text-neutral-100 transition-colors duration-150 hover:bg-emerald-500 disabled:opacity-40"
              aria-label="Send message"
            >
              {isLoading ? (
                <div className="size-4 border-2 border-neutral-100/30 border-t-neutral-100 rounded-full animate-spin" />
              ) : (
                <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                </svg>
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
