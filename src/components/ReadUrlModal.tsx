import { useEffect, useRef, useState } from "react";

type Props = {
  onSubmit: (url: string) => void;
  onClose: () => void;
};

export default function ReadUrlModal({ onSubmit, onClose }: Props) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function handleSubmit() {
    const raw = value.trim();
    if (!raw) return;
    const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const parsed = new URL(withProtocol);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        setError("Only http and https URLs are supported");
        return;
      }
      setError("");
      onSubmit(parsed.href);
      onClose();
    } catch {
      setError("Invalid URL — please enter a valid web address");
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="fixed inset-0 z-50 flex items-start justify-center pt-32 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-xl bg-surface border border-outline-variant/40 shadow-2xl p-5">
          <p className="mb-3 text-[10px] font-label font-bold uppercase tracking-widest text-outline">
            Read Article URL
          </p>
          {error && (
            <p className="mb-2 text-[11px] font-body text-red-500">{error}</p>
          )}
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="url"
              value={value}
              onChange={(e) => { setValue(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }}
              placeholder="Paste article URL…"
              className="flex-1 ghost-border bg-surface-container-low px-3 py-2 text-sm font-body text-on-surface placeholder-outline focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button onClick={handleSubmit}
              className="ghost-border bg-primary px-4 py-2 text-[11px] font-label font-bold uppercase tracking-widest text-on-primary transition-opacity hover:opacity-90">
              Read
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
