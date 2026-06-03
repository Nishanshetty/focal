import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link } from "@tanstack/react-router";
import {
  getYouTubeApiKey, setYouTubeApiKey,
  getGcpTtsCredentials, setGcpTtsCredentials,
  getOllamaSettings, setOllamaSettings,
  type OllamaSettings,
} from "../lib/settings";

type SaveState = "idle" | "saving" | "saved" | "error";

function SettingField({
  label, description, value, onChange, onSave, placeholder, type = "text", saveState,
}: {
  label: string; description: string; value: string; onChange: (v: string) => void;
  onSave: () => void; placeholder: string; type?: string; saveState: SaveState;
}) {
  return (
    <div className="border border-outline-variant/40 p-5 space-y-3">
      <div>
        <p className="text-sm font-headline font-semibold text-on-surface">{label}</p>
        <p className="text-xs font-body text-on-surface-variant mt-0.5">{description}</p>
      </div>
      <div className="flex gap-2">
        {type === "textarea" ? (
          <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={4}
            className="flex-1 ghost-border bg-surface-container-low px-3 py-2 text-xs font-body text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary resize-y" />
        ) : (
          <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
            className="flex-1 ghost-border bg-surface-container-low px-3 py-2 text-xs font-body text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary" />
        )}
        <button onClick={onSave} disabled={saveState === "saving"}
          className="shrink-0 bg-primary-container px-4 py-2 text-[11px] font-label font-bold uppercase tracking-widest text-on-primary-container transition-opacity hover:opacity-90 disabled:opacity-40">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved ✓" : saveState === "error" ? "Error" : "Save"}
        </button>
      </div>
    </div>
  );
}

type OllamaCheckState = "idle" | "checking" | "ok" | "error";

