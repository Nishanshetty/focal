import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { get24hItems } from "../lib/db";
import { getOllamaSettings } from "../lib/settings";
import type { DigestItem } from "../types/database";

type DigestSection = {
  feedTitle: string;
  items: DigestItem[];
};

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; summary: string; sections: DigestSection[]; total: number }
  | { kind: "error"; message: string };

export default function DigestView() {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function generate() {
    setState({ kind: "loading" });
    try {
      const [settings, raw] = await Promise.all([getOllamaSettings(), get24hItems()]);

      if (!settings.enabled) {
        setState({ kind: "error", message: "Ollama is not enabled. Enable it in Settings to use AI features." });
        return;
      }

      if (raw.length === 0) {
        setState({ kind: "done", summary: "", sections: [], total: 0 });
        return;
      }

      // Build sections grouped by feed for display
      const sectionMap = new Map<string, DigestItem[]>();
      for (const item of raw) {
        const key = item.feed_title ?? "Unknown Source";
        if (!sectionMap.has(key)) sectionMap.set(key, []);
        sectionMap.get(key)!.push(item);
      }
      const sections: DigestSection[] = Array.from(sectionMap.entries()).map(
        ([feedTitle, items]) => ({ feedTitle, items })
      );

      // Send to Ollama (content stripped to plain text, 300 chars each)
      const articles = raw.slice(0, 40).map((item) => ({
        title: item.title ?? "",
        content: stripHtml(item.content ?? ""),
        feed_title: item.feed_title ?? "Unknown",
      }));

      const result = await invoke<{ overall_summary: string; article_count: number }>(
        "generate_digest",
        { baseUrl: settings.url, model: settings.model, articles }
      );

      setState({ kind: "done", summary: result.overall_summary, sections, total: raw.length });
    } catch (err) {
      setState({ kind: "error", message: String(err) });
    }
  }

  return (
    <div className="p-6 text-on-surface">
      <div className="flex items-start justify-between gap-4 mb-8 border-b border-outline-variant/40 pb-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-headline font-bold">Today's Digest</h1>
          <p className="text-xs font-label text-outline uppercase tracking-wider">
            AI summary of articles published in the last 24 hours
          </p>
        </div>
        <button
          onClick={generate}
          disabled={state.kind === "loading"}
          className="shrink-0 px-4 py-2 text-[12px] font-label uppercase tracking-widest border border-primary text-primary transition-colors hover:bg-primary hover:text-on-primary disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {state.kind === "loading" ? "Generating…" : "Generate Digest"}
        </button>
      </div>

      {state.kind === "idle" && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
          <svg className="h-10 w-10 text-outline/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.25}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm text-on-surface-variant">Click "Generate Digest" to summarise what's happened in the last 24 hours.</p>
        </div>
      )}

      {state.kind === "loading" && (
        <div className="flex flex-col items-center justify-center py-24 gap-3">
          <p className="text-[11px] font-label text-outline uppercase tracking-widest animate-pulse">Synthesising…</p>
        </div>
      )}

      {state.kind === "error" && (
        <div className="flex items-center justify-center py-24">
          <p className="text-sm font-label text-error">{state.message}</p>
        </div>
      )}

      {state.kind === "done" && state.total === 0 && (
        <div className="flex flex-col items-center justify-center py-24 gap-2 text-center">
          <p className="text-sm text-on-surface-variant">No articles published in the last 24 hours.</p>
        </div>
      )}

      {state.kind === "done" && state.total > 0 && (
        <div className="flex flex-col gap-8">
          {/* AI narrative */}
          <div className="border-l-4 border-primary bg-surface-container-lowest pl-5 pr-5 py-5">
            <div className="flex items-center gap-2 mb-4">
              <svg className="h-3.5 w-3.5 text-primary shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
              </svg>
              <span className="text-[11px] font-label font-bold text-primary uppercase tracking-widest">Today's Highlights</span>
              <span className="text-[10px] font-label text-outline ml-1">· {state.total} article{state.total !== 1 ? "s" : ""}</span>
            </div>
            <ul className="flex flex-col gap-3">
              {parseBullets(state.summary).map((line, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                  <span className="text-[14px] text-on-surface leading-relaxed">{line}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Per-feed sections */}
          {state.sections.map((section) => (
            <FeedSection key={section.feedTitle} section={section} />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedSection({ section }: { section: DigestSection }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center gap-2 mb-3 group"
      >
        <span className="text-[10px] font-label font-bold uppercase tracking-[0.1em] text-outline group-hover:text-on-surface-variant transition-colors">
          {section.feedTitle}
        </span>
        <span className="text-[10px] font-label text-outline/60">({section.items.length})</span>
        <svg
          className={`h-3 w-3 text-outline transition-transform duration-150 ${collapsed ? "-rotate-90" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-2">
          {section.items.map((item) => (
            <ArticleRow key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleRow({ item }: { item: DigestItem }) {
  function handleOpen(e: React.MouseEvent) {
    e.preventDefault();
    if (item.link) window.open(item.link, "_blank", "noopener noreferrer");
  }

  const time = item.published_at
    ? new Date(item.published_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="flex items-start gap-3 bg-surface-container-lowest border border-outline-variant/40 px-4 py-3 hover:border-outline-variant transition-colors">
      {time && (
        <span className="shrink-0 text-[10px] font-label text-outline pt-0.5 w-12 text-right">{time}</span>
      )}
      <div className="flex flex-col gap-0.5 min-w-0">
        {item.link ? (
          <button
            onClick={handleOpen}
            className="text-left text-[13px] font-body text-on-surface hover:text-primary transition-colors truncate"
          >
            {item.title ?? "Untitled"}
          </button>
        ) : (
          <span className="text-[13px] font-body text-on-surface truncate">{item.title ?? "Untitled"}</span>
        )}
      </div>
    </div>
  );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function parseBullets(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.replace(/^[-•*]\s*/, "").trim())
    .filter(Boolean);
}
