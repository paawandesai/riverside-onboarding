import { useState } from "react";
import { api } from "../api";

export function PrivacyPanel({ onRevoked, onDeleted }: { onRevoked: () => void; onDeleted: () => void }) {
  const [message, setMessage] = useState<string | null>(null);

  async function revoke() {
    if (!window.confirm("Withdraw consent? This deletes your details and appointment and stops processing.")) return;
    await api.revokeConsent();
    setMessage("Consent withdrawn. Your details and appointment have been deleted from our systems.");
    onRevoked();
  }

  async function deleteAccount() {
    if (!window.confirm("Delete your account and all your data? This can't be undone.")) return;
    await api.deleteAccount();
    onDeleted();
  }

  return (
    <section aria-labelledby="privacy-title" className="privacy">
      <h2 id="privacy-title">Privacy</h2>
      <p>
        You can withdraw consent or delete your data at any time. This deletes it from our systems. Copies of chat messages already sent to
        Anthropic's API follow its retention policy (up to 30 days by default).
      </p>
      <div className="row">
        <button type="button" className="secondary" onClick={revoke}>
          Withdraw consent and delete my data
        </button>
        <button type="button" className="danger" onClick={deleteAccount}>
          Delete my account
        </button>
      </div>
      <p aria-live="polite">{message}</p>
    </section>
  );
}
