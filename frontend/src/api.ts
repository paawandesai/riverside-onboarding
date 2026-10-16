export class ApiError extends Error {
  status: number;
  fieldErrors: { field: string; message: string }[];
  constructor(status: number, message: string, fieldErrors: { field: string; message: string }[] = []) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body && !isForm ? { "Content-Type": "application/json" } : undefined,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "We couldn't reach the server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "Something went wrong. Please try again.";
    throw new ApiError(res.status, detail, Array.isArray(data.errors) ? data.errors : []);
  }
  return data as T;
}

export type FieldName = "full_name" | "dob" | "address";
export type ExtractedField = { value: string | null; confidence: number | null; status: "found" | "low_confidence" | "missing" };
export type ExtractResult = { fields: Record<FieldName, ExtractedField>; needs_review: FieldName[]; missing: FieldName[]; message: string };
export type ChatTurn = { role: "user" | "assistant"; content: string };
export type SupportContent = { trigger: string; title: string; body: string; actions: string[]; urgent: boolean };
export type AssessmentFields = {
  reason_for_visit?: string | null;
  symptom_duration?: string | null;
  visit_type_preference?: "in_person" | "telehealth" | "no_preference" | null;
  accessibility_needs?: string | null;
};
export type ChatResult = {
  mode: "ai" | "fallback";
  intent: string;
  reply: string;
  fields: AssessmentFields;
  support: SupportContent | null;
  ui_action: string | null;
  notice: string | null;
  disclosure: string;
};
export type Slot = { id: number; starts_at: string; duration_minutes: number; visit_type: string; clinician_label: string };
export type Booking = { id: string; status: string; confirmation_code: string; slot: Slot };
export type Consent = { active: boolean; version: string | null };
export type ConsentText = { version: string; summary: string; points: string[] };

export const api = {
  me: () => request<{ id: string; role: string }>("GET", "/api/auth/me"),
  signup: (body: { email: string; password: string; invite_code: string; adult_attestation: boolean }) =>
    request<{ id: string }>("POST", "/api/auth/signup", body),
  login: (body: { email: string; password: string }) => request<{ id: string }>("POST", "/api/auth/login", body),
  logout: () => request<void>("POST", "/api/auth/logout"),
  consentText: () => request<ConsentText>("GET", "/api/consent/text"),
  consent: () => request<Consent>("GET", "/api/consent"),
  grantConsent: () => request<Consent>("POST", "/api/consent"),
  revokeConsent: () => request<Consent>("POST", "/api/consent/revoke"),
  extract: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ExtractResult>("POST", "/api/documents/extract", form, true);
  },
  saveIdentity: (body: { full_name: string; dob: string; address: string; sources: Record<string, string> }) =>
    request<unknown>("PUT", "/api/intake/identity", body),
  saveAssessment: (body: AssessmentFields) => request<{ assessment_summary: string }>("PUT", "/api/intake/assessment", body),
  chat: (messages: ChatTurn[]) => request<ChatResult>("POST", "/api/chat", { messages }),
  slots: (visitType?: string) => request<Slot[]>("GET", `/api/slots${visitType ? `?visit_type=${visitType}` : ""}`),
  book: (slotId: number) => request<Booking>("POST", "/api/bookings", { slot_id: slotId }),
  myBookings: () => request<Booking[]>("GET", "/api/bookings/mine"),
  cancelBooking: (id: string) => request<void>("POST", `/api/bookings/${id}/cancel`),
  support: (signals: Record<string, number | boolean>) => request<{ content: SupportContent | null }>("POST", "/api/support/evaluate", signals),
  deleteData: () => request<void>("DELETE", "/api/me/data"),
  deleteAccount: () => request<void>("DELETE", "/api/me"),
};

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

/** First-party funnel event: step + event name + anonymous session id. Never any user data. */
export function track(step: string, event: string): void {
  void fetch("/api/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ anon_session_id: anonSessionId(), step_id: step, event }),
  }).catch(() => undefined);
}
