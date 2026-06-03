import { Store } from "@tauri-apps/plugin-store";

const STORE_PATH = "settings.json";
let _store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!_store) {
    _store = await Store.load(STORE_PATH);
  }
  return _store;
}

export async function getYouTubeApiKey(): Promise<string> {
  const store = await getStore();
  return (await store.get<string>("youtube_api_key")) ?? "";
}

export async function setYouTubeApiKey(key: string): Promise<void> {
  const store = await getStore();
  await store.set("youtube_api_key", key);
  await store.save();
}

export async function getGcpTtsCredentials(): Promise<string> {
  const store = await getStore();
  return (await store.get<string>("gcp_tts_credentials")) ?? "";
}

export async function setGcpTtsCredentials(creds: string): Promise<void> {
  const store = await getStore();
  await store.set("gcp_tts_credentials", creds);
  await store.save();
}

export type OllamaSettings = {
  enabled: boolean;
  url: string;
  model: string;
};

const OLLAMA_DEFAULTS: OllamaSettings = {
  enabled: false,
  url: "http://localhost:11434",
  model: "llama3.2",
};

export async function getOllamaSettings(): Promise<OllamaSettings> {
  const store = await getStore();
  const enabled = (await store.get<boolean>("ollama_enabled")) ?? OLLAMA_DEFAULTS.enabled;
  const url = (await store.get<string>("ollama_url")) ?? OLLAMA_DEFAULTS.url;
  const model = (await store.get<string>("ollama_model")) ?? OLLAMA_DEFAULTS.model;
  return { enabled, url, model };
}

export async function setOllamaSettings(settings: OllamaSettings): Promise<void> {
  const store = await getStore();
  await store.set("ollama_enabled", settings.enabled);
  await store.set("ollama_url", settings.url);
  await store.set("ollama_model", settings.model);
  await store.save();
}
