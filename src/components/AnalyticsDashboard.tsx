import type { AnalyticsResult, ClassifiedFeed } from "../lib/analytics";
import { deleteFeed } from "../lib/db";

type Props = {
  data: AnalyticsResult;
  onFeedDeleted: (feedId: string) => void;
};

export default function AnalyticsDashboard({ data, onFeedDeleted }: Props) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (data.overallReadRate / 100) * circumference;

  async function handleUnsubscribe(feedId: string, title: string) {
    if (!window.confirm(`Unsubscribe from "${title}"?`)) return;
    try {
      await deleteFeed(feedId);
      onFeedDeleted(feedId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to unsubscribe");
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto text-on-surface">
      <div className="flex flex-col gap-1 mb-8 border-b border-outline-variant/40 pb-4">
        <h1 className="text-2xl font-headline font-bold">Feed Health & Analytics</h1>
        <p className="text-xs font-label text-outline uppercase tracking-wider">
          Identify noise, clean up inactive feeds, and optimise your reading list.
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Read engagement */}
        <div className="bg-surface-container-lowest border border-outline-variant/40 p-5 flex items-center justify-between shadow-sm">
          <div className="flex flex-col">
            <span className="text-[10px] font-label text-outline uppercase tracking-widest mb-1">Read Engagement</span>
            <span className="text-2xl font-headline font-bold">{data.overallReadRate}%</span>
            <p className="text-xs text-on-surface-variant mt-2 max-w-[160px]">
              Percentage of articles read across all feeds.
            </p>
          </div>
          <div className="relative h-20 w-20 flex items-center justify-center shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle cx="40" cy="40" r={radius} className="stroke-surface-container fill-none" strokeWidth="6" />
              <circle cx="40" cy="40" r={radius} className="stroke-primary fill-none transition-all duration-500 ease-out"
                strokeWidth="6" strokeDasharray={circumference} strokeDashoffset={strokeDashoffset} strokeLinecap="round" />
            </svg>
            <span className="absolute text-xs font-bold font-label">{data.overallReadRate}%</span>
          </div>
        </div>

        {/* Counts */}
        <div className="bg-surface-container-lowest border border-outline-variant/40 p-5 shadow-sm">
          <span className="text-[10px] font-label text-outline uppercase tracking-widest block mb-4">Subscription Volume</span>
          <div className="grid grid-cols-2 gap-4">
            <div className="border-r border-outline-variant/30 pr-2">
              <span className="text-2xl font-headline font-bold block">{data.totalFeeds}</span>
              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider font-label">Total Feeds</span>
            </div>
            <div>
              <span className="text-2xl font-headline font-bold block text-primary">{data.totalUnreads}</span>
              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider font-label">Unread Articles</span>
            </div>
          </div>
        </div>

        {/* Folder distribution */}
        <div className="bg-surface-container-lowest border border-outline-variant/40 p-5 shadow-sm">
          <span className="text-[10px] font-label text-outline uppercase tracking-widest block mb-3">Folder Distribution</span>
          <div className="flex flex-col gap-2 max-h-24 overflow-y-auto pr-1">
            {data.folderBreakdown.length === 0 ? (
              <p className="text-xs text-outline italic">No folder data</p>
            ) : data.folderBreakdown.map((f) => {
              const pct = data.totalFeeds > 0 ? Math.round((f.count / data.totalFeeds) * 100) : 0;
              return (
                <div key={f.folder} className="flex flex-col gap-0.5">
                  <div className="flex justify-between text-xs font-label">
                    <span className="truncate max-w-[120px] font-bold">{f.folder}</span>
                    <span className="text-outline">{f.count} ({pct}%)</span>
                  </div>
                  <div className="w-full bg-surface-container h-1.5 rounded-full overflow-hidden">
                    <div className="bg-secondary h-full transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Declutter columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <FeedColumn
          title="Noisy Feeds" dot="bg-error"
          description={<>Feeds publishing <strong className="text-error">&gt;15 articles/week</strong>.</>}
          feeds={data.noisyFeeds}
          statFn={(f) => `${f.weeklyPostVolume} posts/wk`}
          emptyLabel="No noisy feeds" emptyNote="Your timeline is nice and quiet!"
          onUnsubscribe={handleUnsubscribe}
        />
        <FeedColumn
          title="Ignored Feeds" dot="bg-secondary"
          description={<>Active feeds with <strong className="text-secondary">&lt;10% read rate</strong> (min 10 posts).</>}
          feeds={data.ignoredFeeds}
          statFn={(f) => `${f.readRate}% read (${f.readItems}/${f.totalItems})`}
          emptyLabel="No ignored feeds" emptyNote="You engage with all your feeds!"
          onUnsubscribe={handleUnsubscribe}
        />
        <FeedColumn
          title="Dead & Failing" dot="bg-outline"
          description={<>Feeds with <strong className="text-outline">no posts in 30 days</strong> or sync failures.</>}
          feeds={data.deadFeeds}
          statFn={(f) => f.isFailing ? "Sync error" : `${f.daysSinceLastPost}d stale`}
          badgeFn={(f) => f.isFailing ? "text-error bg-error/10 border-error/20" : undefined}
          emptyLabel="No dead feeds" emptyNote="All subscriptions are active!"
          onUnsubscribe={handleUnsubscribe}
        />
      </div>
    </div>
  );
}

function FeedColumn({ title, dot, description, feeds, statFn, badgeFn, emptyLabel, emptyNote, onUnsubscribe }: {
  title: string; dot: string; description: React.ReactNode;
  feeds: ClassifiedFeed[]; statFn: (f: ClassifiedFeed) => string;
  badgeFn?: (f: ClassifiedFeed) => string | undefined;
  emptyLabel: string; emptyNote: string;
  onUnsubscribe: (feedId: string, title: string) => void;
}) {
  return (
    <div className="border border-outline-variant/40 bg-surface-container-lowest p-5 flex flex-col min-h-[400px]">
      <div className="flex flex-col mb-4">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dot}`} />
          <h2 className="text-sm font-headline font-bold uppercase tracking-wider">{title}</h2>
        </div>
        <p className="text-[11px] text-on-surface-variant mt-1 leading-relaxed">{description}</p>
      </div>
      <div className="flex-1 overflow-y-auto max-h-[450px] pr-1">
        {feeds.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 border border-dashed border-outline-variant/60">
            <p className="text-xs font-bold text-outline">{emptyLabel}</p>
            <p className="text-[10px] text-outline opacity-75 mt-1">{emptyNote}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {feeds.map((f) => (
              <FeedStatRow key={f.feedId} feed={f}
                statText={statFn(f)}
                badgeColor={badgeFn?.(f) ?? "text-outline bg-outline/10 border-outline/20"}
                onUnsubscribe={() => onUnsubscribe(f.feedId, f.feedTitle)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FeedStatRow({ feed, statText, badgeColor, onUnsubscribe }: {
  feed: ClassifiedFeed; statText: string; badgeColor: string; onUnsubscribe: () => void;
}) {
  return (
    <li className="flex items-center justify-between gap-3 border border-outline-variant/30 bg-background/50 hover:bg-surface-container-low transition-colors px-3 py-2.5 group">
      <div className="flex flex-col min-w-0 flex-1">
        <span className="text-xs font-bold truncate pr-1">{feed.feedTitle}</span>
        <div className="flex items-center gap-1.5 mt-1">
          <span className="text-[8px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 border border-outline-variant bg-surface-container text-outline">
            {feed.folder}
          </span>
          <span className={`text-[8px] font-label font-bold uppercase tracking-wider px-1.5 py-0.5 border ${badgeColor}`}>
            {statText}
          </span>
        </div>
      </div>
      <button onClick={onUnsubscribe} aria-label={`Unsubscribe from ${feed.feedTitle}`}
        className="text-outline hover:text-error hover:bg-error/10 p-1.5 opacity-0 group-hover:opacity-100 transition-all duration-150">
        <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" clipRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" />
        </svg>
      </button>
    </li>
  );
}