function OllamaSection() {
  const [settings, setSettings] = useState<OllamaSettings>({ enabled: false, url: "http://localhost:11434", model: "llama3.2" });
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [checkState, setCheckState] = useState<OllamaCheckState>("idle");
  const [checkMessage, setCheckMessage] = useState("");

  useEffect(() => {
    getOllamaSettings().then(setSettings).catch(console.error);
  }, []);

  async function save(updated: OllamaSettings) {
    setSaveState("saving");
    try {
      await setOllamaSettings(updated);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch {
      setSaveState("error");
    }
  }

  async function checkConnection() {
    setCheckState("checking");
    setCheckMessage("");
    try {
      const models = await invoke<string[]>("check_ollama", { baseUrl: settings.url });
      const match = models.find((m) => m.startsWith(settings.model));
      if (match) {
        setCheckMessage(`Model "${match}" found`);
        setCheckState("ok");
      } else if (models.length > 0) {
        setCheckMessage(`Ollama reachable. Model "${settings.model}" not found. Available: ${models.slice(0, 3).join(", ")}`);
        setCheckState("error");
      } else {
        setCheckMessage("Ollama reachable but no models installed. Run: ollama pull " + settings.model);
        setCheckState("error");
      }
    } catch (err) {
      setCheckMessage(String(err));
      setCheckState("error");
    }
  }

  function update(patch: Partial<OllamaSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    setCheckState("idle");
    setCheckMessage("");
    save(next);
  }

  return (
    <section className="space-y-3">
      <h2 className="text-[10px] font-label font-bold uppercase tracking-widest text-outline">AI Summarization</h2>

      {/* Enable toggle */}
      <div className="border border-outline-variant/40 p-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-headline font-semibold text-on-surface">Enable Ollama Summarization</p>
          <p className="text-xs font-body text-on-surface-variant mt-0.5">
            Adds a Summarize button in the article reader. Requires a locally running Ollama instance.
          </p>
        </div>
        <button
          role="switch"
          aria-checked={settings.enabled}
          onClick={() => update({ enabled: !settings.enabled })}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${settings.enabled ? "bg-primary" : "bg-outline/30"}`}
        >
          <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform duration-200 ${settings.enabled ? "translate-x-5" : "translate-x-0"}`} />
        </button>
      </div>

      {/* URL and model config */}
      <div className="border border-outline-variant/40 p-5 space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-headline font-semibold text-on-surface">Ollama Base URL</p>
          <div className="flex gap-2">
            <input
              value={settings.url}
              onChange={(e) => setSettings((s) => ({ ...s, url: e.target.value }))}
              onBlur={() => save(settings)}
              placeholder="http://localhost:11434"
              className="flex-1 ghost-border bg-surface-container-low px-3 py-2 text-xs font-body text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-headline font-semibold text-on-surface">Model</p>
          <div className="flex gap-2">
            <input
              value={settings.model}
              onChange={(e) => setSettings((s) => ({ ...s, model: e.target.value }))}
              onBlur={() => save(settings)}
              placeholder="llama3.2"
              className="flex-1 ghost-border bg-surface-container-low px-3 py-2 text-xs font-body text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              onClick={checkConnection}
              disabled={checkState === "checking"}
              className="shrink-0 bg-primary-container px-4 py-2 text-[11px] font-label font-bold uppercase tracking-widest text-on-primary-container transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {checkState === "checking" ? "Checking…" : "Test"}
            </button>
          </div>
        </div>

        {checkMessage && (
          <p className={`text-[11px] font-body ${checkState === "ok" ? "text-primary" : "text-error"}`}>
            {checkState === "ok" ? "✓ " : "✗ "}{checkMessage}
          </p>
        )}

        <p className="text-[10px] font-body text-on-surface-variant">
          To install a model: <code className="bg-surface-container px-1 py-0.5 rounded text-[10px]">ollama pull {settings.model || "llama3.2"}</code>
        </p>

        {saveState === "saved" && (
          <p className="text-[11px] font-label text-primary">Settings saved ✓</p>
        )}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const [ytKey, setYtKey] = useState("");
  const [ytSave, setYtSave] = useState<SaveState>("idle");
  const [ttsCredentials, setTtsCredentials] = useState("");
  const [ttsSave, setTtsSave] = useState<SaveState>("idle");

  useEffect(() => {
    getYouTubeApiKey().then(setYtKey).catch(console.error);
    getGcpTtsCredentials().then(setTtsCredentials).catch(console.error);
  }, []);

  async function saveYtKey() {
    setYtSave("saving");
    try { await setYouTubeApiKey(ytKey); setYtSave("saved"); setTimeout(() => setYtSave("idle"), 2000); }
    catch { setYtSave("error"); }
  }

  async function saveTtsCredentials() {
    setTtsSave("saving");
    try { await setGcpTtsCredentials(ttsCredentials); setTtsSave("saved"); setTimeout(() => setTtsSave("idle"), 2000); }
    catch { setTtsSave("error"); }
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-4 border-b border-outline-variant/40 bg-background/80 backdrop-blur-xl px-6">
        <Link to="/" aria-label="Back to reader"
          className="rounded p-1.5 text-on-surface-variant transition-colors hover:text-primary">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <span className="font-headline text-lg font-bold tracking-[0.2em] text-primary uppercase">Settings</span>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="mx-auto max-w-2xl space-y-8">

          <section className="space-y-3">
            <h2 className="text-[10px] font-label font-bold uppercase tracking-widest text-outline">YouTube</h2>
            <SettingField
              label="YouTube Data API Key"
              description="Required to subscribe to YouTube @handle channels. Get a key from Google Cloud Console."
              value={ytKey} onChange={setYtKey} onSave={saveYtKey}
              placeholder="AIzaSy..." saveState={ytSave} />
          </section>

          <section className="space-y-3">
            <h2 className="text-[10px] font-label font-bold uppercase tracking-widest text-outline">Text to Speech</h2>
            <SettingField
              label="Google Cloud TTS Credentials"
              description="Paste the contents of your GCP service account JSON file. Used for the article read-aloud feature."
              value={ttsCredentials} onChange={setTtsCredentials} onSave={saveTtsCredentials}
              placeholder='{ "type": "service_account", ... }' type="textarea" saveState={ttsSave} />
          </section>

          <OllamaSection />

        </div>
      </div>
    </div>
  );
}
