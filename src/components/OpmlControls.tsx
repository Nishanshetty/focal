import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { addFeed, upsertFeedItems, getSubscribedFeeds } from "../lib/db";
import { v4 as uuidv4 } from "uuid";

type OpmlFeed = { url: string; title: string; folder: string };

type ImportResult = {
  added: number;
  alreadySubscribed: number;
  failed: number;
  errors: string[];
};

type State =
  | { status: "idle" }
  | { status: "parsing" }
  | { status: "importing"; total: number; done: number }
  | { status: "exporting" }
  | { status: "done"; result: ImportResult }
  | { status: "error"; message: string };

type ParsedFeedItem = {
  id: string; guid: string; title: string | null; link: string | null;
  content: string | null; content_hash: string | null; published_at: string | null;
  author: string | null; thumbnail_url: string | null;
};
type ParsedFeed = { title: string | null; site_url: string | null; items: ParsedFeedItem[] };

function parseOpml(xml: string): OpmlFeed[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  if (doc.querySelector("parsererror")) throw new Error("Invalid OPML XML");
  const body = doc.querySelector("body");
  if (!body) throw new Error("Invalid OPML: missing <body>");
  const feeds: OpmlFeed[] = [];

  function walk(node: Element, folder: string) {
    const xmlUrl = node.getAttribute("xmlUrl")?.trim();
    if (xmlUrl) {
      const title = (node.getAttribute("title") || node.getAttribute("text") || xmlUrl).trim();
      feeds.push({ url: xmlUrl, title, folder });
    } else {
      const name = (node.getAttribute("title") || node.getAttribute("text") || "").trim();
      Array.from(node.children).forEach((child) => walk(child, folder || name));
    }
  }

  Array.from(body.children).forEach((child) => walk(child, ""));
  const seen = new Set<string>();
  return feeds.filter((f) => { if (seen.has(f.url)) return false; seen.add(f.url); return true; });
}

function escapeXml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildOpml(groups: Map<string, Array<{ title: string; url: string; siteUrl: string | null }>>): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    "    <title>Focal Subscriptions</title>",
    `    <dateCreated>${new Date().toUTCString()}</dateCreated>`,
    "  </head>",
    "  <body>",
  ];
  for (const [folder, entries] of groups) {
    lines.push(`    <outline text="${escapeXml(folder)}" title="${escapeXml(folder)}">`);
    for (const e of entries) {
      const htmlAttr = e.siteUrl ? ` htmlUrl="${escapeXml(e.siteUrl)}"` : "";
      lines.push(`      <outline type="rss" text="${escapeXml(e.title)}" title="${escapeXml(e.title)}" xmlUrl="${escapeXml(e.url)}"${htmlAttr}/>`);
    }
    lines.push("    </outline>");
  }
  lines.push("  </body>", "</opml>");
  return lines.join("\n");
}

type Props = { onImportComplete: () => void };

export default function OpmlControls({ onImportComplete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ status: "idle" });

  const busy = state.status !== "idle" && state.status !== "done" && state.status !== "error";

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setState({ status: "parsing" });

    const reader = new FileReader();
    reader.onerror = () => setState({ status: "error", message: "Could not read file" });
    reader.onload = async (ev) => {
      try {
        const feeds = parseOpml(ev.target?.result as string);
        if (feeds.length === 0) { setState({ status: "error", message: "No feed URLs found in OPML file" }); return; }

        setState({ status: "importing", total: feeds.length, done: 0 });
        const result: ImportResult = { added: 0, alreadySubscribed: 0, failed: 0, errors: [] };

        // Check which feeds are already subscribed
        const existing = await getSubscribedFeeds();
        const existingUrls = new Set(existing.map((f) => f.url));

        for (let i = 0; i < feeds.length; i++) {
          const feed = feeds[i];
          setState({ status: "importing", total: feeds.length, done: i });
          try {
            new URL(feed.url); // validate URL
            if (existingUrls.has(feed.url)) { result.alreadySubscribed++; continue; }

            const parsed = await invoke<ParsedFeed>("fetch_feed", { url: feed.url });
            const feedId = uuidv4();
            await addFeed(
              { id: feedId, url: feed.url, title: parsed.title ?? feed.title, site_url: parsed.site_url },
              feed.folder || null,
              uuidv4()
            );
            await upsertFeedItems(parsed.items.map((item) => ({ ...item, feed_id: feedId })));
            result.added++;
          } catch (err) {
            result.failed++;
            result.errors.push(`${feed.url}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }

        setState({ status: "done", result });
        if (result.added > 0) onImportComplete();
      } catch (err) {
        setState({ status: "error", message: err instanceof Error ? err.message : "Failed to parse OPML" });
      }
    };
    reader.readAsText(file);
  }

  async function handleExport() {
    setState({ status: "exporting" });
    try {
      const feeds = await getSubscribedFeeds();
      const groups = new Map<string, Array<{ title: string; url: string; siteUrl: string | null }>>();
      for (const feed of feeds) {
        const folder = feed.folder ?? "Uncategorized";
        if (!groups.has(folder)) groups.set(folder, []);
        groups.get(folder)!.push({ title: feed.title ?? feed.url, url: feed.url, siteUrl: feed.site_url });
      }
      const xml = buildOpml(groups);
      const blob = new Blob([xml], { type: "text/xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `focal-${new Date().toISOString().slice(0, 10)}.opml`; a.click();
      URL.revokeObjectURL(url);
      setState({ status: "idle" });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "Export failed" });
    }
  }

  return (
    <div className="space-y-2">
      <input ref={fileRef} type="file" accept=".opml,.xml" className="hidden" onChange={handleFileChange} />

      <div className="flex gap-1.5">
        <button onClick={() => fileRef.current?.click()} disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 ghost-border bg-surface-container px-2 py-1.5 text-[11px] font-label text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
          Import
        </button>
        <button onClick={handleExport} disabled={busy}
          className="flex flex-1 items-center justify-center gap-1.5 ghost-border bg-surface-container px-2 py-1.5 text-[11px] font-label text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50">
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export
        </button>
      </div>

      {state.status === "importing" && (
        <p className="text-[10px] font-label text-outline">
          Importing {state.done}/{state.total} feeds…
        </p>
      )}
      {state.status === "exporting" && (
        <p className="text-[10px] font-label text-outline">Exporting…</p>
      )}
      {state.status === "done" && (
        <div className="ghost-border bg-surface-container-low p-2 text-[10px] font-label space-y-0.5">
          <p className="font-bold text-primary">Import complete</p>
          <p className="text-on-surface-variant">{state.result.added} added · {state.result.alreadySubscribed} already subscribed · {state.result.failed} failed</p>
          {state.result.errors.length > 0 && (
            <details><summary className="cursor-pointer text-outline">
              {state.result.errors.length} error{state.result.errors.length !== 1 ? "s" : ""}
            </summary>
              <ul className="mt-1 space-y-0.5">
                {state.result.errors.slice(0, 5).map((m, i) => <li key={i} className="truncate text-error">{m}</li>)}
              </ul>
            </details>
          )}
          <button onClick={() => setState({ status: "idle" })} className="text-outline hover:text-on-surface mt-1">Dismiss</button>
        </div>
      )}
      {state.status === "error" && (
        <div className="ghost-border bg-surface-container-low p-2 text-[10px] font-label flex items-start justify-between gap-2">
          <p className="text-error">{state.message}</p>
          <button onClick={() => setState({ status: "idle" })} className="shrink-0 text-outline hover:text-on-surface">✕</button>
        </div>
      )}
    </div>
  );
}
