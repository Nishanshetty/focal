import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { addFeed, upsertFeedItems } from "../lib/db";
import { getYouTubeApiKey } from "../lib/settings";
import { v4 as uuidv4 } from "uuid";

function youtubeHandleFromUrl(raw: string): string | null {
  try {
    const p = new URL(raw.trim());
    if (p.hostname !== "youtube.com" && p.hostname !== "www.youtube.com") return null;
    const match = p.pathname.match(/^\/@([\w.-]+)/);
    return match ? match[1] : null;
  } catch { return null; }
}

type ParsedFeedItem = {
  id: string;
  guid: string;
  title: string | null;
  link: string | null;
  content: string | null;
  content_hash: string | null;
  published_at: string | null;
  author: string | null;
  thumbnail_url: string | null;
};

type ParsedFeed = {
  title: string | null;
  site_url: string | null;
  items: ParsedFeedItem[];
};

type Props = {
  existingFolders: string[];
  onFeedAdded: () => void;
};

export default function AddFeedForm({ existingFolders, onFeedAdded }: Props) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [error, setError] = useState("");
  const [isPending, setIsPending] = useState(false);

  function handleToggle() {
    setOpen((v) => !v);
    setError("");
    setUrl("");
    setFolder("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsPending(true);

    try {
      let feedUrl = url.trim();

      // Resolve YouTube @handle → Atom feed URL before fetching
      const handle = youtubeHandleFromUrl(feedUrl);
      if (handle) {
        const apiKey = await getYouTubeApiKey();
        if (!apiKey) throw new Error("YouTube @handle URLs require a YouTube API key — add it in Settings.");
        feedUrl = await invoke<string>("resolve_youtube_handle", { handle, apiKey });
      }

      const parsed = await invoke<ParsedFeed>("fetch_feed", { url: feedUrl });

      const feedId = uuidv4();
      const subscriptionId = uuidv4();

      await addFeed(
        { id: feedId, url: feedUrl, title: parsed.title, site_url: parsed.site_url },
        folder.trim() || null,
        subscriptionId
      );

      await upsertFeedItems(
        parsed.items.map((item) => ({ ...item, feed_id: feedId }))
      );

      setOpen(false);
      setUrl("");
      setFolder("");
      onFeedAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div>
      <button onClick={handleToggle}
        className="flex w-full items-center justify-center gap-2 bg-primary-container px-4 py-2 text-[11px] font-label font-bold uppercase tracking-widest text-on-primary-container transition-opacity hover:opacity-90">
        <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
        </svg>
        Add Feed
      </button>

      {open && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2 px-1">
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/feed.xml" required disabled={isPending} autoFocus
            className="w-full ghost-border bg-surface-container-low px-3 py-2 text-xs text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 font-body" />
          <input type="text" list="folder-suggestions" value={folder} onChange={(e) => setFolder(e.target.value)}
            placeholder="Folder (optional)" disabled={isPending}
            className="w-full ghost-border bg-surface-container-low px-3 py-2 text-xs text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50 font-body" />
          {existingFolders.length > 0 && (
            <datalist id="folder-suggestions">
              {existingFolders.map((f) => <option key={f} value={f} />)}
            </datalist>
          )}
          {error && <p className="text-[11px] font-label text-error">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" disabled={isPending || !url}
              className="flex-1 bg-primary-container px-3 py-2 text-[11px] font-label font-bold uppercase tracking-widest text-on-primary-container transition-opacity hover:opacity-90 disabled:opacity-40">
              {isPending ? "Adding…" : "Subscribe"}
            </button>
            <button type="button" onClick={handleToggle} disabled={isPending}
              className="ghost-border bg-surface-container px-3 py-2 text-[11px] font-label text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-50">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
