import { useCallback, useEffect, useMemo, useState } from "react";
import { getSubscribedFeeds, getFeedAnalytics } from "../lib/db";
import { DEFAULT_RANGE } from "../lib/date-range";
import type { DateRange } from "../lib/date-range";
import type { SubscribedFeed } from "../types/database";
import type { NavFilter } from "../components/SidebarNav";
import { classifyFeeds } from "../lib/analytics";
import type { AnalyticsResult } from "../lib/analytics";
import { useFeedRefresh } from "../lib/hooks/use-feed-refresh";
import AppShell from "../components/AppShell";
import SidebarContent from "../components/SidebarContent";
import Timeline from "../components/Timeline";
import AnalyticsDashboard from "../components/AnalyticsDashboard";
import DigestView from "../components/DigestView";

export default function HomePage() {
  const [feeds, setFeeds] = useState<SubscribedFeed[]>([]);
  const [feedsRefreshKey, setFeedsRefreshKey] = useState(0);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);

  const [activeFeedId, setActiveFeedId] = useState<string | null>(null);
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  const [activeAnalytics, setActiveAnalytics] = useState(false);
  const [activeDigest, setActiveDigest] = useState(false);
  const [analyticsData, setAnalyticsData] = useState<AnalyticsResult | null>(null);
  const [analyticsError, setAnalyticsError] = useState("");
  const [range, setRange] = useState<DateRange>(DEFAULT_RANGE);

  useEffect(() => {
    getSubscribedFeeds().then(setFeeds).catch(console.error);
  }, [feedsRefreshKey]);

  // Re-render timeline + sidebar whenever the background crawler finishes
  const handleBackgroundRefresh = useCallback(() => {
    setSidebarRefreshKey((k) => k + 1);
    setTimelineRefreshKey((k) => k + 1);
  }, []);
  useFeedRefresh(handleBackgroundRefresh);

  async function loadAnalytics() {
    setAnalyticsData(null);
    setAnalyticsError("");
    try {
      const raw = await getFeedAnalytics();
      setAnalyticsData(classifyFeeds(raw));
    } catch (err) {
      setAnalyticsError(String(err));
    }
  }

  function handleNavigate(filter: NavFilter) {
    if (filter.analytics) {
      setActiveAnalytics(true);
      setActiveDigest(false);
      setActiveFeedId(null);
      setActiveFolder(null);
      loadAnalytics();
    } else if (filter.digest) {
      setActiveDigest(true);
      setActiveAnalytics(false);
      setActiveFeedId(null);
      setActiveFolder(null);
    } else {
      setActiveAnalytics(false);
      setActiveDigest(false);
      setActiveFeedId(filter.feedId ?? null);
      setActiveFolder(filter.folder ?? null);
    }
  }

  function handleFeedAdded() {
    setFeedsRefreshKey((k) => k + 1);
    setSidebarRefreshKey((k) => k + 1);
    setTimelineRefreshKey((k) => k + 1);
  }

  function handleFeedDeleted() {
    setActiveFeedId(null);
    setActiveFolder(null);
    setFeedsRefreshKey((k) => k + 1);
    setSidebarRefreshKey((k) => k + 1);
    setTimelineRefreshKey((k) => k + 1);
    if (activeAnalytics) loadAnalytics();
  }

  function handleStatesChanged() {
    setSidebarRefreshKey((k) => k + 1);
  }

  function handleRefreshComplete() {
    setSidebarRefreshKey((k) => k + 1);
    setTimelineRefreshKey((k) => k + 1);
  }

  const feedIds = useMemo(() => {
    if (activeFeedId) return [activeFeedId];
    if (activeFolder) return feeds.filter((f) => (f.folder ?? "Uncategorized") === activeFolder).map((f) => f.id);
    return feeds.map((f) => f.id);
  }, [feeds, activeFeedId, activeFolder]);

  const filterLabel = useMemo(() => {
    if (activeFeedId) return feeds.find((f) => f.id === activeFeedId)?.title ?? "Feed";
    if (activeFolder) return activeFolder;
    return "All Articles";
  }, [feeds, activeFeedId, activeFolder]);

  const sidebar = (
    <SidebarContent
      feeds={feeds}
      activeFeedId={activeFeedId}
      activeFolder={activeFolder}
      activeAnalytics={activeAnalytics}
      activeDigest={activeDigest}
      refreshKey={sidebarRefreshKey}
      onNavigate={handleNavigate}
      onFeedAdded={handleFeedAdded}
      onFeedDeleted={handleFeedDeleted}
    />
  );

  const main = activeDigest ? (
    <DigestView />
  ) : activeAnalytics ? (
    <div>
      {analyticsError ? (
        <div className="flex items-center justify-center p-20">
          <p className="text-sm font-label text-error">{analyticsError}</p>
        </div>
      ) : !analyticsData ? (
        <div className="flex items-center justify-center p-20">
          <p className="text-[11px] font-label text-outline uppercase tracking-widest animate-pulse">Loading…</p>
        </div>
      ) : (
        <AnalyticsDashboard data={analyticsData} onFeedDeleted={handleFeedDeleted} />
      )}
    </div>
  ) : (
    <Timeline
      feedIds={feedIds}
      filterLabel={filterLabel}
      range={range}
      refreshKey={timelineRefreshKey}
      onRangeChange={setRange}
      onStatesChanged={handleStatesChanged}
    />
  );

  return <AppShell sidebar={sidebar} main={main} onRefreshComplete={handleRefreshComplete} />;
}
