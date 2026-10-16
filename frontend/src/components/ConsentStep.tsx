import { useEffect, useState } from "react";
import { api, type ConsentText } from "../api";

export function ConsentStep({ onConsented }: { onConsented: () => void }) {
  const [text, setText] = useState<ConsentText | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.consentText().then(setText).catch(() => setError("We couldn't load the consent notice. Please refresh."));
  }, []);

  async function accept() {
    try {
      await api.grantConsent();
      onConsented();
    } catch {
      setError("We couldn't save your consent. Please try again.");
    }
  }

  return (
    <section aria-labelledby="consent-title">
      <h1 id="consent-title">How we use your information</h1>
      {text && (
        <>
          <p>{text.summary}</p>
          <ul>
            {text.points.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="hint">Notice version {text.version}</p>
        </>
      )}
      <div className="check">
        <input id="agree" type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
        <label htmlFor="agree">I have read this and agree to continue.</label>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button type="button" disabled={!agreed} onClick={accept}>
        Agree and continue
      </button>
    </section>
  );
}
