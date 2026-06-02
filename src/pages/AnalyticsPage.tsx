import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { getFeedAnalytics } from "../lib/db";
import { classifyFeeds } from "../lib/analytics";
import type { AnalyticsResult } from "../lib/analytics";
import AnalyticsDashboard from "../components/AnalyticsDashboard";

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsResult | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const raw = await getFeedAnalytics();
      setData(classifyFeeds(raw));
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => { load(); }, []);

  function handleFeedDeleted() {
    load();
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-outline-variant/40 bg-background/80 backdrop-blur-xl px-6">
        <Link to="/" aria-label="Back to reader"
          className="rounded p-1.5 text-on-surface-variant transition-colors hover:text-primary">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <span className="font-headline text-lg font-bold tracking-[0.2em] text-primary uppercase">Analytics</span>
      </header>

      <div className="flex-1 overflow-y-auto">
        {error ? (
          <div className="flex items-center justify-center p-20">
            <p className="text-sm font-label text-error">{error}</p>
          </div>
        ) : !data ? (
          <div className="flex items-center justify-center p-20">
            <p className="text-[11px] font-label text-outline uppercase tracking-widest animate-pulse">Loading…</p>
          </div>
        ) : (
          <AnalyticsDashboard data={data} onFeedDeleted={handleFeedDeleted} />
        )}
      </div>
    </div>
  );
}
