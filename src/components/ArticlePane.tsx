import { useEffect, useRef, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";

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

function b64ToAudioUrl(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
}

// ─── PaneHeader ───────────────────────────────────────────────────────────────

function PaneHeader({ title, url, onClose, speech, settings }: {
  title: string | null; url: string; onClose: () => void;
  speech?: SpeechControls; settings?: ReaderSettings;
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

      <a href={url} target="_blank" rel="noopener noreferrer" aria-label="Open in browser"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-reader-text-muted transition-colors hover:bg-reader-hover hover:text-reader-text">
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </a>
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

  const isYT = isYouTubeWatch(url);

  const paragraphs = useMemo(() => {
    if (result.state !== "ok") return [];
    return [result.title, ...getParagraphs(result.content)];
  }, [result]);

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

  // Stop speech when article changes
  useEffect(() => { stopSpeech(); }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      isPlayingRef.current = false;
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (isYT) return;
    setResult({ state: "loading" });
    invoke<{ title: string; content: string; byline: string | null; site_name: string | null }>(
      "extract_article", { url }
    ).then((data) => {
      setResult({ state: "ok", title: data.title, byline: data.byline, siteName: data.site_name, content: data.content });
    }).catch((err) => {
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

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/25" onClick={onClose} aria-hidden="true" />
      <div className={`fixed right-0 top-0 bottom-0 z-50 flex w-full flex-col border-l shadow-2xl sm:w-[65vw] xl:w-[58vw] reader-theme-${theme} bg-reader-bg border-reader-border text-reader-text transition-colors duration-200`}>
        <PaneHeader
          title={result.state === "ok" ? result.title : title}
          url={url}
          onClose={onClose}
          speech={speechControls}
          settings={isYT ? undefined : settingsControls}
        />
        <div className="flex-1 overflow-y-auto">
          {isYT ? (
            <iframe key={url} src={toYouTubeEmbed(url)} className="h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen title={title ?? "Video"} />
          ) : result.state === "loading" ? (
            <LoadingSkeleton />
          ) : result.state === "error" ? (
            <div className="flex flex-col items-center justify-center gap-4 p-12 text-center text-reader-text">
              <p className="text-[12px] font-label text-reader-text-muted uppercase tracking-widest">{result.message}</p>
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="border border-reader-border hover:bg-reader-hover px-4 py-2 text-[11px] font-label font-bold uppercase tracking-widest transition-colors">
                Open in browser ↗
              </a>
            </div>
          ) : (
            <div className={`px-8 py-10 mx-auto transition-all ${columnWidth === "narrow" ? "max-w-md" : columnWidth === "wide" ? "max-w-5xl" : "max-w-2xl"} ${fontFamily === "sans" ? "font-reader-sans" : fontFamily === "mono" ? "font-reader-mono" : "font-reader-serif"} ${lineHeight === "compact" ? "leading-normal" : lineHeight === "roomy" ? "leading-loose" : "leading-relaxed"}`}>
              <h1 className="text-2xl font-headline font-bold leading-snug mb-3">{result.title}</h1>
              {(result.byline || result.siteName) && (
                <p className="text-[10px] font-label uppercase tracking-widest text-reader-text-muted mb-8">
                  {[result.byline, result.siteName].filter(Boolean).join(" · ")}
                </p>
              )}
              <div className="article-content" style={{ fontSize: `${fontSize}px` }}
                dangerouslySetInnerHTML={{ __html: result.content }} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
