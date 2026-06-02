import type { FeedAnalytics } from "../types/database";

export type ClassifiedFeed = {
  feedId: string;
  feedTitle: string;
  feedUrl: string;
  siteUrl: string | null;
  folder: string;
  totalItems: number;
  readItems: number;
  unreadItems: number;
  readRate: number;
  starredItems: number;
  lastFetchedAt: string | null;
  weeklyPostVolume: number;
  daysSinceLastPost: number | null;
  isFailing: boolean;
};

export type AnalyticsResult = {
  totalFeeds: number;
  totalUnreads: number;
  overallReadRate: number;
  folderBreakdown: { folder: string; count: number }[];
  noisyFeeds: ClassifiedFeed[];
  ignoredFeeds: ClassifiedFeed[];
  deadFeeds: ClassifiedFeed[];
};

export function classifyFeeds(raw: FeedAnalytics[]): AnalyticsResult {
  const classified: ClassifiedFeed[] = raw.map((rf) => {
    const total = Number(rf.total_items);
    const read = Number(rf.read_items);
    const starred = Number(rf.starred_items);
    const unread = Math.max(0, total - read);
    const rate = total > 0 ? Math.round((read / total) * 100) : 0;

    let weeklyPostVolume = 0;
    if (rf.oldest_item_date && rf.newest_item_date) {
      const spanDays = Math.max(
        1,
        (new Date(rf.newest_item_date).getTime() - new Date(rf.oldest_item_date).getTime()) /
          86_400_000
      );
      weeklyPostVolume = Math.round((total / spanDays) * 7 * 10) / 10;
    }

    let daysSinceLastPost: number | null = null;
    if (rf.newest_item_date) {
      daysSinceLastPost = Math.max(
        0,
        Math.floor((Date.now() - new Date(rf.newest_item_date).getTime()) / 86_400_000)
      );
    }

    let isFailing = false;
    if (rf.last_fetched_at) {
      const elapsed = Date.now() - new Date(rf.last_fetched_at).getTime();
      isFailing = elapsed > Math.max(86_400_000, rf.fetch_interval * 3 * 1000);
    } else {
      isFailing = true;
    }

    return {
      feedId: rf.feed_id,
      feedTitle: rf.feed_title ?? rf.feed_url,
      feedUrl: rf.feed_url,
      siteUrl: rf.site_url,
      folder: rf.folder ?? "Uncategorized",
      totalItems: total,
      readItems: read,
      unreadItems: unread,
      readRate: rate,
      starredItems: starred,
      lastFetchedAt: rf.last_fetched_at,
      weeklyPostVolume,
      daysSinceLastPost,
      isFailing,
    };
  });

  const totalFeeds = classified.length;
  const totalUnreads = classified.reduce((s, f) => s + f.unreadItems, 0);
  const totalItems = classified.reduce((s, f) => s + f.totalItems, 0);
  const totalReadItems = classified.reduce((s, f) => s + f.readItems, 0);
  const overallReadRate = totalItems > 0 ? Math.round((totalReadItems / totalItems) * 100) : 0;

  const folderCounts: Record<string, number> = {};
  classified.forEach((f) => { folderCounts[f.folder] = (folderCounts[f.folder] ?? 0) + 1; });
  const folderBreakdown = Object.entries(folderCounts)
    .map(([folder, count]) => ({ folder, count }))
    .sort((a, b) => b.count - a.count);

  return {
    totalFeeds,
    totalUnreads,
    overallReadRate,
    folderBreakdown,
    noisyFeeds: classified.filter((f) => f.weeklyPostVolume > 15).sort((a, b) => b.weeklyPostVolume - a.weeklyPostVolume),
    ignoredFeeds: classified.filter((f) => f.totalItems >= 10 && f.readRate < 10).sort((a, b) => a.readRate - b.readRate),
    deadFeeds: classified
      .filter((f) => (f.daysSinceLastPost !== null && f.daysSinceLastPost >= 30) || f.isFailing)
      .sort((a, b) => (b.daysSinceLastPost ?? 9999) - (a.daysSinceLastPost ?? 9999)),
  };
}
