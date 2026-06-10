use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

#[derive(Deserialize)]
pub struct DigestArticle {
    pub title: String,
    pub content: String,
    pub feed_title: String,
}

#[derive(Serialize)]
pub struct DigestResult {
    pub overall_summary: String,
    pub article_count: usize,
}

#[derive(Deserialize)]
struct OllamaTagsResponse {
    models: Vec<OllamaModel>,
}

#[derive(Deserialize, Serialize)]
pub struct OllamaModel {
    pub name: String,
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    model: &'a str,
    prompt: String,
    stream: bool,
}

#[derive(Deserialize)]
struct GenerateResponse {
    response: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Serialize)]
struct ChatRequest<'a> {
    model: &'a str,
    messages: Vec<ChatMessage>,
    stream: bool,
}

#[derive(Deserialize)]
struct ChatResponseMessage {
    content: String,
}

#[derive(Deserialize)]
struct GenerateStreamChunk {
    #[serde(default)]
    response: String,
}

#[derive(Deserialize)]
struct ChatStreamChunk {
    message: Option<ChatResponseMessage>,
}

/// Reads an NDJSON streaming response line by line, buffering across chunk
/// boundaries (a JSON line or UTF-8 sequence may be split between chunks).
async fn read_ndjson_lines<F: FnMut(&str)>(
    resp: &mut reqwest::Response,
    mut on_line: F,
) -> Result<(), String> {
    let mut buf: Vec<u8> = Vec::new();
    while let Some(chunk) = resp
        .chunk()
        .await
        .map_err(|e| format!("Stream error: {e}"))?
    {
        buf.extend_from_slice(&chunk);
        while let Some(pos) = buf.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = buf.drain(..=pos).collect();
            let line = String::from_utf8_lossy(&line_bytes);
            let line = line.trim();
            if !line.is_empty() {
                on_line(line);
            }
        }
    }
    if !buf.is_empty() {
        let line = String::from_utf8_lossy(&buf);
        let line = line.trim();
        if !line.is_empty() {
            on_line(line);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn check_ollama(base_url: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}/api/tags", base_url.trim_end_matches('/'));
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Cannot reach Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let tags: OllamaTagsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    Ok(tags.models.into_iter().map(|m| m.name).collect())
}

#[tauri::command]
pub async fn summarize_article(
    base_url: String,
    model: String,
    text: String,
    on_token: Channel<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    // Truncate to keep prompt manageable for smaller models
    let truncated: String = text.chars().take(4000).collect();

    let prompt = format!(
        "Summarize the following article in 3-5 sentences. Be concise and factual. \
Do not begin with \"This article\" or \"The article\". Just give the summary.\n\n---\n{truncated}"
    );

    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = GenerateRequest {
        model: &model,
        prompt,
        stream: true,
    };

    let mut resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let mut full = String::new();
    read_ndjson_lines(&mut resp, |line| {
        if let Ok(chunk) = serde_json::from_str::<GenerateStreamChunk>(line) {
            if !chunk.response.is_empty() {
                full.push_str(&chunk.response);
                let _ = on_token.send(chunk.response);
            }
        }
    })
    .await?;

    Ok(full.trim().to_string())
}

#[tauri::command]
pub async fn chat_article(
    base_url: String,
    model: String,
    article_text: String,
    history: Vec<ChatMessage>,
    question: String,
    on_token: Channel<String>,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let truncated: String = article_text.chars().take(6000).collect();

    let system = ChatMessage {
        role: "system".to_string(),
        content: format!(
            "You are a helpful assistant. Answer questions about the following article. \
Be concise and accurate. If the answer isn't in the article, say so.\n\n---\n{truncated}"
        ),
    };

    let user_msg = ChatMessage {
        role: "user".to_string(),
        content: question,
    };

    let mut messages = vec![system];
    messages.extend(history);
    messages.push(user_msg);

    let url = format!("{}/api/chat", base_url.trim_end_matches('/'));
    let body = ChatRequest {
        model: &model,
        messages,
        stream: true,
    };

    let mut resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let mut full = String::new();
    read_ndjson_lines(&mut resp, |line| {
        if let Ok(chunk) = serde_json::from_str::<ChatStreamChunk>(line) {
            if let Some(msg) = chunk.message {
                if !msg.content.is_empty() {
                    full.push_str(&msg.content);
                    let _ = on_token.send(msg.content);
                }
            }
        }
    })
    .await?;

    Ok(full.trim().to_string())
}

#[tauri::command]
pub async fn suggest_questions(
    base_url: String,
    model: String,
    article_text: String,
    history: Vec<ChatMessage>,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let truncated: String = article_text.chars().take(3000).collect();

    let context = if history.is_empty() {
        format!("Article:\n{truncated}")
    } else {
        let convo: String = history
            .iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n");
        format!("Article:\n{truncated}\n\nConversation so far:\n{convo}")
    };

    let prompt = format!(
        "{context}\n\n\
Suggest exactly 3 short, distinct questions a reader might want to ask next. \
Return ONLY a JSON array of 3 strings, no explanation, no markdown. \
Example: [\"What caused X?\", \"How does Y work?\", \"What is the impact of Z?\"]"
    );

    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = GenerateRequest {
        model: &model,
        prompt,
        stream: false,
    };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let result: GenerateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    // Extract the JSON array from the response, tolerating extra text around it
    let raw = result.response.trim();
    let start = raw.find('[').ok_or("No JSON array in response")?;
    let end = raw.rfind(']').ok_or("No JSON array in response")?;
    let json_str = &raw[start..=end];
    let questions: Vec<String> =
        serde_json::from_str(json_str).map_err(|e| format!("Could not parse suggestions: {e}"))?;

    Ok(questions.into_iter().take(3).collect())
}

#[tauri::command]
pub async fn key_takeaways(
    base_url: String,
    model: String,
    text: String,
) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| e.to_string())?;

    let truncated: String = text.chars().take(4000).collect();

    let prompt = format!(
        "Article:\n{truncated}\n\n\
Extract exactly 3 key takeaways from this article. Each must be one crisp, factual sentence. \
Return ONLY a JSON array of 3 strings, no explanation, no markdown. \
Example: [\"First takeaway.\", \"Second takeaway.\", \"Third takeaway.\"]"
    );

    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = GenerateRequest {
        model: &model,
        prompt,
        stream: false,
    };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let result: GenerateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    let raw = result.response.trim();
    let start = raw.find('[').ok_or("No JSON array in response")?;
    let end = raw.rfind(']').ok_or("No JSON array in response")?;
    let takeaways: Vec<String> = serde_json::from_str(&raw[start..=end])
        .map_err(|e| format!("Could not parse takeaways: {e}"))?;

    Ok(takeaways
        .into_iter()
        .filter(|t| !t.trim().is_empty())
        .take(3)
        .collect())
}

