import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Readability } from "@mozilla/readability";
import DOMPurify from "dompurify";
import ReactMarkdown from "react-markdown";
import { getOllamaSettings, type OllamaSettings } from "../lib/settings";

type Props = {
  url: string;
  title: string | null;
  onClose: () => void;
};

type ExtractResult =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "ok"; title: string; byline: string | null; siteName: string | null; content: string };

type SpeechState = "idle" | "playing" | "paused";

type SpeechControls = {
  state: SpeechState;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
};

type SummarizeState = "idle" | "loading" | "done" | "error";

type ChatMessageEntry = { role: "user" | "assistant"; content: string };

type ChatControls = {
  open: boolean;
  onToggle: () => void;
};

type SummarizeControls = {
  state: SummarizeState;
  onSummarize: () => void;
};

type ReaderSettings = {
  theme: "light" | "sepia" | "slate" | "dark";
  fontFamily: "sans" | "serif" | "mono";
  fontSize: number;
  columnWidth: "narrow" | "medium" | "wide";
  lineHeight: "compact" | "normal" | "roomy";
  onChangeTheme: (t: "light" | "sepia" | "slate" | "dark") => void;
  onChangeFontFamily: (f: "sans" | "serif" | "mono") => void;
  onChangeFontSize: (s: number) => void;
  onChangeColumnWidth: (w: "narrow" | "medium" | "wide") => void;
  onChangeLineHeight: (lh: "compact" | "normal" | "roomy") => void;
};

function isYouTubeWatch(url: string): boolean {
  try {
    const p = new URL(url);
    return (p.hostname === "www.youtube.com" || p.hostname === "youtube.com") &&
      p.pathname === "/watch" && !!p.searchParams.get("v");
  } catch { return false; }
}

function toYouTubeEmbed(url: string): string {
  const videoId = new URL(url).searchParams.get("v")!;
  return `https://www.youtube.com/embed/${videoId}?autoplay=1`;
}

function getParagraphs(html: string): string[] {
  if (typeof window === "undefined") return [];
  const doc = new DOMParser().parseFromString(html, "text/html");
  const elements = doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
  const paragraphs: string[] = [];
  elements.forEach((el) => {
    const text = el.textContent?.trim();
    if (text) paragraphs.push(text);
  });
  if (paragraphs.length === 0) {
    const fallback = doc.body.textContent?.trim();
    if (fallback) paragraphs.push(fallback);
  }
  return paragraphs;
}

function tagParagraphsForTts(html: string): string {
  if (typeof window === "undefined") return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const elements = doc.body.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li");
  let idx = 0;
  elements.forEach((el) => {
    if (el.textContent?.trim()) el.setAttribute("data-tts-idx", String(idx++));
  });
  return doc.body.innerHTML;
}

