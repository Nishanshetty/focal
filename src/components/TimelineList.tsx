import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getTimelineItems, getTotalUnreadCount, upsertItemState, markAllRead } from "../lib/db";
import { DATE_RANGE_OPTIONS } from "../lib/date-range";
import type { TimelineItem } from "../types/database";
import type { DateRange } from "../lib/date-range";
import { useKeyboardShortcuts } from "../lib/hooks/use-keyboard-shortcuts";
import FeedItemCard from "./FeedItemCard";
import ArticlePane from "./ArticlePane";

const FIRST_PAGE_CURSOR = "2099-12-31T23:59:59.999Z";

type Props = {
  feedIds: string[];
  filterLabel: string;
  filterKey: string;
  range: DateRange;
  since: string | null;
  pageSize: number;
  onRangeChange: (r: DateRange) => void;
  onStatesChanged: () => void;
};

function setAdd(prev: Set<string>, id: string): Set<string> {
  return new Set(Array.from(prev).concat(id));
}
function setToggle(prev: Set<string>, id: string): Set<string> {
  return prev.has(id) ? new Set(Array.from(prev).filter((x) => x !== id)) : setAdd(prev, id);
}

export default function TimelineList({
  feedIds, filterLabel, filterKey, range, since, pageSize,
  onRangeChange, onStatesChanged,
}: Props) {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [starredIds, setStarredIds] = useState<Set<string>>(new Set());
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [paneItem, setPaneItem] = useState<TimelineItem | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);

  const prevFilterKeyRef = useRef(filterKey);

  // Reset unread toggle when the feed/folder selection changes
  useEffect(() => {
    if (filterKey !== prevFilterKeyRef.current) {
      setUnreadOnly(false);
    }
    prevFilterKeyRef.current = filterKey;
  }, [filterKey]);

  // Load items whenever filter or unreadOnly changes
  useEffect(() => {
    if (feedIds.length === 0) { setItems([]); setTotalUnread(0); setHasMore(false); return; }
    setIsLoading(true);
    setLoadError("");

    Promise.all([
      getTimelineItems({ feedIds, cursor: FIRST_PAGE_CURSOR, since, limit: pageSize, unreadOnly }),
      getTotalUnreadCount(feedIds, since),
    ]).then(([newItems, count]) => {
      setItems(newItems);
      setReadIds(new Set(newItems.filter((i) => i.is_read).map((i) => i.id)));
      setStarredIds(new Set(newItems.filter((i) => i.is_starred).map((i) => i.id)));
      setHasMore(newItems.length === pageSize);
      setTotalUnread(count);
      setSelectedIndex(-1);
    }).catch((err) => {
      setLoadError(String(err));
    }).finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, unreadOnly]);

  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  useEffect(() => {
    if (selectedIndex >= 0) itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedIndex]);

  function selectAndRead(index: number) {
    const item = items[index];
    if (!item) return;
    setSelectedIndex(index);
    setPaneItem(item);
    if (!readIds.has(item.id)) {
      setReadIds((prev) => setAdd(prev, item.id));
      setTotalUnread((prev) => Math.max(0, prev - 1));
      upsertItemState(item.id, { is_read: true }).then(onStatesChanged).catch(console.error);
    }
  }

  function handleToggleStar(index: number, id: string, e: React.MouseEvent) {
    e.stopPropagation();
    setSelectedIndex(index);
    const next = !starredIds.has(id);
    setStarredIds((prev) => setToggle(prev, id));
    upsertItemState(id, { is_starred: next }).catch(console.error);
  }

  function handleLoadMore() {
    const cursor = items[items.length - 1]?.published_at;
    if (!cursor) return;
    setLoadError("");
    setIsLoading(true);
    getTimelineItems({ feedIds, cursor, since, limit: pageSize, unreadOnly })
      .then((more) => {
        if (more.length < pageSize) setHasMore(false);
        if (more.length > 0) setItems((prev) => [...prev, ...more]);
      })
      .catch((err) => setLoadError(String(err)))
      .finally(() => setIsLoading(false));
  }

  function handleMarkAllRead() {
    if (totalUnread === 0) return;

    const visibleUnreadIds = items.filter((i) => !readIds.has(i.id)).map((i) => i.id);
    setReadIds((prev) => new Set(Array.from(prev).concat(visibleUnreadIds)));
    const prevTotal = totalUnread;
    setTotalUnread(0);
    setIsMarkingAll(true);

    markAllRead(feedIds, null)
      .then(onStatesChanged)
      .catch(() => {
        setReadIds((prev) => new Set(Array.from(prev).filter((id) => !visibleUnreadIds.includes(id))));
        setTotalUnread(prevTotal);
        setLoadError("Failed to mark items as read");
      })
      .finally(() => setIsMarkingAll(false));
  }

  useKeyboardShortcuts({
    j: () => setSelectedIndex((prev) => prev < 0 ? 0 : Math.min(prev + 1, items.length - 1)),
    k: () => setSelectedIndex((prev) => prev < 0 ? 0 : Math.max(prev - 1, 0)),
    o: () => { if (selectedIndex >= 0) setPaneItem(items[selectedIndex] ?? null); },
    Enter: () => { if (selectedIndex >= 0) setPaneItem(items[selectedIndex] ?? null); },
    Escape: () => setPaneItem(null),
    m: () => {
      const item = items[selectedIndex];
      if (!item) return;
      const next = !readIds.has(item.id);
      setReadIds((prev) => setToggle(prev, item.id));
      setTotalUnread((prev) => Math.max(0, next ? prev - 1 : prev + 1));
      upsertItemState(item.id, { is_read: next }).then(onStatesChanged).catch(() => {
        setReadIds((prev) => setToggle(prev, item.id));
      });
    },
    s: () => {
      const item = items[selectedIndex];
      if (!item) return;
      const next = !starredIds.has(item.id);
      setStarredIds((prev) => setToggle(prev, item.id));
      upsertItemState(item.id, { is_starred: next }).catch(console.error);
    },
    "Shift+A": handleMarkAllRead,
  });

  return (
    <div className="relative">
      <div className={`h-0.5 w-full transition-all duration-300 ${isLoading || isMarkingAll ? "bg-primary/60" : "bg-transparent"}`}>
        {(isLoading || isMarkingAll) && <div className="h-full w-1/3 bg-primary animate-[slide_1.2s_ease-in-out_infinite]" />}
      </div>

      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-outline-variant/40 bg-background/80 px-4 py-3 backdrop-blur-xl">
        <div className="flex items-baseline gap-2">
          <h3 className="text-[11px] font-headline font-bold uppercase tracking-widest text-outline">
            Queue / {filterLabel}
          </h3>
          {totalUnread > 0 && (
            <span className="text-[10px] font-label text-outline opacity-60">{totalUnread} unread</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setUnreadOnly((v) => !v)}
            className={`ghost-border px-2.5 py-1 text-[11px] font-label font-bold uppercase tracking-widest transition-colors ${unreadOnly ? "bg-primary text-on-primary" : "bg-surface-container text-on-surface-variant hover:text-on-surface"}`}>
            Unread
          </button>
          <select value={range} onChange={(e) => onRangeChange(e.target.value as DateRange)}
            className="ghost-border bg-surface-container px-2 py-1 text-[11px] font-label text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer">
            {DATE_RANGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {totalUnread > 0 && (
            <button onClick={handleMarkAllRead} disabled={isMarkingAll}
              className="ghost-border bg-surface-container px-2.5 py-1 text-[11px] font-label font-bold uppercase tracking-widest text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40">
              {isMarkingAll ? "Marking…" : "Mark all read"}
            </button>
          )}
        </div>
      </div>

      {items.length === 0 && !isLoading ? (
        <div className="px-6 py-20 text-center">
          <p className="text-[12px] font-label text-outline uppercase tracking-widest">
            {feedIds.length === 0 ? "Add a feed from the sidebar to get started." : `No items in ${filterLabel} for this time period.`}
          </p>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4 p-6">
            {items.map((item, index) => (
              <FeedItemCard key={item.id} item={item}
                isRead={readIds.has(item.id)} isStarred={starredIds.has(item.id)}
                isSelected={index === selectedIndex} accentIndex={index}
                onActivate={() => selectAndRead(index)}
                onOpen={() => { if (item.link) openUrl(item.link); }}
                onToggleStar={(e) => handleToggleStar(index, item.id, e)}
                elRef={(el) => { itemRefs.current[index] = el; }} />
            ))}
          </ul>
          <div className="py-8 text-center">
            {loadError && <p className="mb-3 text-[11px] font-label text-error">{loadError}</p>}
            {hasMore ? (
              <button onClick={handleLoadMore} disabled={isLoading}
                className="ghost-border bg-surface-container px-4 py-2 text-[11px] font-label font-bold uppercase tracking-widest text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40">
                {isLoading ? "Loading…" : "Load more"}
              </button>
            ) : (
              <p className="text-[10px] font-label uppercase tracking-widest text-outline">You're all caught up</p>
            )}
          </div>
        </>
      )}

      {paneItem?.link && (
        <ArticlePane url={paneItem.link} title={paneItem.title} onClose={() => setPaneItem(null)} />
      )}
    </div>
  );
}
