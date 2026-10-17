import { request, type Schemas } from "./client";

export { ApiError } from "./client";

export type Me = Schemas["MeOut"];
export type Progress = Schemas["ProgressOut"];
export type Consent = Schemas["ConsentOut"];
export type ConsentText = Schemas["ConsentTextOut"];
export type ExtractResult = Schemas["ExtractOut"];
export type ExtractedField = Schemas["ExtractedField"];
export type FieldName = "full_name" | "dob" | "address";
export type ChatTurn = Schemas["ChatTurn"];
export type ChatResult = Schemas["ChatOut"];
export type AssessmentFields = Schemas["ChatFieldsOut"];
export type SupportContent = Schemas["SupportCardOut"];
export type Signals = Schemas["SignalsIn"];
export type Slot = Schemas["SlotOut"];
export type Booking = Schemas["BookingOut"];
export type Conflict = Schemas["ConflictOut"];
export type Intake = Schemas["IntakeOut"];
export type FieldSource = "ocr_confirmed" | "ocr_edited" | "manual";

// The assistant has 6 s on the server and falls back to rules; 15 s here covers a slow network.
export const CHAT_TIMEOUT_MS = 15_000;

export const api = {
  me: () => request<Me>("GET", "/api/auth/me"),
  signup: (body: Schemas["SignupIn"]) => request<Me>("POST", "/api/auth/signup", { body }),
  login: (body: Schemas["LoginIn"]) => request<Me>("POST", "/api/auth/login", { body }),
  logout: () => request<void>("POST", "/api/auth/logout"),
  progress: () => request<Progress>("GET", "/api/progress"),
  consentText: () => request<ConsentText>("GET", "/api/consent/text"),
  consent: () => request<Consent>("GET", "/api/consent"),
  grantConsent: (photo_scan: boolean) => request<Consent>("POST", "/api/consent", { body: { photo_scan } }),
  revokeConsent: () => request<Consent>("POST", "/api/consent/revoke"),
  extract: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<ExtractResult>("POST", "/api/documents/extract", { form, timeoutMs: 30_000 });
  },
  intake: () => request<Intake>("GET", "/api/intake"),
  saveIdentity: (body: Schemas["IdentityIn"]) => request<Intake>("PUT", "/api/intake/identity", { body }),
  saveAssessment: (body: Schemas["AssessmentIn"]) => request<Intake>("PUT", "/api/intake/assessment", { body }),
  chat: (messages: ChatTurn[], signal?: AbortSignal) =>
    request<ChatResult>("POST", "/api/chat", { body: { messages }, timeoutMs: CHAT_TIMEOUT_MS, signal }),
  slots: (visitType?: string) => request<Slot[]>("GET", `/api/slots${visitType ? `?visit_type=${visitType}` : ""}`),
  book: (slotId: number) => request<Booking>("POST", "/api/bookings", { body: { slot_id: slotId } }),
  myBookings: () => request<Booking[]>("GET", "/api/bookings/mine"),
  cancelBooking: (id: string) => request<void>("POST", `/api/bookings/${id}/cancel`),
  support: (signals: Partial<Signals>) => request<Schemas["SupportOut"]>("POST", "/api/support/evaluate", { body: signals }),
  deleteData: () => request<void>("DELETE", "/api/me/data"),
  deleteAccount: () => request<void>("DELETE", "/api/me"),
};
