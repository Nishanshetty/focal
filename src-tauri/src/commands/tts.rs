use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

#[derive(Deserialize)]
struct ServiceAccountCredentials {
    private_key: String,
    client_email: String,
    #[serde(default = "default_token_uri")]
    token_uri: String,
}

fn default_token_uri() -> String {
    "https://oauth2.googleapis.com/token".to_string()
}

#[derive(Serialize)]
struct JwtClaims {
    iss: String,
    scope: String,
    aud: String,
    exp: u64,
    iat: u64,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Deserialize)]
struct TtsResponse {
    #[serde(rename = "audioContent")]
    audio_content: String,
}

async fn get_access_token(
    client: &reqwest::Client,
    creds: &ServiceAccountCredentials,
) -> Result<String, String> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs();

    let claims = JwtClaims {
        iss: creds.client_email.clone(),
        scope: "https://www.googleapis.com/auth/cloud-platform".to_string(),
        aud: creds.token_uri.clone(),
        iat: now,
        exp: now + 3600,
    };

    let key = EncodingKey::from_rsa_pem(creds.private_key.as_bytes())
        .map_err(|e| format!("Invalid private key: {e}"))?;

    let jwt = encode(&Header::new(Algorithm::RS256), &claims, &key)
        .map_err(|e| format!("Failed to sign JWT: {e}"))?;

    let resp = client
        .post(&creds.token_uri)
        .form(&[
            ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
            ("assertion", &jwt),
        ])
        .send()
        .await
        .map_err(|e| format!("Token request failed: {e}"))?;

    if !resp.status().is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Token endpoint error: {body}"));
    }

    let token: TokenResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse token response: {e}"))?;

    Ok(token.access_token)
}

/// Synthesizes text to MP3 using Google Cloud TTS and returns base64-encoded audio.
#[tauri::command]
pub async fn synthesize_speech(text: String, app: AppHandle) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err("Text is empty".to_string());
    }

    // Read credentials from settings store
    let store = app
        .store("settings.json")
        .map_err(|e| format!("Store error: {e}"))?;

    let creds_json = store
        .get("gcp_tts_credentials")
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| {
            "TTS credentials not configured — add your GCP service account JSON in Settings".to_string()
        })?;

    let creds: ServiceAccountCredentials = serde_json::from_str(&creds_json)
        .map_err(|e| format!("Invalid TTS credentials JSON: {e}"))?;

    let client = reqwest::Client::new();
    let access_token = get_access_token(&client, &creds).await?;

    let body = serde_json::json!({
        "input": { "text": text.trim() },
        "voice": { "languageCode": "en-US", "name": "en-US-Neural2-F" },
        "audioConfig": { "audioEncoding": "MP3" }
    });

    let resp = client
        .post("https://texttospeech.googleapis.com/v1/text:synthesize")
        .bearer_auth(&access_token)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("TTS API request failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let err_body = resp.text().await.unwrap_or_default();
        return Err(format!("TTS API error {status}: {err_body}"));
    }

    let tts: TtsResponse = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse TTS response: {e}"))?;

    Ok(tts.audio_content)
}