#[tauri::command]
pub async fn generate_digest(
    base_url: String,
    model: String,
    articles: Vec<DigestArticle>,
) -> Result<DigestResult, String> {
    let article_count = articles.len();
    if article_count == 0 {
        return Ok(DigestResult {
            overall_summary: String::new(),
            article_count: 0,
        });
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    // Group articles by feed and build a compact prompt (300 chars per article)
    let mut by_feed: std::collections::BTreeMap<&str, Vec<&DigestArticle>> =
        std::collections::BTreeMap::new();
    for a in articles.iter().take(40) {
        by_feed.entry(a.feed_title.as_str()).or_default().push(a);
    }

    let mut sections = String::new();
    for (feed, items) in &by_feed {
        sections.push_str(&format!("\n== {feed} ==\n"));
        for (i, a) in items.iter().enumerate() {
            let snippet: String = a.content.chars().take(300).collect();
            sections.push_str(&format!("{}. \"{}\"\n{snippet}\n\n", i + 1, a.title));
        }
    }

    let prompt = format!(
        "The following are news articles published in the last 24 hours, grouped by source.\n\
Write exactly 4-6 key highlights covering the main themes and notable stories. \
Each highlight must be one crisp sentence. \
Output ONLY a plain list — one highlight per line, each line starting with \"- \". \
No intro, no outro, no blank lines between items, no markdown other than the leading dash.\n\
{sections}"
    );

    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = GenerateRequest {
        model: &model,
        prompt,
        stream: false,
    };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let result: GenerateResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    Ok(DigestResult {
        overall_summary: result.response.trim().to_string(),
        article_count,
    })
}

#[tauri::command]
pub async fn generate_discover_queries(
    base_url: String,
    model: String,
    feed_titles: Vec<String>,
) -> Result<Vec<String>, String> {
    if feed_titles.is_empty() {
        return Ok(vec![]);
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;

    let titles = feed_titles.iter().take(20).cloned().collect::<Vec<_>>().join(", ");
    let prompt = format!(
        "Based on these RSS feed subscriptions: {titles}\n\
         Generate exactly 4 web search queries to discover new relevant articles the user would enjoy.\n\
         Return ONLY a valid JSON array of strings, nothing else.\n\
         Example: [\"query 1\", \"query 2\", \"query 3\", \"query 4\"]"
    );

    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = GenerateRequest { model: &model, prompt, stream: false };

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Failed to reach Ollama: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Ollama returned HTTP {}", resp.status()));
    }

    let result: GenerateResponse = resp.json().await.map_err(|e| e.to_string())?;
    let text = result.response.trim();

    let start = text.find('[').ok_or("No JSON array in response")?;
    let end = text.rfind(']').ok_or("No JSON array in response")?;
    let queries: Vec<String> = serde_json::from_str(&text[start..=end])
        .map_err(|e| format!("Failed to parse queries: {e}"))?;

    Ok(queries.into_iter().take(5).filter(|q| !q.trim().is_empty()).collect())
}
