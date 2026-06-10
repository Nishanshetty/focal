# Focal

> **Because focus matters.**

A local-first RSS reader for macOS. No accounts, no servers, no subscriptions — your feeds live on your machine.

<!-- TODO: add screenshot once first build is ready -->
<!-- ![Focal screenshot](docs/screenshot.png) -->

---

## Features

- **Local-first** — all data stored in SQLite on your Mac; works fully offline
- **RSS & Atom** — subscribe to any RSS/Atom feed; paste a site URL and Focal auto-discovers the feed
- **YouTube channels** — subscribe to channels by URL (`/channel/`, `/user/`, or `@handle` with API key)
- **Article reader** — distraction-free reading pane powered by Mozilla Readability (same engine as Firefox Reader View), with reading progress bar, read-time estimate, link hover previews, and a per-article accent color drawn from the lead image
- **Text to Speech** — paragraph-by-paragraph read-aloud via Google Cloud TTS (Neural2 voice), with playback speed control and click-a-paragraph to jump
- **AI features** — streamed article summaries, automatic key takeaways, chat about any article with suggested questions, and select-text Explain/Ask — all via a locally running [Ollama](https://ollama.com) model; fully private, no cloud required
- **Discover** — AI-generated search queries based on your subscriptions surface fresh articles from outside your feeds (requires Ollama)
- **Background refresh** — feeds refresh automatically every 15 minutes in Rust; no browser tab needed
- **OPML import/export** — migrate from Feedly, Inoreader, or any other reader instantly
- **Feed analytics** — identify noisy, ignored, and dead feeds to declutter your reading list
- **Keyboard shortcuts** — `j/k` navigate, `o/Enter` open, `m` toggle read, `s` star, `Shift+A` mark all read
- **Reader customisation** — Light / Sepia / Slate / Dark themes, font family, font size, column width, line spacing

---

## Download

Pre-built macOS universal binaries (arm64 + x86_64) are available on the [Releases](../../releases) page.

---

## Build from source

### Prerequisites

| Tool | Version |
|------|---------|
| [Rust](https://rustup.rs) | 1.80+ (stable) |
| Node.js | 18+ |
| Xcode Command Line Tools | Any recent version |

### Steps

```bash
git clone https://github.com/nishanshetty/focal.git
cd focal
npm install
npm run tauri dev        # development build with hot-reload
npm run tauri build      # production .dmg + .app
```

The production build outputs to `src-tauri/target/release/bundle/`.

---

## Configuring API keys

Open **Settings** (gear icon in the top bar) to configure optional integrations:

| Setting | Where to get it | Used for |
|---------|----------------|---------|
| **YouTube Data API key** | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → YouTube Data API v3 | Subscribing to `@handle` YouTube channels |
| **Google Cloud TTS credentials** | GCP Console → IAM → Service Accounts → create key (JSON) | Article read-aloud feature |
| **Ollama URL + model** | [ollama.com](https://ollama.com) — install locally, then `ollama pull llama3.2` | AI article summarization |

Credentials are stored locally in the app data directory via `tauri-plugin-store` — they never leave your machine.

### AI summarization setup

1. Install [Ollama](https://ollama.com) and pull a model: `ollama pull llama3.2`
2. Open Focal → Settings → **AI Summarization**
3. Toggle it on, confirm the URL (`http://localhost:11434`), hit **Test**
4. Open any article — a sparkle button (✦) appears in the reader header

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Shell | [Tauri 2](https://tauri.app) (Rust) |
| Frontend | React 18 + TypeScript + Tailwind CSS |
| Router | TanStack Router |
| Database | SQLite via `tauri-plugin-sql` + `sqlx` |
| Feed parsing | [`feed-rs`](https://crates.io/crates/feed-rs) |
| Article extraction | [`@mozilla/readability`](https://github.com/mozilla/readability) |
| HTTP | `reqwest` (Rust) |
| TTS auth | `jsonwebtoken` (RS256 JWT for Google OAuth2) |
| AI summarization | [Ollama](https://ollama.com) local HTTP API |
| Settings | `tauri-plugin-store` |

---

## Project structure

```
src/                  # React / TypeScript frontend
  components/         # UI components
  lib/                # db.ts, settings.ts, analytics.ts, hooks
  pages/              # TanStack Router pages
  types/              # TypeScript types
src-tauri/            # Rust / Tauri backend
  src/
    commands/         # fetch_feed, fetch_article_html, tts, ollama, resolve_youtube_handle
    crawler.rs        # background feed refresh loop
    lib.rs            # Tauri app setup
  migrations/         # SQLite schema
```

---

## License

[MIT](LICENSE) © 2026 Nishan Shetty
