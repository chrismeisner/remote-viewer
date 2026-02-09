"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import {
  MEDIA_SOURCE_KEY,
  type MediaSource,
} from "@/constants/media";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

type AgentContext = {
  currentTime: string;
  currentTimeMs: number;
  timezone: string;
  source: string;
  mediaFilesTotal: number;
  totalMediaDurationSeconds: number;
  channels: {
    id: string;
    shortName?: string;
    active: boolean;
    type: "24hour" | "looping";
    scheduledCount: number;
    nowPlaying: { title?: string; relPath: string } | null;
  }[];
  formattedContext: string;
};

const AVAILABLE_MODELS = [
  // GPT-4o models (stable, recommended)
  { id: "gpt-4o", name: "GPT-4o", description: "Recommended - stable & capable" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", description: "Fast & affordable" },
  // GPT-5 models (latest)
  { id: "gpt-5", name: "GPT-5", description: "Latest flagship" },
  { id: "gpt-5-pro", name: "GPT-5 Pro", description: "Most capable, complex tasks" },
  { id: "gpt-5-mini", name: "GPT-5 Mini", description: "Fast & cost-efficient" },
  { id: "gpt-5-nano", name: "GPT-5 Nano", description: "Fastest, minimal reasoning" },
  // Legacy
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", description: "Legacy GPT-4" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", description: "Legacy, cheapest" },
];

const TOKEN_OPTIONS = [
  { value: 256, label: "Short (256)" },
  { value: 512, label: "Medium (512)" },
  { value: 1024, label: "Long (1K)" },
  { value: 2048, label: "Very Long (2K)" },
  { value: 4096, label: "Max (4K)" },
];

