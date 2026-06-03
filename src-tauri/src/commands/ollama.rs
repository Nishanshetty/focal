use serde::{Deserialize, Serialize};

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
