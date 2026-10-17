function anonSessionId(): string {
  try {
    const existing = sessionStorage.getItem("anon_session_id");
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem("anon_session_id", id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

/** First-party funnel event: step + event name + a random session id. Never any user data. */
export function track(step: string, event: string): void {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "onboarding-app" },
    body: JSON.stringify({ anon_session_id: anonSessionId(), step_id: step, event }),
  }).catch(() => undefined);
}