function b64ToAudioUrl(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

// ─── PaneHeader ───────────────────────────────────────────────────────────────

function PaneHeader({ title, url, onClose, speech, summarize, chat, settings }: {
  title: string | null; url: string; onClose: () => void;
  speech?: SpeechControls; summarize?: SummarizeControls; chat?: ChatControls; settings?: ReaderSettings;
}) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsDropdownOpen(false);
    }
    if (isDropdownOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();

  return (
    <div className="flex items-center gap-3 border-b border-reader-border bg-reader-header-bg px-4 py-3 shrink-0 text-reader-text transition-colors duration-200">
      <button onClick={onClose} aria-label="Close article pane"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text">
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <div className="flex min-w-0 flex-1 flex-col">
        {title && <span className="truncate text-[12px] font-headline font-semibold leading-tight">{title}</span>}
        <span className="truncate text-[9px] font-label uppercase tracking-widest text-reader-text-muted">{domain}</span>
      </div>

      {/* Summarize button */}
      {summarize && (
        <button
          onClick={summarize.state === "idle" || summarize.state === "error" ? summarize.onSummarize : undefined}
          disabled={summarize.state === "loading"}
          aria-label="Summarize article"
          title="Summarize with Ollama"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text disabled:opacity-40"
        >
          {summarize.state === "loading" ? (
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
                d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          )}
        </button>
      )}

      {/* Chat button */}
      {chat && (
        <button
          onClick={chat.onToggle}
          aria-label="Ask about article"
          title="Ask about this article"
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text ${chat.open ? "bg-reader-hover text-reader-text" : ""}`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </button>
      )}

      {/* TTS controls */}
      {speech && (
        <div className="flex items-center gap-1">
          {speech.state === "playing" ? (
            <button onClick={speech.onPause} aria-label="Pause"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text">
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>
          ) : (
            <button onClick={speech.onPlay} aria-label="Listen"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text">
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
          {speech.state !== "idle" && (
            <button onClick={speech.onStop} aria-label="Stop"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text">
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 6h12v12H6z" />
              </svg>
            </button>
          )}
        </div>
      )}

      {/* Reader settings */}
      {settings && (
        <div className="relative" ref={dropdownRef}>
          <button onClick={() => setIsDropdownOpen(!isDropdownOpen)} aria-label="Reader settings"
            className={`flex h-7 w-7 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text ${isDropdownOpen ? "bg-reader-hover text-reader-text" : ""}`}>
            <span className="font-headline text-[13px] font-bold">Aa</span>
          </button>
          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-lg border border-reader-border bg-reader-header-bg p-4 shadow-xl z-50 text-reader-text">
              <h4 className="text-[10px] font-label font-bold uppercase tracking-wider text-reader-text-muted mb-3">Display settings</h4>
              <div className="mb-4">
                <span className="block text-[11px] text-reader-text-muted mb-2">Theme</span>
                <div className="flex gap-2">
                  {[{ id: "light", label: "Light", bg: "bg-[#fdfcf7] text-[#1c1c11] border-gray-300" },
                    { id: "sepia", label: "Sepia", bg: "bg-[#f4ecd8] text-[#5b4636] border-[#eadfca]" },
                    { id: "slate", label: "Slate", bg: "bg-[#f1f3f5] text-[#212529] border-gray-300" },
                    { id: "dark", label: "Dark", bg: "bg-[#121212] text-[#e0e0e0] border-zinc-800" }].map((t) => (
                    <button key={t.id} onClick={() => settings.onChangeTheme(t.id as "light" | "sepia" | "slate" | "dark")}
                      className={`relative flex h-8 w-8 items-center justify-center rounded-full border transition-all ${t.bg} ${settings.theme === t.id ? "ring-2 ring-reader-primary ring-offset-2 ring-offset-reader-bg scale-105 border-transparent" : "hover:scale-105"}`}>
                      <span className="text-[10px] font-bold">{t.label[0]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <span className="block text-[11px] text-reader-text-muted mb-2">Font</span>
                <div className="grid grid-cols-3 gap-1">
                  {[{ id: "sans", label: "Sans" }, { id: "serif", label: "Serif" }, { id: "mono", label: "Mono" }].map((f) => (
                    <button key={f.id} onClick={() => settings.onChangeFontFamily(f.id as "sans" | "serif" | "mono")}
                      className={`rounded px-2 py-1.5 text-center text-xs border transition-all ${settings.fontFamily === f.id ? "bg-reader-primary text-white border-transparent font-bold" : "border-reader-border hover:bg-reader-hover"}`}>
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-4">
                <span className="block text-[11px] text-reader-text-muted mb-2">Font Size</span>
                <div className="flex items-center justify-between gap-2 border border-reader-border rounded p-1">
                  <button onClick={() => settings.onChangeFontSize(Math.max(settings.fontSize - 1, 12))} disabled={settings.fontSize <= 12}
                    className="flex h-7 w-12 items-center justify-center rounded text-xs font-bold transition-colors hover:bg-reader-hover disabled:opacity-30">A−</button>
                  <span className="text-xs font-bold">{settings.fontSize}px</span>
                  <button onClick={() => settings.onChangeFontSize(Math.min(settings.fontSize + 1, 22))} disabled={settings.fontSize >= 22}
                    className="flex h-7 w-12 items-center justify-center rounded text-xs font-bold transition-colors hover:bg-reader-hover disabled:opacity-30">A+</button>
                </div>
              </div>
              <div className="mb-4">
                <span className="block text-[11px] text-reader-text-muted mb-2">Width</span>
                <div className="grid grid-cols-3 gap-1">
                  {[{ id: "narrow", label: "Narrow" }, { id: "medium", label: "Medium" }, { id: "wide", label: "Wide" }].map((w) => (
                    <button key={w.id} onClick={() => settings.onChangeColumnWidth(w.id as "narrow" | "medium" | "wide")}
                      className={`rounded py-1 text-center text-xs border transition-all ${settings.columnWidth === w.id ? "bg-reader-primary text-white border-transparent font-bold" : "border-reader-border hover:bg-reader-hover"}`}>
                      {w.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="block text-[11px] text-reader-text-muted mb-2">Spacing</span>
                <div className="grid grid-cols-3 gap-1">
                  {[{ id: "compact", label: "Compact" }, { id: "normal", label: "Normal" }, { id: "roomy", label: "Roomy" }].map((lh) => (
                    <button key={lh.id} onClick={() => settings.onChangeLineHeight(lh.id as "compact" | "normal" | "roomy")}
                      className={`rounded py-1 text-center text-xs border transition-all ${settings.lineHeight === lh.id ? "bg-reader-primary text-white border-transparent font-bold" : "border-reader-border hover:bg-reader-hover"}`}>
                      {lh.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <button onClick={() => openUrl(url)} aria-label="Open in browser"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </button>
    </div>
  );
}

function ChatPanel({
  messages,
  loading,
  suggestions,
  suggestionsLoading,
  onSend,
  onClose,
  model,
}: {
  messages: ChatMessageEntry[];
  loading: boolean;
  suggestions: string[];
  suggestionsLoading: boolean;
  onSend: (q: string) => void;
  onClose: () => void;
  model: string;
}) {
  const [input, setInput] = useState("");
  const [panelHeight, setPanelHeight] = useState(480);
  const isDragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, suggestions]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function onDragHandleMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    isDragging.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = panelHeight;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";

    function onMouseMove(ev: MouseEvent) {
      if (!isDragging.current) return;
      const delta = dragStartY.current - ev.clientY;
      const next = Math.min(Math.max(dragStartHeight.current + delta, 200), window.innerHeight * 0.8);
      setPanelHeight(next);
    }

    function onMouseUp() {
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    onSend(q);
  }

  function handleSuggestion(q: string) {
    onSend(q);
  }

  return (
    <div className="flex flex-col border-t border-reader-border bg-reader-bg" style={{ height: `${panelHeight}px` }}>
      {/* Drag handle */}
      <div
        onMouseDown={onDragHandleMouseDown}
        className="flex items-center justify-center h-3 shrink-0 cursor-ns-resize hover:bg-reader-hover/60 transition-colors group"
        aria-label="Drag to resize"
      >
        <div className="w-8 h-1 rounded-full bg-reader-border group-hover:bg-reader-text-muted transition-colors" />
      </div>

      {/* Chat header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-reader-border shrink-0">
        <span className="text-[10px] font-label font-bold uppercase tracking-widest text-reader-text-muted">
          Ask · {model}
        </span>
        <button onClick={onClose} aria-label="Close chat"
          className="flex h-6 w-6 items-center justify-center rounded text-reader-text-muted hover:bg-reader-hover hover:text-reader-text transition-colors">
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0">
        {messages.length === 0 && !loading && suggestions.length === 0 && !suggestionsLoading && (
          <p className="text-sm text-reader-text-muted text-center pt-6">
            Ask a question about this article.
          </p>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-reader-primary text-white"
                : "bg-reader-hover text-reader-text border border-reader-border"
            }`}>
              {msg.role === "user" ? msg.content : (
                <ReactMarkdown
                  components={{
                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                    ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
                    ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                    h1: ({ children }) => <p className="font-bold mb-1.5">{children}</p>,
                    h2: ({ children }) => <p className="font-bold mb-1.5">{children}</p>,
                    h3: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
                    code: ({ children }) => <code className="bg-reader-bg rounded px-1 font-mono text-xs">{children}</code>,
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-reader-hover border border-reader-border rounded-xl px-4 py-3">
              <span className="flex gap-1.5 items-center h-4">
                <span className="w-2 h-2 rounded-full bg-reader-text-muted animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 rounded-full bg-reader-text-muted animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 rounded-full bg-reader-text-muted animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}

        {/* Suggested questions */}
        {!loading && (suggestions.length > 0 || suggestionsLoading) && (
          <div className="flex flex-col gap-2 pt-1">
            {suggestionsLoading && suggestions.length === 0 && (
              <div className="flex flex-col gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 w-3/4 rounded-full bg-reader-hover animate-pulse" />
                ))}
              </div>
            )}
            {suggestions.map((q, i) => (
              <button
                key={i}
                onClick={() => handleSuggestion(q)}
                className="self-start text-left rounded-full border border-reader-border bg-reader-hover px-4 py-1.5 text-sm text-reader-text-muted hover:bg-reader-primary hover:text-white hover:border-transparent transition-colors leading-snug"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex items-center gap-2 px-4 py-3 border-t border-reader-border shrink-0">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          disabled={loading}
          className="flex-1 bg-reader-hover border border-reader-border rounded-full px-4 py-2 text-sm text-reader-text placeholder:text-reader-text-muted outline-none focus:ring-1 focus:ring-reader-primary disabled:opacity-50 transition-colors"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-reader-primary text-white disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
          </svg>
        </button>
      </form>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-8 animate-pulse">
      <div className="h-6 w-3/4 rounded bg-reader-hover" />
      <div className="h-3 w-1/3 rounded bg-reader-hover" />
      <div className="mt-4 flex flex-col gap-3">
        {[100, 95, 88, 100, 72, 90, 60].map((w, i) => (
          <div key={i} className="h-3 rounded bg-reader-hover" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ArticlePane({ url, title, onClose }: Props) {
  const [result, setResult] = useState<ExtractResult>({ state: "loading" });
  const [theme, setTheme] = useState<"light" | "sepia" | "slate" | "dark">("light");
  const [fontFamily, setFontFamily] = useState<"sans" | "serif" | "mono">("sans");
  const [fontSize, setFontSize] = useState(14);
  const [columnWidth, setColumnWidth] = useState<"narrow" | "medium" | "wide">("medium");
  const [lineHeight, setLineHeight] = useState<"compact" | "normal" | "roomy">("normal");

  // TTS state
  const [speechState, setSpeechState] = useState<SpeechState>("idle");
  const [currentParagraphIndex, setCurrentParagraphIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPlayingRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const articleContentRef = useRef<HTMLDivElement>(null);

  // Ollama summarize state
  const [ollamaSettings, setOllamaSettings] = useState<OllamaSettings | null>(null);
  const [summarizeState, setSummarizeState] = useState<SummarizeState>("idle");
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessageEntry[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const isYT = isYouTubeWatch(url);

  const paragraphs = useMemo(() => {
    if (result.state !== "ok") return [];
    return [result.title, ...getParagraphs(result.content)];
  }, [result]);

  const taggedContent = useMemo(() => {
    if (result.state !== "ok") return "";
    return tagParagraphsForTts(result.content);
  }, [result]);

  useEffect(() => {
    titleRef.current?.classList.remove("tts-active");
    articleContentRef.current?.querySelectorAll(".tts-active").forEach((el) => {
      el.classList.remove("tts-active");
    });

    if (currentParagraphIndex === null) return;

    let target: HTMLElement | null = null;
    if (currentParagraphIndex === 0) {
      target = titleRef.current;
    } else {
      target = articleContentRef.current?.querySelector(
        `[data-tts-idx="${currentParagraphIndex - 1}"]`
      ) as HTMLElement | null;
    }

    if (target) {
      target.classList.add("tts-active");
      target.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentParagraphIndex]);

  useEffect(() => {
    const el = articleContentRef.current;
    if (!el) return;
    const handler = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (anchor?.href) {
        e.preventDefault();
        openUrl(anchor.href);
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [taggedContent]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("focal:reader-settings");
      if (saved) {
        const p = JSON.parse(saved);
        if (p.theme) setTheme(p.theme);
        if (p.fontFamily) setFontFamily(p.fontFamily);
        if (p.fontSize) setFontSize(p.fontSize);
        if (p.columnWidth) setColumnWidth(p.columnWidth);
        if (p.lineHeight) setLineHeight(p.lineHeight);
      }
    } catch { /* ignore */ }
  }, []);

  const saveSettings = useMemo(() => (updates: Partial<{ theme: typeof theme; fontFamily: typeof fontFamily; fontSize: number; columnWidth: typeof columnWidth; lineHeight: typeof lineHeight }>) => {
    try {
      const current = { theme, fontFamily, fontSize, columnWidth, lineHeight, ...updates };
      localStorage.setItem("focal:reader-settings", JSON.stringify(current));
    } catch { /* ignore */ }
  }, [theme, fontFamily, fontSize, columnWidth, lineHeight]);

  useEffect(() => {
    getOllamaSettings().then(setOllamaSettings).catch(console.error);
  }, []);

  // Reset per-article state on URL change
  useEffect(() => {
    stopSpeech();
    setSummarizeState("idle");
    setSummary(null);
    setSummaryError(null);
    setChatOpen(false);
    setChatMessages([]);
    setChatLoading(false);
    setSuggestions([]);
    setSuggestionsLoading(false);
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (isYT) return;
    setResult({ state: "loading" });
    invoke<string>("fetch_article_html", { url })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        // Set base URL so relative links resolve correctly
        const base = doc.createElement("base");
        base.href = url;
        doc.head.appendChild(base);

        const article = new Readability(doc).parse();
        if (!article) {
          setResult({ state: "error", message: "Could not extract article content" });
          return;
        }
        setResult({
          state: "ok",
          title: article.title || article.excerpt || "",
          byline: article.byline ?? null,
          siteName: article.siteName ?? null,
          content: DOMPurify.sanitize(article.content ?? ""),
        });
      })
      .catch((err) => {
        setResult({ state: "error", message: String(err) });
      });
  }, [url, isYT]);

  // ── TTS handlers ────────────────────────────────────────────────────────────

  function stopSpeech() {
    isPlayingRef.current = false;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setSpeechState("idle");
    setCurrentParagraphIndex(null);
  }

  async function playParagraph(index: number) {
    if (index >= paragraphs.length) { stopSpeech(); return; }

    setCurrentParagraphIndex(index);
    setSpeechState("playing");
    isPlayingRef.current = true;

    try {
      const b64 = await invoke<string>("synthesize_speech", { text: paragraphs[index] });
      if (!isPlayingRef.current) return;

      const audioUrl = b64ToAudioUrl(b64);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        if (isPlayingRef.current) playParagraph(index + 1);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(audioUrl);
        if (isPlayingRef.current) playParagraph(index + 1);
      };

      if (isPlayingRef.current) await audio.play();
      else URL.revokeObjectURL(audioUrl);
    } catch (err) {
      console.error("TTS error:", err);
      if (isPlayingRef.current) playParagraph(index + 1);
      else stopSpeech();
    }
  }

  function pauseSpeech() {
    isPlayingRef.current = false;
    audioRef.current?.pause();
    setSpeechState("paused");
  }

  function resumeSpeech() {
    setSpeechState("playing");
    isPlayingRef.current = true;
    if (audioRef.current) {
      audioRef.current.play().catch(() => stopSpeech());
    } else {
      playParagraph(currentParagraphIndex ?? 0);
    }
  }

  // ── Controls objects ────────────────────────────────────────────────────────

  const settingsControls: ReaderSettings = {
    theme, fontFamily, fontSize, columnWidth, lineHeight,
    onChangeTheme: (t) => { setTheme(t); saveSettings({ theme: t }); },
    onChangeFontFamily: (f) => { setFontFamily(f); saveSettings({ fontFamily: f }); },
    onChangeFontSize: (s) => { setFontSize(s); saveSettings({ fontSize: s }); },
    onChangeColumnWidth: (w) => { setColumnWidth(w); saveSettings({ columnWidth: w }); },
    onChangeLineHeight: (lh) => { setLineHeight(lh); saveSettings({ lineHeight: lh }); },
  };

  const speechControls: SpeechControls | undefined =
    result.state === "ok" && paragraphs.length > 0
      ? {
          state: speechState,
          onPlay: () => speechState === "paused" ? resumeSpeech() : playParagraph(0),
          onPause: pauseSpeech,
          onStop: stopSpeech,
        }
      : undefined;

  async function handleSummarize() {
    if (!ollamaSettings || result.state !== "ok") return;
    setSummarizeState("loading");
    setSummary(null);
    setSummaryError(null);
    const text = getParagraphs(result.content).join(" ");
    try {
      const out = await invoke<string>("summarize_article", {
        baseUrl: ollamaSettings.url,
        model: ollamaSettings.model,
        text,
      });
      setSummary(out);
      setSummarizeState("done");
    } catch (err) {
      setSummaryError(String(err));
      setSummarizeState("error");
    }
  }

  const summarizeControls: SummarizeControls | undefined =
    !isYT && result.state === "ok" && ollamaSettings?.enabled
      ? { state: summarizeState, onSummarize: handleSummarize }
      : undefined;

  async function fetchSuggestions(articleText: string, history: ChatMessageEntry[]) {
    if (!ollamaSettings) return;
    setSuggestionsLoading(true);
    setSuggestions([]);
    try {
      const qs = await invoke<string[]>("suggest_questions", {
        baseUrl: ollamaSettings.url,
        model: ollamaSettings.model,
        articleText,
        history: history.map((m) => ({ role: m.role, content: m.content })),
      });
      setSuggestions(qs);
    } catch {
      setSuggestions([]);
    } finally {
      setSuggestionsLoading(false);
    }
  }

  async function handleChatSend(question: string) {
    if (!ollamaSettings || result.state !== "ok") return;
    const articleText = getParagraphs(result.content).join(" ");
    const newMessages: ChatMessageEntry[] = [...chatMessages, { role: "user", content: question }];
    setChatMessages(newMessages);
    setChatLoading(true);
    setSuggestions([]);
    try {
      const historyForApi = chatMessages.map((m) => ({ role: m.role, content: m.content }));
      const answer = await invoke<string>("chat_article", {
        baseUrl: ollamaSettings.url,
        model: ollamaSettings.model,
        articleText,
        history: historyForApi,
        question,
      });
      const finalMessages: ChatMessageEntry[] = [...newMessages, { role: "assistant", content: answer }];
      setChatMessages(finalMessages);
      fetchSuggestions(articleText, finalMessages);
    } catch (err) {
      setChatMessages([...newMessages, { role: "assistant", content: `Error: ${String(err)}` }]);
    } finally {
      setChatLoading(false);
    }
  }

  const chatControls: ChatControls | undefined =
    !isYT && result.state === "ok" && ollamaSettings?.enabled
      ? {
          open: chatOpen,
          onToggle: () => {
            if (!chatOpen && chatMessages.length === 0 && result.state === "ok") {
              const articleText = getParagraphs(result.content).join(" ");
              fetchSuggestions(articleText, []);
            }
            setChatOpen((o) => !o);
          },
        }
      : undefined;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden="true" />
      <div className={`fixed right-0 top-0 bottom-0 z-50 flex w-full flex-col border-l shadow-2xl sm:w-[65vw] xl:w-[58vw] reader-theme-${theme} bg-reader-bg border-reader-border text-reader-text transition-colors duration-200`}>
        <PaneHeader
          title={result.state === "ok" ? result.title : title}
          url={url}
          onClose={onClose}
          speech={speechControls}
          summarize={summarizeControls}
          chat={chatControls}
          settings={isYT ? undefined : settingsControls}
        />
        <div className="flex-1 overflow-y-auto min-h-0">
          {isYT ? (
            <iframe key={url} src={toYouTubeEmbed(url)} className="h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen title={title ?? "Video"} />
          ) : result.state === "loading" ? (
            <LoadingSkeleton />
          ) : result.state === "error" ? (
            <div className="flex flex-col items-center justify-center gap-4 p-12 text-center text-reader-text">
              <p className="text-[12px] font-label text-reader-text-muted uppercase tracking-widest">{result.message}</p>
              <button onClick={() => openUrl(url)}
                className="border border-reader-border hover:bg-reader-hover px-4 py-2 text-[11px] font-label font-bold uppercase tracking-widest transition-colors">
                Open in browser ↗
              </button>
            </div>
          ) : (
            <div className={`px-8 py-10 mx-auto transition-all ${columnWidth === "narrow" ? "max-w-md" : columnWidth === "wide" ? "max-w-5xl" : "max-w-2xl"} ${fontFamily === "sans" ? "font-reader-sans" : fontFamily === "mono" ? "font-reader-mono" : "font-reader-serif"} ${lineHeight === "compact" ? "leading-normal" : lineHeight === "roomy" ? "leading-loose" : "leading-relaxed"}`}>
              {/* Summary card */}
              {summarizeState === "loading" && (
                <div className="mb-6 rounded border border-reader-border bg-reader-hover/40 px-5 py-4 animate-pulse">
                  <div className="h-3 w-1/3 rounded bg-reader-hover mb-3" />
                  <div className="space-y-2">
                    <div className="h-2.5 rounded bg-reader-hover w-full" />
                    <div className="h-2.5 rounded bg-reader-hover w-5/6" />
                    <div className="h-2.5 rounded bg-reader-hover w-4/6" />
                  </div>
                </div>
              )}
              {summarizeState === "done" && summary && (
                <div className="mb-6 rounded border border-reader-border bg-reader-hover/40 px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-label font-bold uppercase tracking-widest text-reader-text-muted">
                      Summary · {ollamaSettings?.model}
                    </span>
                    <button
                      onClick={() => { setSummarizeState("idle"); setSummary(null); }}
                      className="text-reader-text-muted hover:text-reader-text transition-colors"
                      aria-label="Dismiss summary"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <p className="text-sm font-body leading-relaxed text-reader-text">{summary}</p>
                </div>
              )}
              {summarizeState === "error" && summaryError && (
                <div className="mb-6 rounded border border-reader-border bg-reader-hover/40 px-5 py-4">
                  <p className="text-[11px] font-body text-reader-text-muted">
                    Could not summarize: {summaryError}
                  </p>
                </div>
              )}

              <h1 ref={titleRef} className="text-2xl font-headline font-bold leading-snug mb-3">{result.title}</h1>
              {(result.byline || result.siteName) && (
                <p className="text-[10px] font-label uppercase tracking-widest text-reader-text-muted mb-8">
                  {[result.byline, result.siteName].filter(Boolean).join(" · ")}
                </p>
              )}
              <div ref={articleContentRef} className="article-content" style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: taggedContent }} />
            </div>
          )}
        </div>
        {chatOpen && chatControls && ollamaSettings && (
          <ChatPanel
            messages={chatMessages}
            loading={chatLoading}
            suggestions={suggestions}
            suggestionsLoading={suggestionsLoading}
            onSend={handleChatSend}
            onClose={() => setChatOpen(false)}
            model={ollamaSettings.model}
          />
        )}
      </div>
    </>
  );
}
