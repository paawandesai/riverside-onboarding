import { useState, type FormEvent } from "react";
import { api, ApiError, track, type AssessmentFields, type ChatTurn, type SupportContent } from "../api";

const GREETING =
  "Hi, I'm the sign-up assistant. What's the main reason you'd like to see someone? You can also say if you prefer in person or telehealth.";

type Props = { onDone: () => void; onSupport: (c: SupportContent) => void; onOpenScheduling: () => void };

export function ChatStep({ onDone, onSupport, onOpenScheduling }: Props) {
  const [turns, setTurns] = useState<ChatTurn[]>([{ role: "assistant", content: GREETING }]);
  const [draft, setDraft] = useState("");
  const [fields, setFields] = useState<AssessmentFields>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [disclosure, setDisclosure] = useState("You're chatting with an AI assistant. A member of our care team reviews your answers before your visit.");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    const next: ChatTurn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setDraft("");
    setBusy(true);
    setError(null);
    try {
      const res = await api.chat(next);
      setTurns([...next, { role: "assistant", content: res.reply }]);
      setFields((f) => ({ ...f, ...res.fields }));
      setNotice(res.notice);
      setDisclosure(res.disclosure);
      if (res.support) onSupport(res.support);
      if (res.ui_action === "open_scheduling") onOpenScheduling();
      track("assessment", res.mode === "ai" ? "turn_ai" : "turn_fallback");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "The assistant isn't available. You can fill in the form below.");
      setNotice("The assistant isn't available right now. You can fill in the form below instead.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    try {
      await api.saveAssessment(fields);
      track("assessment", "confirmed");
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "We couldn't save your answers.");
    }
  }

  const update = (key: keyof AssessmentFields, value: string) => setFields({ ...fields, [key]: value || null });

  return (
    <section aria-labelledby="chat-title">
      <h1 id="chat-title">About your visit</h1>
      <p className="disclosure">
        <span aria-hidden="true">🤖 </span>
        {disclosure}
      </p>
      <ol className="chat" aria-live="polite" aria-label="Conversation">
        {turns.map((t, i) => (
          <li key={i} className={`bubble bubble--${t.role}`}>
            <span className="visually-hidden">{t.role === "user" ? "You said:" : "Assistant said:"}</span>
            {t.content}
          </li>
        ))}
      </ol>
      <form onSubmit={send} className="row">
        <label htmlFor="chat-input" className="visually-hidden">
          Your message
        </label>
        <input id="chat-input" value={draft} maxLength={1000} onChange={(e) => setDraft(e.target.value)} disabled={busy} />
        <button type="submit" disabled={busy || !draft.trim()}>
          {busy ? "Sending…" : "Send"}
        </button>
      </form>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <fieldset>
        <legend>Your answers (you can edit these)</legend>
        <label htmlFor="reason">Reason for visit</label>
        <input id="reason" value={fields.reason_for_visit ?? ""} maxLength={300} onChange={(e) => update("reason_for_visit", e.target.value)} />
        <label htmlFor="duration">How long has this been going on?</label>
        <input id="duration" value={fields.symptom_duration ?? ""} maxLength={300} onChange={(e) => update("symptom_duration", e.target.value)} />
        <label htmlFor="visit-type">Visit type</label>
        <select
          id="visit-type"
          value={fields.visit_type_preference ?? ""}
          onChange={(e) => update("visit_type_preference", e.target.value)}
        >
          <option value="">Not specified</option>
          <option value="in_person">In person</option>
          <option value="telehealth">Telehealth</option>
          <option value="no_preference">No preference</option>
        </select>
        <label htmlFor="access">Accessibility needs</label>
        <input id="access" value={fields.accessibility_needs ?? ""} maxLength={300} onChange={(e) => update("accessibility_needs", e.target.value)} />
      </fieldset>
      <button type="button" onClick={confirm}>
        Save answers and choose a time
      </button>
    </section>
  );
}
