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

// ─── Component ───────────────────────────────────────────────────────

export default function PublicAgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [agentContext, setAgentContext] = useState<AgentContext | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Sync media source from localStorage
  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(MEDIA_SOURCE_KEY);
    if (stored === "remote" || stored === "local") {
      setMediaSource(stored);
    }
  }, []);

  // Check if OpenAI is configured
  useEffect(() => {
    fetch("/api/agent")
      .then((res) => res.json())
      .then((data) => setIsConfigured(data.configured))
      .catch(() => setIsConfigured(false));
  }, []);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input on load
  useEffect(() => {
    if (isConfigured) {
      inputRef.current?.focus();
    }
  }, [isConfigured]);

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

  // Auto-load context when page is ready
  useEffect(() => {
    if (isConfigured && !agentContext && !contextLoading) {
      loadContext();
    }
  }, [isConfigured, agentContext, contextLoading, loadContext]);

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

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: apiMessages,
          model: "gpt-4o",
          maxTokens: 4096,
          fullContext,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      // Handle NDJSON streaming response
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
        buffer = lines.pop() || ""; // Keep incomplete line in buffer

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

      // Handle empty response
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

  // ─── Loading skeleton ────────────────────────────────────────────

  if (isConfigured === null) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16">
        <div className="size-8 rounded-full border-2 border-neutral-700 border-t-emerald-400 animate-spin" />
        <p className="text-sm font-normal leading-normal text-neutral-500 mt-4">
          Loading...
        </p>
      </div>
    );
  }

  // ─── Not configured ──────────────────────────────────────────────

  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16">
        <div className="size-12 rounded-full bg-neutral-800 flex items-center justify-center mb-4">
          <svg
            className="size-6 text-neutral-500"
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
        <p className="text-lg font-medium leading-snug text-neutral-100 mb-2 text-balance">
          Agent Unavailable
        </p>
        <p className="text-sm font-normal leading-normal text-neutral-500 text-center max-w-xs">
          The AI agent is not configured yet. Please contact the administrator.
        </p>
      </div>
    );
  }

  // ─── Chat UI ─────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-[calc(100dvh-60px)]">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full px-4 text-center">
            <div className="size-12 rounded-full bg-neutral-800 flex items-center justify-center mb-4">
              <svg
                className="size-6 text-emerald-400"
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
            <h1 className="text-lg font-medium leading-snug text-neutral-100 mb-2 text-balance">
              Remote Viewer Agent
            </h1>
            <p className="text-sm font-normal leading-normal text-neutral-500 max-w-xs text-pretty">
              Ask about channels, schedules, what&apos;s playing now, or anything about your media library.
            </p>

            {/* Context status pill */}
            {agentContext && (
              <div className="mt-6 flex items-center gap-2 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-2">
                <span className="size-2 rounded-full bg-emerald-400" aria-hidden="true" />
                <span className="text-xs font-normal leading-normal text-neutral-400">
                  <span className="tabular-nums">{agentContext.mediaFilesTotal}</span> files
                  <span className="mx-1 text-neutral-600">&middot;</span>
                  <span className="tabular-nums">{agentContext.channels.length}</span> channels
                  <span className="mx-1 text-neutral-600">&middot;</span>
                  <span className="tabular-nums">{agentContext.channels.filter(c => c.active).length}</span> active
                </span>
              </div>
            )}

            {contextLoading && (
              <div className="mt-6 flex items-center gap-2">
                <div className="size-4 rounded-full border-2 border-neutral-700 border-t-emerald-400 animate-spin" />
                <span className="text-xs font-normal leading-normal text-neutral-500">
                  Loading context...
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="max-w-2xl mx-auto w-full px-4 py-4 space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {/* Assistant avatar */}
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 size-8 rounded-full bg-neutral-800 flex items-center justify-center mt-1">
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
                        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                )}

                {/* Message bubble */}
                <div
                  className={`max-w-[85%] sm:max-w-[75%] rounded-md px-3 py-2 ${
                    message.role === "user"
                      ? "bg-emerald-600 text-neutral-100"
                      : "bg-neutral-800 text-neutral-100"
                  }`}
                >
                  <div className="prose prose-sm prose-invert max-w-none">
                    <ReactMarkdown
                      components={{
                        // Style links to be clickable and distinct
                        a: ({ node, ...props }) => (
                          <a
                            {...props}
                            className="text-blue-400 hover:text-blue-300 underline"
                            target="_blank"
                            rel="noopener noreferrer"
                          />
                        ),
                        // Keep list styling consistent
                        ul: ({ node, ...props }) => (
                          <ul {...props} className="list-disc list-inside my-2" />
                        ),
                        ol: ({ node, ...props }) => (
                          <ol {...props} className="list-decimal list-inside my-2" />
                        ),
                        // Inline code styling
                        code: ({ node, ...props }) => (
                          <code {...props} className="bg-neutral-700 px-1 py-0.5 rounded text-xs" />
                        ),
                        // Paragraphs with spacing
                        p: ({ node, ...props }) => (
                          <p {...props} className="my-1" />
                        ),
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  </div>
                  {message.isSearching && (
                    <div className="flex items-center gap-2 mt-1">
                      <div className="size-4 border-2 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
                      <span className="text-xs font-normal leading-normal text-emerald-400">
                        Searching the web...
                      </span>
                    </div>
                  )}
                  {message.content === "" && isLoading && !message.isSearching && (
                    <div className="flex items-center gap-1 py-1">
                      <div className="size-2 bg-neutral-500 rounded-full animate-bounce" />
                      <div
                        className="size-2 bg-neutral-500 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <div
                        className="size-2 bg-neutral-500 rounded-full animate-bounce"
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
        <div className="mx-4 mb-2 max-w-2xl sm:mx-auto sm:w-full">
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
            <p className="text-sm font-normal leading-normal text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-neutral-800 bg-neutral-900 p-3 sm:p-4">
        <div className="max-w-2xl mx-auto flex items-end gap-2">
          <label htmlFor="agent-chat-input" className="sr-only">
            Message
          </label>
          <textarea
            id="agent-chat-input"
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about channels, media, schedules..."
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none h-12 rounded-md border border-neutral-700 bg-neutral-800 px-4 py-3 text-sm font-normal leading-normal text-neutral-100 placeholder:text-neutral-500 outline-none transition-colors duration-150 focus:border-emerald-500 disabled:opacity-50"
          />
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              disabled={isLoading}
              aria-label="Clear chat"
              className="flex-shrink-0 size-12 flex items-center justify-center rounded-md border border-neutral-700 bg-neutral-800 text-neutral-400 transition-colors duration-150 hover:bg-neutral-700 hover:text-neutral-100 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
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
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
            </button>
          )}
          <button
            type="button"
            onClick={sendMessage}
            disabled={!input.trim() || isLoading}
            className="flex-shrink-0 size-12 flex items-center justify-center rounded-md bg-emerald-600 text-neutral-100 transition-colors duration-150 hover:bg-emerald-500 disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
    </div>
  );
}
