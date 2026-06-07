use serde::{Deserialize, Serialize};

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
struct ChatResponse {
    message: ChatResponseMessage,
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

    Ok(result.response.trim().to_string())
}

#[tauri::command]
pub async fn chat_article(
    base_url: String,
    model: String,
    article_text: String,
    history: Vec<ChatMessage>,
    question: String,
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

    let result: ChatResponse = resp
        .json()
        .await
        .map_err(|e| format!("Invalid response: {e}"))?;

    Ok(result.message.content.trim().to_string())
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
