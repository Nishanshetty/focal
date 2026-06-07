use feed_rs::parser;
use scraper::{Html, Selector};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

#[derive(Serialize)]
pub struct ParsedFeedItem {
    pub id: String,
    pub guid: String,
    pub title: Option<String>,
    pub link: Option<String>,
    pub content: Option<String>,
    pub content_hash: Option<String>,
    pub published_at: Option<String>,
    pub author: Option<String>,
    pub thumbnail_url: Option<String>,
}

#[derive(Serialize)]
pub struct ParsedFeed {
    pub title: Option<String>,
    pub site_url: Option<String>,
    pub items: Vec<ParsedFeedItem>,
}

fn sha256(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    hex::encode(h.finalize())
}

fn youtube_to_feed_url(raw: &str) -> Option<String> {
    let parsed = url::Url::parse(raw).ok()?;
    let host = parsed.host_str()?;
    if !matches!(host, "youtube.com" | "www.youtube.com") {
        return None;
    }
    let path = parsed.path();
    if path.starts_with("/feeds/") {
        return Some(raw.to_string());
    }
    if let Some(rest) = path.strip_prefix("/channel/") {
        let id = rest.split('/').next()?;
        return Some(format!("https://www.youtube.com/feeds/videos.xml?channel_id={id}"));
    }
    if let Some(rest) = path.strip_prefix("/user/") {
        let user = rest.split('/').next()?;
        return Some(format!("https://www.youtube.com/feeds/videos.xml?user={user}"));
    }
    None
}

/// Scans an HTML page for <link rel="alternate" type="application/rss+xml|atom+xml"> tags
/// and returns the first discovered feed URL (resolved against the base URL).
fn discover_feed_url(html: &str, base_url: &str) -> Option<String> {
    let doc = Html::parse_document(html);
    let sel = Selector::parse(
        "link[rel='alternate'][type='application/rss+xml'], \
         link[rel='alternate'][type='application/atom+xml'], \
         link[rel='alternate'][type='application/feed+json']",
    )
    .ok()?;

    let href = doc.select(&sel).next()?.value().attr("href")?;

    // Resolve relative URLs against the base
    if href.starts_with("http://") || href.starts_with("https://") {
        Some(href.to_string())
    } else {
        let base = url::Url::parse(base_url).ok()?;
        base.join(href).ok().map(|u| u.to_string())
    }
}

fn parse_feed_bytes(body: &[u8]) -> Result<ParsedFeed, String> {
    let feed = parser::parse(body).map_err(|e| format!("Failed to parse feed: {e}"))?;

    let title = feed.title.map(|t| t.content);
    let site_url = feed.links.first().map(|l| l.href.clone());

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
            let content = entry
                .content
                .as_ref()
                .and_then(|c| c.body.clone())
                .or_else(|| entry.summary.as_ref().map(|s| s.content.clone()));
            let content_hash = content.as_deref().map(sha256);
            let published_at = entry.published.or(entry.updated).map(|dt| dt.to_rfc3339());
            let author = entry.authors.first().map(|a| a.name.clone());
            let thumbnail_url = entry
                .media
                .iter()
                .flat_map(|m| m.thumbnails.iter())
                .next()
                .map(|t| t.image.uri.clone());

            ParsedFeedItem {
                id: Uuid::new_v4().to_string(),
                guid,
                title: entry.title.map(|t| t.content),
                link,
                content,
                content_hash,
                published_at,
                author,
                thumbnail_url,
            }
        })
        .collect();

    Ok(ParsedFeed { title, site_url, items })
}

#[tauri::command]
pub async fn fetch_feed(url: String) -> Result<ParsedFeed, String> {
    let feed_url = youtube_to_feed_url(&url).unwrap_or_else(|| url.clone());

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (compatible; Focal/0.1)")
        .build()
        .map_err(|e| e.to_string())?;

    let response = client
        .get(&feed_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("Server returned HTTP {}", response.status()));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let body = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {e}"))?;

    // If the response is HTML, attempt feed autodiscovery before giving up.
    if content_type.contains("text/html") || content_type.is_empty() {
        // First try parsing as feed anyway (some servers send wrong content-type).
        if let Ok(parsed) = parse_feed_bytes(body.as_ref()) {
            return Ok(parsed);
        }

        let html = String::from_utf8_lossy(body.as_ref());
        let discovered = discover_feed_url(&html, &feed_url)
            .ok_or_else(|| "No RSS/Atom feed found at this URL. Try pasting the direct feed URL (e.g. /feed, /rss, /atom.xml).".to_string())?;

        let discovered_response = client
            .get(&discovered)
            .send()
            .await
            .map_err(|e| format!("Failed to fetch discovered feed: {e}"))?;

        let discovered_body = discovered_response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read discovered feed: {e}"))?;

        return parse_feed_bytes(discovered_body.as_ref());
    }

    parse_feed_bytes(body.as_ref())
}

/// Resolves a YouTube @handle to its Atom feed URL using the YouTube Data API v3.
#[tauri::command]
pub async fn resolve_youtube_handle(handle: String, api_key: String) -> Result<String, String> {
    #[derive(Deserialize)]
    struct Item { id: String }
    #[derive(Deserialize)]
    struct Response { items: Option<Vec<Item>> }

    let client = reqwest::Client::new();
    let url = format!(
        "https://www.googleapis.com/youtube/v3/channels?forHandle={}&part=id",
        handle.trim_start_matches('@'),
    );

    let resp = client
        .get(&url)
        .header("X-Goog-Api-Key", &api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("YouTube API error {status}: {body}"));
    }

    let data: Response = resp.json().await.map_err(|e| e.to_string())?;
    let channel_id = data.items
        .and_then(|items| items.into_iter().next())
        .map(|item| item.id)
        .ok_or_else(|| format!("No YouTube channel found for @{handle}"))?;

    Ok(format!("https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"))
}
