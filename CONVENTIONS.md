# Focal — Session Log & Conventions

## Architecture Decisions
- All data local: SQLite via `tauri-plugin-sql`; no cloud backend
- Feed parsing in Rust (`feed-rs`); article extraction in JS (`@mozilla/readability`) via `fetch_article_html` Rust command (bypasses CORS)
- Background crawler is a Rust tokio thread; emits `focal://feeds-refreshed` Tauri event to frontend
- API keys stored in `tauri-plugin-store` (`settings.json` in app data dir); never leave the machine
- TTS uses Google Cloud REST API directly from Rust with RS256 JWT auth (`jsonwebtoken`)
- Ollama calls go through Rust (`reqwest`) to avoid WebView CORS/CSP issues — same pattern as TTS
- Ollama feature is off by default; enabled via Settings toggle; no DB changes (summary lives in component state)

## Session Log

### 2026-06-03 — Ollama AI Summarization (Phase 1)
- New Rust commands: `check_ollama` (probes `/api/tags`), `summarize_article` (calls `/api/generate`, stream:false)
- New file: `src-tauri/src/commands/ollama.rs`
- Settings: `getOllamaSettings` / `setOllamaSettings` in `settings.ts`; three new keys (`ollama_enabled`, `ollama_url`, `ollama_model`)
- SettingsPage: replaced "AI (coming soon)" stub with `OllamaSection` — enable toggle, URL field, model field, "Test" button with live reachability feedback
- ArticlePane: sparkle button in `PaneHeader` (only when `ollama_enabled`); summary card renders above article h1; cleared on article change; no DB writes

### 2026-06-02 — Full app built (Phases 1–8)
- Scaffolded Tauri 2 + Vite + React + TypeScript + Tailwind project (Phase 1)
- SQLite schema (`feeds`, `feed_items`, `subscriptions`, `item_states`) + TypeScript `db.ts` query layer (Phase 2)
- Rust commands: `fetch_feed` (RSS/Atom + feed autodiscovery), `fetch_article_html`, `synthesize_speech`, `resolve_youtube_handle` (Phase 3, 6, 7)
- Full UI migration from Feedwise: AppShell, Sidebar, Timeline, ArticlePane, AddFeedForm, all item-state mutations (Phase 4)
- Background Rust crawler with 15-min interval + `refresh_feeds_now` command replacing JS crawler (Phase 5)
- OPML import/export (client-side XML), Analytics dashboard, YouTube @handle resolution (Phase 7)
- Open source prep: MIT license, README, CONTRIBUTING, GitHub Actions universal macOS build CI (Phase 8)
- TODO: add real screenshots to README after first production build
- TODO: token caching for GCP TTS access tokens (currently fetches fresh per request)
