export interface Feed {
  id: string;
  url: string;
  title: string | null;
  site_url: string | null;
  last_fetched_at: string | null;
  etag: string | null;
  fetch_interval: number;
  created_at: string;
}

export interface FeedItem {
  id: string;
  feed_id: string;
  title: string | null;
  link: string | null;
  content: string | null;
  published_at: string | null;
  guid: string;
  author: string | null;
  thumbnail_url: string | null;
  created_at: string;
}

export interface Subscription {
  id: string;
  feed_id: string;
  folder: string | null;
  created_at: string;
}

export interface ItemState {
  item_id: string;
  is_read: boolean;
  is_saved: boolean;
  is_starred: boolean;
  updated_at: string;
}

// Joined shape returned by getSubscribedFeeds()
export interface SubscribedFeed extends Feed {
  folder: string | null;
  subscription_id: string;
}

// Joined shape returned by getTimelineItems()
export interface TimelineItem {
  id: string;
  title: string | null;
  link: string | null;
  content: string | null;
  published_at: string | null;
  feed_id: string;
  author: string | null;
  thumbnail_url: string | null;
  feed_title: string | null;
  is_read: boolean;
  is_saved: boolean;
  is_starred: boolean;
}

export interface TimelineOptions {
  feedIds: string[];
  cursor: string;       // ISO8601 — items strictly older than this; pass far-future for first page
  since: string | null; // ISO8601 lower bound, null means no lower bound
  limit: number;
  unreadOnly: boolean;
}

// Shape returned by getFeedAnalytics()
export interface FeedAnalytics {
  feed_id: string;
  feed_title: string | null;
  feed_url: string;
  site_url: string | null;
  folder: string | null;
  total_items: number;
  read_items: number;
  starred_items: number;
  last_fetched_at: string | null;
  fetch_interval: number;
  oldest_item_date: string | null;
  newest_item_date: string | null;
}

export interface FeedItemInsert {
  id: string;
  feed_id: string;
  title: string | null;
  link: string | null;
  content: string | null;
  published_at: string | null;
  guid: string;
  author: string | null;
  thumbnail_url: string | null;
}
