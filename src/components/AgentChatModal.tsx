"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import {
  MEDIA_SOURCE_KEY,
  type MediaSource,
} from "@/constants/media";

// ─── Types ───────────────────────────────────────────────────────────

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

type AgentContext = {
  formattedContext: string;
  mediaFilesTotal: number;
  channels: { id: string; active: boolean }[];
};

type AgentChatModalProps = {
  open: boolean;
  onClose: () => void;
};

// ─── Component ───────────────────────────────────────────────────────

const MAX_TOKENS = 8192;

export default function AgentChatModal({ open, onClose }: AgentChatModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("remote");
  const [agentContext, setAgentContext] = useState<AgentContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync media source from localStorage (default "remote" matches rest of app)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
    if (stored === "local") {
      setMediaSource("local");
    }
  }, []);

  // Check if OpenAI is configured
  useEffect(() => {
    if (!open) return;
    fetch("/api/agent")
      .then((res) => res.json())
      .then((data) => setIsConfigured(data.configured))
      .catch(() => setIsConfigured(false));
  }, [open]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (open && isConfigured) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open, isConfigured]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open, onClose]);

  // Load full application context silently
  const loadContext = useCallback(async () => {
    setContextLoading(true);
    try {
      const res = await fetch(
        `/api/agent/context?source=${encodeURIComponent(mediaSource)}&t=${Date.now()}`
      );
      if (res.ok) {
        const data: AgentContext = await res.json();
        setAgentContext(data);
      }
    } catch {
      // Silently fail — context is supplementary
    } finally {
      setContextLoading(false);
    }
  }, [mediaSource]);

  // Auto-load context when modal opens and is ready
  useEffect(() => {
    if (open && isConfigured && !agentContext && !contextLoading) {
      loadContext();
    }
  }, [open, isConfigured, agentContext, contextLoading, loadContext]);

  // ─── Send message ────────────────────────────────────────────────

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
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      const apiMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const fullContext = agentContext?.formattedContext || null;

      const systemNote = `You are speaking to a visitor on the Remote Viewer landing page. You are friendly, enthusiastic, and concise.

When the visitor asks how this works, what Remote Viewer is, wants to see a demo, or expresses curiosity about the product, proactively offer a live demo by linking to the player page: [Try the live demo](/player)

You can also mention specific channels that are currently active and what's playing on them to make the demo feel tangible. For example: "We have X channels running right now — hop into the [live player](/player) to see what's on."

If they ask about specific movies or shows in the library, feel free to answer and mention they can watch them live on the player.

Keep answers short and conversational — this is a chat widget, not a documentation page.`;

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: "gpt-4o",
          maxTokens: MAX_TOKENS,
          fullContext,
          systemNote,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

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
            // Skip malformed lines
          }
        }
      }

      if (!fullContent.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    "Sorry, I couldn't generate a response. Please try again.",
                  isSearching: false,
                }
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
  }, [input, isLoading, messages, agentContext]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
    setError(null);
    inputRef.current?.focus();
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  if (!open) return null;

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-end sm:p-6 pointer-events-none">
      {/* Modal panel — full-screen on mobile, anchored panel on sm+ */}
      <div className="pointer-events-auto flex flex-col w-full sm:w-96 h-dvh sm:h-auto sm:max-h-[calc(100dvh-48px)] sm:min-h-80 rounded-none sm:rounded-md border-0 sm:border border-neutral-700 bg-neutral-900 shadow-xl overflow-hidden">
        {/* Header — pt uses safe-area for notched devices */}
        <div
          className="flex items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3"
          style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}
        >
          <div className="flex items-center gap-2">
            <div className="size-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg
                className="size-4 text-emerald-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium leading-none text-neutral-100">
                Remote Viewer Agent
              </p>
              {agentContext && (
                <p className="text-xs font-normal leading-normal text-neutral-500 mt-0.5 tabular-nums">
                  {agentContext.mediaFilesTotal} files &middot;{" "}
                  {agentContext.channels.length} channels &middot;{" "}
                  {(MAX_TOKENS / 1024).toFixed(0)}K tokens
                </p>
              )}
              {contextLoading && (
                <p className="text-xs font-normal leading-normal text-neutral-500 mt-0.5">
                  Loading context...
                </p>
              )}
              {!agentContext && !contextLoading && isConfigured && (
                <p className="text-xs font-normal leading-normal text-neutral-500 mt-0.5 tabular-nums">
                  {(MAX_TOKENS / 1024).toFixed(0)}K tokens
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={clearChat}
                disabled={isLoading}
                className="size-10 flex items-center justify-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-50"
                aria-label="Clear chat"
              >
                <svg
                  className="size-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="size-10 flex items-center justify-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-800 hover:text-neutral-100"
              aria-label="Close chat"
            >
              <svg
                className="size-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Messages area */}
        <div className="flex-1 overflow-y-auto">
          {isConfigured === null ? (
            <div className="flex flex-col items-center justify-center h-full">
              <div className="size-6 rounded-full border-2 border-neutral-700 border-t-emerald-400 animate-spin" />
            </div>
          ) : !isConfigured ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <div className="size-10 rounded-full bg-neutral-800 flex items-center justify-center mb-3">
                <svg
                  className="size-5 text-neutral-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>
              <p className="text-sm font-medium leading-none text-neutral-100 mb-1">
                Agent Unavailable
              </p>
              <p className="text-xs font-normal leading-normal text-neutral-500">
                OpenAI API key is not configured.
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center">
              <p className="text-sm font-normal leading-normal text-neutral-400">
                Ask about channels, schedules, what&apos;s playing, or anything
                about your media library.
              </p>
            </div>
          ) : (
            <div className="px-3 py-3 space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`flex gap-2 ${
                    message.role === "user" ? "justify-end" : "justify-start"
                  }`}
                >
                  {/* Assistant avatar */}
                  {message.role === "assistant" && (
                    <div className="flex-shrink-0 size-6 rounded-full bg-neutral-800 flex items-center justify-center mt-0.5">
                      <svg
                        className="size-3 text-emerald-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                        />
                      </svg>
                    </div>
                  )}

                  {/* Message bubble */}
                  <div
                    className={`max-w-[85%] rounded-md px-3 py-2 ${
                      message.role === "user"
                        ? "bg-emerald-600 text-neutral-100"
                        : "bg-neutral-800 text-neutral-100"
                    }`}
                  >
                    <div className="prose prose-sm prose-invert max-w-none text-sm">
                      <ReactMarkdown
                        components={{
                          a: ({ node, ...props }) => (
                            <a
                              {...props}
                              className="text-blue-400 hover:text-blue-300 underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            />
                          ),
                          ul: ({ node, ...props }) => (
                            <ul
                              {...props}
                              className="list-disc list-inside my-1"
                            />
                          ),
                          ol: ({ node, ...props }) => (
                            <ol
                              {...props}
                              className="list-decimal list-inside my-1"
                            />
                          ),
                          code: ({ node, ...props }) => (
                            <code
                              {...props}
                              className="bg-neutral-700 px-1 py-0.5 rounded text-xs"
                            />
                          ),
                          p: ({ node, ...props }) => (
                            <p {...props} className="my-1" />
                          ),
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                    {message.isSearching && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <div className="size-3 border-2 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
                        <span className="text-xs font-normal leading-normal text-emerald-400">
                          Searching...
                        </span>
                      </div>
                    )}
                    {message.content === "" &&
                      isLoading &&
                      !message.isSearching && (
                        <div className="flex items-center gap-1 py-1">
                          <div className="size-1.5 bg-neutral-500 rounded-full animate-bounce" />
                          <div
                            className="size-1.5 bg-neutral-500 rounded-full animate-bounce"
                            style={{ animationDelay: "0.1s" }}
                          />
                          <div
                            className="size-1.5 bg-neutral-500 rounded-full animate-bounce"
                            style={{ animationDelay: "0.2s" }}
                          />
                        </div>
                      )}
                    <p className="text-xs font-normal leading-normal text-neutral-500 mt-1 tabular-nums">
                      {formatTime(message.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Error banner */}
        {error && (
          <div className="mx-3 mb-2">
            <div className="rounded-md border border-red-800 bg-red-950 px-3 py-2 flex items-start gap-2">
              <svg
                className="size-4 text-red-400 mt-0.5 flex-shrink-0"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <p className="text-xs font-normal leading-normal text-red-400">
                {error}
              </p>
            </div>
          </div>
        )}

        {/* Input area — pb uses safe-area for notched devices */}
        {isConfigured && (
          <div
            className="border-t border-neutral-800 bg-neutral-900 px-3 pt-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-end gap-2">
              <label htmlFor="agent-modal-input" className="sr-only">
                Message
              </label>
              <textarea
                id="agent-modal-input"
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask a question..."
                disabled={isLoading}
                rows={1}
                className="flex-1 resize-none h-12 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-3 text-base sm:text-sm font-normal leading-normal text-neutral-100 placeholder:text-neutral-500 outline-none transition-colors duration-150 focus:border-emerald-500 disabled:opacity-50"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="flex-shrink-0 size-12 flex items-center justify-center rounded-md bg-emerald-600 text-neutral-100 transition-colors duration-150 hover:bg-emerald-500 disabled:opacity-40"
                aria-label="Send message"
              >
                {isLoading ? (
                  <div className="size-5 border-2 border-neutral-100/30 border-t-neutral-100 rounded-full animate-spin" />
                ) : (
                  <svg
                    className="size-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 19V5m0 0l-7 7m7-7l7 7"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
