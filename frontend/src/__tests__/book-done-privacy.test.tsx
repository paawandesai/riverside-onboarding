import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch } from "../test-utils/mockFetch";
import { axeViolations, ME, renderApp } from "../test-utils/render";

// Slots are shown in clinic time (US Eastern; UTC-5 in January), whatever the test machine's zone.
const day = (d: number, h: number, m = 0) => new Date(Date.UTC(2030, 0, d, h + 5, m)).toISOString();
const slot = (id: number, starts_at: string, visit_type = "in_person") => ({ id, starts_at, duration_minutes: 40, visit_type, clinician_label: "Dr. Rowan (fictional)" });
const SLOTS = [slot(1, day(7, 9)), slot(2, day(7, 10)), slot(3, day(7, 11)), slot(4, day(8, 9)), slot(5, day(8, 9, 40))];
const INTAKE = {
  full_name: "x",
  dob: "x",
  address: "x",
  field_sources: {},
  identity_confirmed: true,
  assessment: { visit_type_preference: "in_person" },
  assessment_summary: "Non-binding intake summary for staff review.\nReason for visit (patient's words): headaches\nHow long: two weeks",
  assessment_confirmed: true,
};
const BOOKING = { id: "b1", status: "booked", confirmation_code: "AB12CD34", slot: SLOTS[1] };

test("day chips then times; booking goes to the confirmation", async () => {
  let booked = false;
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "GET /api/intake": { body: INTAKE },
    "GET /api/slots": { body: SLOTS },
    "GET /api/bookings/mine": () => ({ body: booked ? [BOOKING] : [] }),
    "POST /api/bookings": () => ((booked = true), { status: 201, body: BOOKING }),
  });
  const { router, container } = renderApp("/book");
  const days = await screen.findByRole("group", { name: "Day" });
  expect(within(days).getAllByRole("button")).toHaveLength(2);
  expect(calls.some((c) => c.url === "/api/slots?visit_type=in_person")).toBe(true);
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Book this time" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Choose a time first.");

  await userEvent.click(screen.getByRole("button", { name: /10:00/ }));
  await userEvent.click(screen.getByRole("button", { name: "Book this time" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/done"));
  expect(await screen.findByRole("heading", { name: "You're booked" })).toBeInTheDocument();
  expect(screen.getByText(/Confirmation code AB12CD34/)).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: /add to calendar/i })).toHaveAttribute("download", "maple-grove-visit.ics");
  expect(screen.getByText(/Reason for visit \(patient's words\): headaches/)).toBeInTheDocument();
  expect(screen.getByText(/It's not a diagnosis\. Staff review it/)).toBeInTheDocument();
  expect(await axeViolations(container)).toEqual([]);
});

test("a taken time is reported inline with the closest times; a second conflict brings the support card", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "GET /api/intake": { body: INTAKE },
    "GET /api/slots": { body: SLOTS },
    "GET /api/bookings/mine": { body: [] },
    "POST /api/bookings": { status: 409, body: { detail: "Someone just booked that time.", alternatives: [SLOTS[0], SLOTS[2], SLOTS[3]] } },
    "POST /api/support/evaluate": {
      body: { content: { trigger: "booking_conflict", title: "Times are filling fast.", body: "...", actions: [{ id: "see_other_times", label: "See other times" }], urgent: false } },
    },
  });
  renderApp("/book");
  await userEvent.click(await screen.findByRole("button", { name: /10:00/ }));
  await userEvent.click(screen.getByRole("button", { name: "Book this time" }));
  const message = await screen.findByText(/Someone just booked 10:00/);
  await waitFor(() => expect(message.closest("[tabindex='-1']")).toHaveFocus());
  expect(screen.getByRole("button", { name: /9:00/ })).toHaveClass("chip--highlight");
  expect(calls.some((c) => c.url === "/api/support/evaluate")).toBe(false);

  await userEvent.click(screen.getByRole("button", { name: /11:00/ }));
  await userEvent.click(screen.getByRole("button", { name: "Book this time" }));
  expect(await screen.findByRole("complementary", { name: /filling fast/ })).toBeInTheDocument();
  expect(calls.find((c) => c.url === "/api/support/evaluate")!.body).toEqual({ booking_conflicts: 2 });
});

