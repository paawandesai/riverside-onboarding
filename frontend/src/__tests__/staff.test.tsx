import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch } from "../test-utils/mockFetch";
import { axeViolations, ME, renderApp } from "../test-utils/render";

const STAFF = { id: "s1", role: "staff" };
const slot = { id: 7, starts_at: new Date(2030, 0, 7, 9).toISOString(), duration_minutes: 30, visit_type: "in_person", clinician_label: "Clinician A (fictional)" };
const ITEM = { patient_id: "p1", full_name: "AVERY TESTCASE", confirmation_code: "AB12CD34", slot, identity_confirmed: true, assessment_confirmed: false };
const DETAIL = {
  patient_id: "p1",
  full_name: "AVERY TESTCASE",
  dob: "1980-04-02",
  address: "12 FICTION WAY, NOWHERE OH 44000",
  field_sources: { full_name: "ocr_confirmed", dob: "ocr_edited", address: "manual" },
  assessment: { reason_for_visit: "<b>Knee</b> pain", symptom_duration: null, visit_type_preference: "telehealth", accessibility_needs: null },
  assessment_summary: "Non-binding intake summary for staff review.",
  booking: ITEM,
};

test("staff see upcoming visits by day with intake status, then one patient's intake", async () => {
  mockFetch({
    "GET /api/auth/me": { body: STAFF },
    "GET /api/staff/schedule": { body: [ITEM] },
    "GET /api/staff/intakes/p1": { body: DETAIL },
  });
  const { container } = renderApp("/staff");
  expect(await screen.findByRole("heading", { level: 1, name: "Upcoming visits" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 2, name: "Monday, January 7" })).toBeInTheDocument();
  expect(screen.getByText("Details confirmed")).toBeInTheDocument();
  expect(screen.getByText("No visit answers")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Schedule" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "My information" })).not.toBeInTheDocument();
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.click(screen.getByRole("link", { name: "Open intake: AVERY TESTCASE" }));
  expect(await screen.findByRole("heading", { level: 1, name: "AVERY TESTCASE" })).toBeInTheDocument();
  expect(screen.getByText("From ID photo, corrected by patient")).toBeInTheDocument();
  expect(screen.getByText("Typed by patient")).toBeInTheDocument();
  const answers = screen.getByRole("region", { name: /What the patient told us/ });
  // Patient text is shown as text, never as markup.
  expect(within(answers).getByText("<b>Knee</b> pain")).toBeInTheDocument();
  expect(within(answers).getByText("Video (telehealth)")).toBeInTheDocument();
  expect(await axeViolations(container)).toEqual([]);
});

test("patients can't open the staff pages", async () => {
  const calls = mockFetch({ "GET /api/auth/me": { body: ME } });
  renderApp("/staff");
  expect(await screen.findByRole("alert")).toHaveTextContent("This page is for clinic staff.");
  expect(calls.some((c) => c.url.startsWith("/api/staff"))).toBe(false);
});

test("an intake that doesn't exist says so", async () => {
  mockFetch({ "GET /api/auth/me": { body: STAFF }, "GET /api/staff/intakes/p9": { status: 404, body: { detail: "No intake record." } } });
  renderApp("/staff/patients/p9");
  expect(await screen.findByText("This patient hasn't started their intake.")).toBeInTheDocument();
});

const ANALYTICS = {
  since: new Date(2030, 0, 1, 12).toISOString(),
  sessions: 12,
  funnel: [
    { step: "start", sessions: 10, share_of_start: 1, drop_off: null, median_seconds: 12, timed_sessions: 9 },
    { step: "account", sessions: 6, share_of_start: 0.6, drop_off: 0.4, median_seconds: 95, timed_sessions: 5 },
    { step: "done", sessions: 0, share_of_start: 0, drop_off: 1, median_seconds: null, timed_sessions: 0 },
  ],
  support_shown: { long_pause: 3 },
  ocr: [{ field: "dob", confirmed: 3, corrected: 1, typed: 2, correction_rate: 0.25 }],
  ocr_records: 6,
};

test("staff see funnel drop-off, time per step and OCR correction rates, and can change the period", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: STAFF },
    "GET /api/staff/analytics": { body: ANALYTICS },
  });
  const { container } = renderApp("/staff/analytics");
  expect(await screen.findByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
  const funnel = await screen.findByRole("region", { name: "Where patients drop off" });
  const account = within(funnel).getByRole("row", { name: /Account/ });
  expect(within(account).getByText("60%")).toBeInTheDocument();
  expect(within(account).getByText("40%")).toBeInTheDocument();
  expect(within(account).getByText("1 min 35 s")).toBeInTheDocument();
  const ocr = screen.getByRole("region", { name: "ID photo corrections" });
  expect(within(within(ocr).getByRole("row", { name: /Date of birth/ })).getByText("25%")).toBeInTheDocument();
  expect(screen.getByText("long pause: 3")).toBeInTheDocument();
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
  expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
  await vi.waitFor(() => expect(calls.some((c) => c.url === "/api/staff/analytics?days=30")).toBe(true));
});

test("made-up sample patients are labelled, and staff can sign out", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: STAFF },
    "GET /api/staff/schedule": { body: [{ ...ITEM, sample: true }] },
    "POST /api/auth/logout": { status: 204 },
  });
  renderApp("/staff");
  expect(await screen.findByText("Sample patient (made up)")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Analytics" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.url === "/api/auth/logout")).toBe(true));
});
