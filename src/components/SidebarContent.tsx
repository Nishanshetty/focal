import { useEffect, useState } from "react";
import { deleteFeed, getTimelineItems } from "../lib/db";
import type { SubscribedFeed } from "../types/database";
import AddFeedForm from "./AddFeedForm";
import OpmlControls from "./OpmlControls";
import SidebarNav from "./SidebarNav";
import type { FeedEntry, NavFilter } from "./SidebarNav";

type Props = {
  feeds: SubscribedFeed[];
  activeFeedId: string | null;
  activeFolder: string | null;
  activeAnalytics: boolean;
  activeDigest: boolean;
  refreshKey: number;
  onNavigate: (filter: NavFilter) => void;
  onFeedAdded: () => void;
  onFeedDeleted: () => void;
};

export default function SidebarContent({
  feeds, activeFeedId, activeFolder, activeAnalytics, activeDigest,
  refreshKey, onNavigate, onFeedAdded, onFeedDeleted,
}: Props) {
  const [unreadByFeed, setUnreadByFeed] = useState<Record<string, number>>({});

  useEffect(() => {
    if (feeds.length === 0) { setUnreadByFeed({}); return; }
    const feedIds = feeds.map((f) => f.id);
    // Load unread counts per feed
    Promise.all(
      feedIds.map(async (id) => {
        const items = await getTimelineItems({
          feedIds: [id], cursor: "2099-12-31T23:59:59.999Z",
          since: null, limit: 9999, unreadOnly: true,
        });
        return [id, items.length] as [string, number];
      })
    ).then((pairs) => setUnreadByFeed(Object.fromEntries(pairs))).catch(console.error);
  }, [feeds, refreshKey]);

  // Build groups: folder → FeedEntry[]
  const groups: Record<string, FeedEntry[]> = {};
  for (const feed of feeds) {
    const folder = feed.folder ?? "Uncategorized";
    if (!groups[folder]) groups[folder] = [];
    groups[folder].push({
      subId: feed.subscription_id,
      feedId: feed.id,
      title: feed.title ?? feed.url,
      unread: unreadByFeed[feed.id] ?? 0,
    });
  }

  const existingFolders = Object.keys(groups).filter((f) => f !== "Uncategorized");

  async function handleUnsubscribe(_subId: string, feedId: string, _title: string) {
    try {
      await deleteFeed(feedId);
      if (activeFeedId === feedId) onNavigate({});
      onFeedDeleted();
    } catch (err) {
      console.error("Failed to delete feed:", err);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-outline-variant/20 p-3">
        <AddFeedForm existingFolders={existingFolders} onFeedAdded={onFeedAdded} />
      </div>
      <SidebarNav
        groups={groups}
        activeFeedId={activeFeedId}
        activeFolder={activeFolder}
        activeAnalytics={activeAnalytics}
        activeDigest={activeDigest}
        onNavigate={onNavigate}
        onUnsubscribe={handleUnsubscribe}
      />
      <div className="border-t border-outline-variant/20 p-3">
        <p className="mb-2 text-[10px] font-label font-bold uppercase tracking-widest text-outline">
          Import / Export
        </p>
        <OpmlControls onImportComplete={onFeedAdded} />
      </div>
    </div>
  );
}
