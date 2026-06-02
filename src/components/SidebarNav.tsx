import { useState } from "react";
import { Link } from "@tanstack/react-router";

export type FeedEntry = {
  subId: string;
  feedId: string;
  title: string;
  unread: number;
};

export type NavFilter = {
  feedId?: string;
  folder?: string;
  unread?: boolean;
};

type Props = {
  groups: Record<string, FeedEntry[]>;
  activeFeedId: string | null;
  activeFolder: string | null;
  activeUnread: boolean;
  onNavigate: (filter: NavFilter) => void;
  onUnsubscribe: (subId: string, feedId: string, title: string) => void;
};

export default function SidebarNav({ groups, activeFeedId, activeFolder, activeUnread, onNavigate, onUnsubscribe }: Props) {
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

  function toggleFolder(folder: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev);
      next.has(folder) ? next.delete(folder) : next.add(folder);
      return next;
    });
  }

  const isAllActive = !activeFeedId && !activeFolder && !activeUnread;
  const totalUnread = Object.values(groups).flat().reduce((sum, e) => sum + e.unread, 0);

  const navRow = (label: string, active: boolean, badge: number | null, onClick: () => void) => (
    <button onClick={onClick}
      className={["flex w-full items-center justify-between px-3 py-2 text-[13px] font-body transition-all duration-200",
        active ? "border-l-2 border-primary bg-surface-container-low text-primary font-bold"
               : "text-on-surface-variant hover:bg-surface-container hover:text-on-surface border-l-2 border-transparent",
      ].join(" ")}>
      <span>{label}</span>
      {badge !== null && badge > 0 && (
        <span className="text-[10px] font-label opacity-60">{badge > 99 ? "99+" : badge}</span>
      )}
    </button>
  );

  return (
    <nav className="flex-1 overflow-y-auto scrollbar-hide py-3">
      {navRow("All Articles", isAllActive, totalUnread, () => onNavigate({}))}
      {navRow("Unread", activeUnread, null, () => onNavigate({ unread: true }))}
      <Link to="/analytics"
        className="flex w-full items-center justify-between px-3 py-2 text-[13px] font-body transition-all duration-200 text-on-surface-variant hover:bg-surface-container hover:text-on-surface border-l-2 border-transparent [&.active]:border-primary [&.active]:bg-surface-container-low [&.active]:text-primary [&.active]:font-bold">
        Analytics & Stats
      </Link>

      {Object.keys(groups).length === 0 && (
        <p className="px-4 py-3 text-xs text-outline font-label">No feeds yet. Add one above.</p>
      )}

      {Object.entries(groups).map(([folder, entries]) => {
        const isFolderActive = activeFolder === folder && !activeFeedId;
        const folderUnread = entries.reduce((sum, e) => sum + e.unread, 0);
        const isCollapsed = collapsedFolders.has(folder);
        const multiFolder = Object.keys(groups).length > 1;

        return (
          <div key={folder} className="mt-4">
            <div className="flex items-center gap-1 mb-1">
              {multiFolder ? (
                <button onClick={() => onNavigate({ folder })}
                  className={["flex flex-1 items-center gap-1.5 px-4 py-1 transition-colors",
                    isFolderActive ? "text-primary" : "text-outline hover:text-on-surface-variant"].join(" ")}>
                  <span className="text-[10px] font-label font-bold uppercase tracking-[0.1em]">{folder}</span>
                  {folderUnread > 0 && !isCollapsed && (
                    <span className="text-[10px] font-label opacity-60">{folderUnread > 99 ? "99+" : folderUnread}</span>
                  )}
                </button>
              ) : (
                <div className="flex-1 px-4 py-1">
                  <span className="text-[10px] font-label font-bold uppercase tracking-[0.1em] text-outline">{folder}</span>
                </div>
              )}
              <button onClick={() => toggleFolder(folder)} aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
                className="mr-2 p-1 text-outline transition-colors hover:text-on-surface-variant">
                <svg className={`h-3 w-3 transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>

            {!isCollapsed && (
              <ul>
                {entries.map((entry) => {
                  const isActive = activeFeedId === entry.feedId;
                  return (
                    <li key={entry.subId}
                      className={["group flex items-center transition-all duration-200",
                        isActive ? "border-l-2 border-primary bg-surface-container-low" : "border-l-2 border-transparent hover:bg-surface-container"].join(" ")}>
                      <button onClick={() => onNavigate({ feedId: entry.feedId })}
                        className={["flex min-w-0 flex-1 items-center justify-between px-3 py-2 text-[13px] font-body",
                          isActive ? "text-primary font-bold" : "text-on-surface-variant hover:text-on-surface"].join(" ")}>
                        <span className="truncate">{entry.title}</span>
                        {entry.unread > 0 && (
                          <span className="ml-2 shrink-0 text-[10px] font-label opacity-60">{entry.unread > 99 ? "99+" : entry.unread}</span>
                        )}
                      </button>
                      <button onClick={() => onUnsubscribe(entry.subId, entry.feedId, entry.title)}
                        aria-label={`Unsubscribe from ${entry.title}`}
                        className="mr-2 shrink-0 rounded p-1 text-outline opacity-0 transition-colors hover:text-error group-hover:opacity-100">
                        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" clipRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" />
                        </svg>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </nav>
  );
}
