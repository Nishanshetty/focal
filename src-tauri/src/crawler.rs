use feed_rs::parser;
use reqwest::Client;
use scraper::{Html, Selector};
use serde::Serialize;
use sqlx::{sqlite::SqlitePool, Row};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use uuid::Uuid;

const REFRESH_INTERVAL_SECS: u64 = 900; // 15 minutes
const MAX_ITEMS_PER_FEED: i64 = 50;
const MAX_ITEM_AGE_DAYS: i64 = 30;

#[derive(Serialize, Clone)]
pub struct RefreshResult {
    pub new_items: usize,
    pub feeds_checked: usize,
}

async fn get_pool(app: &AppHandle) -> Result<SqlitePool, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("App data dir error: {e}"))?;
    let path = dir.join("focal.db");
    SqlitePool::connect(&format!("sqlite:{}", path.display()))
        .await
        .map_err(|e| format!("DB connect error: {e}"))
}

fn discover_feed_url(html: &str, base_url: &str) -> Option<String> {
    let doc = Html::parse_document(html);
    let sel = Selector::parse(
        "link[rel='alternate'][type='application/rss+xml'], \
         link[rel='alternate'][type='application/atom+xml']",
    )
    .ok()?;
    let href = doc.select(&sel).next()?.value().attr("href")?;
    if href.starts_with("http://") || href.starts_with("https://") {
        Some(href.to_string())
    } else {
        url::Url::parse(base_url)
            .ok()?
            .join(href)
            .ok()
            .map(|u| u.to_string())
    }
}

struct FeedItem {
    id: String,
    guid: String,
    title: Option<String>,
    link: Option<String>,
    content: Option<String>,
    published_at: Option<String>,
    author: Option<String>,
    thumbnail_url: Option<String>,
}

fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

async fn fetch_items(client: &Client, url: &str) -> Result<Vec<FeedItem>, String> {
    let resp = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("Fetch error: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = resp.bytes().await.map_err(|e| e.to_string())?;

    // Auto-discover if we got HTML back
    let feed_bytes: Vec<u8> = if content_type.contains("text/html") {
        if parser::parse(body.as_ref()).is_ok() {
            body.to_vec()
        } else {
            let html = String::from_utf8_lossy(&body);
            let discovered = discover_feed_url(&html, url)
                .ok_or_else(|| "No feed found at this URL".to_string())?;
            let r = client
                .get(&discovered)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            r.bytes().await.map_err(|e| e.to_string())?.to_vec()
        }
    } else {
        body.to_vec()
    };

    let feed = parser::parse(feed_bytes.as_slice()).map_err(|e| e.to_string())?;

    let items = feed
        .entries
        .into_iter()
        .map(|entry| {
            let link = entry.links.first().map(|l| l.href.clone());
            let guid = if entry.id.is_empty() {
                link.clone().unwrap_or_else(|| Uuid::new_v4().to_string())
            } else {
                entry.id.clone()
            };
            let content = entry.summary.as_ref().map(|s| {
                let stripped = strip_html(&s.content);
                stripped.chars().take(300).collect::<String>()
            });
            let published_at = entry
                .published
                .or(entry.updated)
                .map(|dt| dt.to_rfc3339());
            let author = entry.authors.first().map(|a| a.name.clone());
            let thumbnail_url = entry
                .media
                .iter()
                .flat_map(|m| m.thumbnails.iter())
                .next()
                .map(|t| t.image.uri.clone());
            FeedItem {
                id: Uuid::new_v4().to_string(),
                guid,
                title: entry.title.map(|t| t.content),
                link,
                content,
                published_at,
                author,
                thumbnail_url,
            }
        })
        .collect();

    Ok(items)
}

pub async fn do_refresh(app: &AppHandle) -> Result<RefreshResult, String> {
    let pool = get_pool(app).await?;

    let client = Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Focal/0.1)")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let rows = sqlx::query("SELECT f.id, f.url FROM feeds f JOIN subscriptions s ON s.feed_id = f.id")
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("Failed to query feeds: {e}"))?;

    let feeds_checked = rows.len();
    let mut new_items: usize = 0;

    for row in &rows {
        let feed_id: String = row.get("id");
        let feed_url: String = row.get("url");

        match fetch_items(&client, &feed_url).await {
            Ok(items) => {
                let count = items.len();
                let mut tx = match pool.begin().await {
                    Ok(t) => t,
                    Err(e) => { eprintln!("TX error for {feed_url}: {e}"); continue; }
                };

                for item in &items {
                    let _ = sqlx::query(
                        "INSERT INTO feed_items
                           (id, feed_id, title, link, content, published_at, guid, author, thumbnail_url)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                         ON CONFLICT (feed_id, guid) DO UPDATE SET
                           title         = excluded.title,
                           content       = excluded.content,
                           author        = excluded.author,
                           thumbnail_url = excluded.thumbnail_url",
                    )
                    .bind(&item.id)
                    .bind(&feed_id)
                    .bind(&item.title)
                    .bind(&item.link)
                    .bind(&item.content)
                    .bind(&item.published_at)
                    .bind(&item.guid)
                    .bind(&item.author)
                    .bind(&item.thumbnail_url)
                    .execute(&mut *tx)
                    .await;
                }

                let _ = sqlx::query(
                    "UPDATE feeds SET last_fetched_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?",
                )
                .bind(&feed_id)
                .execute(&mut *tx)
                .await;

                if tx.commit().await.is_ok() {
                    new_items += count;
                    let _ = sqlx::query(
                        "DELETE FROM feed_items
                         WHERE feed_id = ?
                           AND id NOT IN (SELECT item_id FROM item_states WHERE is_starred = 1)
                           AND (
                             published_at < datetime('now', printf('-%d days', ?))
                             OR id NOT IN (
                               SELECT id FROM feed_items
                               WHERE feed_id = ?
                               ORDER BY published_at DESC
                               LIMIT ?
                             )
                           )",
                    )
                    .bind(&feed_id)
                    .bind(MAX_ITEM_AGE_DAYS)
                    .bind(&feed_id)
                    .bind(MAX_ITEMS_PER_FEED)
                    .execute(&pool)
                    .await;
                }
            }
            Err(e) => eprintln!("Failed to refresh {feed_url}: {e}"),
        }
    }

    pool.close().await;
    Ok(RefreshResult { new_items, feeds_checked })
}

/// Background loop — spawned once on app startup.
pub async fn run_crawler(app: AppHandle) {
    loop {
        tokio::time::sleep(Duration::from_secs(REFRESH_INTERVAL_SECS)).await;
        match do_refresh(&app).await {
            Ok(result) => {
                let _ = app.emit("focal://feeds-refreshed", result);
            }
            Err(e) => eprintln!("Background crawler error: {e}"),
        }
    }
}

/// Tauri command — called by the refresh button for an immediate refresh.
#[tauri::command]
pub async fn refresh_feeds_now(app: AppHandle) -> Result<RefreshResult, String> {
    let result = do_refresh(&app).await?;
    let _ = app.emit("focal://feeds-refreshed", result.clone());
    Ok(result)
}
