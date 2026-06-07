mod commands;
mod crawler;

use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "initial_schema",
        sql: include_str!("../migrations/001_initial.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:focal.db", migrations)
                .build(),
        )
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(crawler::run_crawler(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::credentials::get_credential,
            commands::credentials::set_credential,
            commands::feed::fetch_feed,
            commands::feed::resolve_youtube_handle,
            commands::extract::fetch_article_html,
            commands::tts::synthesize_speech,
            commands::ollama::check_ollama,
            commands::ollama::summarize_article,
            commands::ollama::chat_article,
            commands::ollama::suggest_questions,
            commands::ollama::generate_digest,
            crawler::refresh_feeds_now,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Focal");
}