test("deleting the account asks first, then clears everything", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "GET /api/consent": { body: { active: true, version: "2026-10-v2", photo_scan: true } },
    "DELETE /api/me": { status: 204 },
  });
  const { router, container } = renderApp("/privacy");
  expect(await screen.findByText(/ID scanning is on/)).toBeInTheDocument();
  expect(screen.getByText(/aren't deleted by this/)).toBeInTheDocument();
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  const dialog = await screen.findByRole("dialog", { name: "Are you sure?" });
  expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Yes, delete" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/deleted"));
  expect(calls.some((c) => c.method === "DELETE" && c.url === "/api/me")).toBe(true);
});

test("the shared demo login can delete its data but not the account itself", async () => {
  mockFetch({
    "GET /api/auth/me": { body: { ...ME, shared_login: true } },
    "GET /api/consent": { body: { active: true, version: "2026-10-v6", photo_scan: false } },
  });
  renderApp("/privacy");
  expect(await screen.findByText(/shared demo login other reviewers use/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete my account" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Delete my details and booking" })).toBeInTheDocument();
});

test("withdrawing consent purges and photo consent can be switched off", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "GET /api/consent": { body: { active: true, version: "2026-10-v2", photo_scan: true } },
    "PUT /api/consent/photo": { body: { active: true, version: "2026-10-v2", photo_scan: false } },
    "POST /api/consent/revoke": { body: { active: false, version: null, photo_scan: false } },
  });
  const { router } = renderApp("/privacy");
  await userEvent.click(await screen.findByRole("button", { name: "Turn off ID scanning" }));
  expect(calls.find((c) => c.method === "PUT" && c.url === "/api/consent/photo")!.body).toEqual({ photo_scan: false });
  await userEvent.click(screen.getByRole("button", { name: /withdraw consent/i }));
  await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Yes, delete" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/deleted"));
});

test("a long pause on a step shows the take-your-time card once", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/support/evaluate": {
      body: { content: { trigger: "long_pause", title: "Take your time.", body: "Saved.", actions: [{ id: "continue", label: "Continue" }, { id: "save_and_leave", label: "Save and finish later" }], urgent: false } },
    },
    "POST /api/auth/logout": { status: 204 },
  });
  const { router } = renderApp("/chat");
  await screen.findByRole("log");
  await act(async () => {
    vi.advanceTimersByTime(46_000);
  });
  const card = await screen.findByRole("complementary", { name: "Take your time." });
  expect(calls.filter((c) => c.url === "/api/support/evaluate")).toHaveLength(1);
  vi.useRealTimers();
  await userEvent.click(within(card).getByRole("button", { name: "Save and finish later" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/saved"));
  expect(calls.some((c) => c.url === "/api/auth/logout")).toBe(true);
});

test("help is in the header on every screen and the offline banner appears when offline", async () => {
  mockFetch({ "GET /api/auth/me": { status: 401, body: {} } });
  renderApp("/front-desk");
  await userEvent.click(await screen.findByRole("button", { name: "Help" }));
  expect(await screen.findByRole("dialog", { name: "Help" })).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(await screen.findByText(/You're offline/)).toBeInTheDocument();
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(screen.queryByText(/You're offline/)).toBeNull());
});

test("larger text is a remembered display preference", async () => {
  mockFetch({ "GET /api/auth/me": { status: 401, body: {} } });
  renderApp("/");
  const toggle = await screen.findByRole("button", { name: "Larger text" });
  await userEvent.click(toggle);
  expect(document.documentElement.dataset.textSize).toBe("large");
  expect(localStorage.getItem("text_size")).toBe("large");
  await userEvent.click(toggle);
});