export default function AgentPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [maxTokens, setMaxTokens] = useState(1024);
  const [mediaSource, setMediaSource] = useState<MediaSource>("local");
  const [agentContext, setAgentContext] = useState<AgentContext | null>(null);
  const [loadingContext, setLoadingContext] = useState(false);
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

  // Load full application context (media, channels, schedules, now-playing)
  const loadContext = useCallback(async () => {
    setLoadingContext(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/agent/context?source=${encodeURIComponent(mediaSource)}&t=${Date.now()}`
      );
      if (!res.ok) throw new Error("Failed to load context");
      const data: AgentContext = await res.json();
      setAgentContext(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load context");
    } finally {
      setLoadingContext(false);
    }
  }, [mediaSource]);

  // Auto-load context when page is ready
  useEffect(() => {
    if (isConfigured && !agentContext && !loadingContext) {
      loadContext();
    }
  }, [isConfigured, agentContext, loadingContext, loadContext]);

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

    // Create placeholder for assistant response
    const assistantId = crypto.randomUUID();
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      // Build message history for API (excluding timestamps and ids)
      const apiMessages = [...messages, userMessage].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      // Include full application context if loaded
      const fullContext = agentContext?.formattedContext || null;

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          messages: apiMessages, 
          model: selectedModel,
          maxTokens,
          fullContext,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to get response");
      }

      // Handle streaming response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("No response body");
      }

      let fullContent = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        fullContent += chunk;

        // Update the assistant message with accumulated content
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: fullContent } : m
          )
        );
      }

      // Handle empty response
      if (!fullContent.trim()) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: "(No response received - try again or use a different model)" }
              : m
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      // Remove the empty assistant message on error
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  }, [input, isLoading, messages, selectedModel, maxTokens, agentContext]);

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

  // Loading state while checking configuration
  if (isConfigured === null) {
    return (
      <div className="flex flex-col gap-6 text-neutral-100">
        <div>
          <p className="text-sm uppercase  text-neutral-300">
            AI Agent
          </p>
          <p className="text-sm text-neutral-400">Checking configuration...</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="w-8 h-8 border-2 border-neutral-600 border-t-emerald-400 rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Not configured state
  if (!isConfigured) {
    return (
      <div className="flex flex-col gap-6 text-neutral-100">
        <div>
          <p className="text-sm uppercase  text-neutral-300">
            AI Agent
          </p>
          <p className="text-sm text-neutral-400">
            Chat with an AI assistant powered by OpenAI.
          </p>
        </div>
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <svg
                className="w-5 h-5 text-amber-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-amber-200 mb-2">
                OpenAI API Key Required
              </h3>
              <p className="text-sm text-neutral-300 mb-3">
                To use the AI Agent, you need to add your OpenAI API key to your
                environment variables.
              </p>
              <div className="bg-neutral-900 rounded-lg p-3 font-mono text-sm text-neutral-300">
                <p className="text-neutral-500"># Add to your .env.local file:</p>
                <p className="text-emerald-300">
                  OPENAI_API_KEY=sk-your-api-key-here
                </p>
              </div>
              <p className="text-xs text-neutral-500 mt-3">
                Get your API key from{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:underline"
                >
                  platform.openai.com/api-keys
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 text-neutral-100 h-[calc(100vh-8rem)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm uppercase  text-neutral-300">
            AI Agent
          </p>
          <p className="text-sm text-neutral-400">
            Chat with an AI assistant powered by OpenAI.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Context Load Button */}
          <button
            onClick={loadContext}
            disabled={loadingContext || isLoading}
            title={agentContext ? `${agentContext.mediaFilesTotal} files, ${agentContext.channels.length} channels` : "Load application context"}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
              agentContext
                ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-200"
                : "border-white/15 bg-white/5 text-neutral-300 hover:bg-white/10"
            }`}
          >
            {loadingContext ? (
              "Loading context..."
            ) : agentContext ? (
              <span className="flex items-center gap-1.5">
                <span>{agentContext.mediaFilesTotal} files</span>
                <span className="text-emerald-400/50">|</span>
                <span>{agentContext.channels.length} ch</span>
                <span className="text-emerald-400/50">|</span>
                <span>{agentContext.channels.filter(c => c.active).length} active</span>
              </span>
            ) : (
              `Load Context (${mediaSource})`
            )}
          </button>
          {/* Model Selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Model</label>
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              disabled={isLoading}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-400 disabled:opacity-50"
            >
              {AVAILABLE_MODELS.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
          {/* Token Limit Selector */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400">Max Tokens</label>
            <select
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              disabled={isLoading}
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-emerald-400 disabled:opacity-50"
            >
              {TOKEN_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <span className="rounded-full px-3 py-1 text-xs font-semibold bg-emerald-500/20 text-emerald-200">
            Connected
          </span>
        </div>
      </div>

      {/* Chat Container */}
      <div className="flex-1 flex flex-col rounded-md border border-white/10 bg-neutral-900/60 overflow-hidden">
        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-4">
                <svg
                  className="w-8 h-8 text-emerald-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-neutral-200 mb-2">
                Start a Conversation
              </h3>
              <p className="text-sm text-neutral-400 max-w-md">
                Ask me anything about your Remote Viewer setup, media management,
                scheduling, or general questions.
              </p>
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex gap-3 ${
                  message.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {message.role === "assistant" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-500/20 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-emerald-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
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
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                    message.role === "user"
                      ? "bg-blue-500/20 text-blue-50"
                      : "bg-white/5 text-neutral-100"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  {message.content === "" && isLoading && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce" />
                      <div
                        className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.1s" }}
                      />
                      <div
                        className="w-2 h-2 bg-neutral-400 rounded-full animate-bounce"
                        style={{ animationDelay: "0.2s" }}
                      />
                    </div>
                  )}
                  <p className="text-xs text-neutral-500 mt-1">
                    {formatTime(message.timestamp)}
                  </p>
                </div>
                {message.role === "user" && (
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <svg
                      className="w-4 h-4 text-blue-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                )}
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mx-4 mb-2 p-3 rounded-lg bg-red-500/20 border border-red-500/30 text-red-200 text-sm">
            {error}
          </div>
        )}

        {/* Input Area */}
        <div className="border-t border-white/10 bg-neutral-800/50 p-4">
          <div className="flex items-end gap-3">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={isLoading}
              rows={1}
              className="flex-1 resize-none rounded-md border border-white/15 bg-white/5 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-emerald-400 focus:bg-white/10 disabled:opacity-50"
              style={{ minHeight: "48px", maxHeight: "120px" }}
            />
            <div className="flex gap-2">
              {messages.length > 0 && (
                <button
                  onClick={clearChat}
                  disabled={isLoading}
                  className="rounded-md border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-neutral-300 transition hover:bg-white/10 disabled:opacity-50"
                  title="Clear chat"
                >
                  Clear
                </button>
              )}
              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="rounded-md bg-emerald-500 px-5 py-3 text-sm font-semibold text-neutral-900 transition hover:bg-emerald-400 disabled:opacity-50 disabled:hover:bg-emerald-500"
              >
                {isLoading ? (
                  <div className="w-5 h-5 border-2 border-neutral-900/30 border-t-neutral-900 rounded-full animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </div>
          <p className="text-xs text-neutral-500 mt-2">
            Press Enter to send, Shift+Enter for new line
          </p>
        </div>
      </div>
    </div>
  );
}
