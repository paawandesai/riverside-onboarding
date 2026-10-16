import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api, track } from "../api";
import { AuthForm } from "../components/AuthForm";
import { BookingStep } from "../components/BookingStep";
import { ConsentStep } from "../components/ConsentStep";
import { PrivacyPanel } from "../components/PrivacyPanel";
import { mockFetch } from "../test-utils/mockFetch";

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "6f1b8c1e-0b7a-4d0c-9a51-7d0f3b2f1a11" }, configurable: true });
});

const slot = { id: 7, starts_at: "2030-01-07T15:00:00Z", duration_minutes: 30, visit_type: "in_person", clinician_label: "Clinician B (fictional)" };

test("existing users can sign in", async () => {
  mockFetch({ "POST /api/auth/login": { body: { id: "u1" } } });
  const onSignedIn = jest.fn();
  render(<AuthForm onSignedIn={onSignedIn} />);
  await userEvent.click(screen.getByRole("button", { name: "I already have an account" }));
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.type(screen.getByLabelText(/Password/), "whatever-pass");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(onSignedIn).toHaveBeenCalled());
});

test("consent must be explicitly accepted before continuing", async () => {
  const calls = mockFetch({
    "GET /api/consent/text": { body: { version: "v1", summary: "Read this.", points: ["We discard your ID photo."] } },
    "POST /api/consent": { status: 201, body: { active: true, version: "v1" } },
  });
  const onConsented = jest.fn();
  render(<ConsentStep onConsented={onConsented} />);
  expect(await screen.findByText("We discard your ID photo.")).toBeInTheDocument();
  const accept = screen.getByRole("button", { name: "Agree and continue" });
  expect(accept).toBeDisabled();
  await userEvent.click(screen.getByLabelText("I have read this and agree to continue."));
  await userEvent.click(accept);
  await waitFor(() => expect(onConsented).toHaveBeenCalled());
  expect(calls.some((c) => c.url === "/api/consent" && c.init?.method === "POST")).toBe(true);
});

test("booking a slot shows a confirmation code, and it can be cancelled", async () => {
  let mine: unknown[] = [];
  mockFetch({
    "GET /api/slots": { body: [slot] },
    "GET /api/bookings/mine": () => ({ body: mine }),
    "POST /api/bookings/b1/cancel": () => {
      mine = [];
      return { status: 204 };
    },
    "POST /api/bookings": () => {
      mine = [{ id: "b1", status: "booked", confirmation_code: "AB12CD34", slot }];
      return { status: 201, body: mine[0] };
    },
    "POST /api/events": { status: 204 },
  });
  render(<BookingStep onConflict={jest.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText("Visit type"), "in_person");
  await userEvent.click(await screen.findByRole("button", { name: /In person/ }));
  expect(await screen.findByText(/confirmation code is AB12CD34/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel appointment" }));
  expect(await screen.findByText("Your appointment was cancelled.")).toBeInTheDocument();
});

test("privacy controls revoke consent and delete the account after confirmation", async () => {
  const calls = mockFetch({ "POST /api/consent/revoke": { body: { active: false } }, "DELETE /api/me": { status: 204 } });
  window.confirm = jest.fn(() => true);
  const onRevoked = jest.fn();
  const onDeleted = jest.fn();
  render(<PrivacyPanel onRevoked={onRevoked} onDeleted={onDeleted} />);
  await userEvent.click(screen.getByRole("button", { name: "Withdraw consent and delete my data" }));
  await waitFor(() => expect(onRevoked).toHaveBeenCalled());
  expect(screen.getByText(/deleted from our systems/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  expect(calls.map((c) => c.init?.method)).toEqual(["POST", "DELETE"]);
});

test("network failures become a friendly error, and analytics never sends user data", async () => {
  globalThis.fetch = jest.fn(async () => {
    throw new TypeError("network down");
  }) as jest.Mock;
  await expect(api.me()).rejects.toThrow("couldn't reach the server");
  const calls = mockFetch({ "POST /api/events": { status: 204 } });
  track("identity", "upload_started");
  const body = JSON.parse(String(calls[0].init!.body));
  expect(Object.keys(body).sort()).toEqual(["anon_session_id", "event", "step_id"]);
});
