import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import { AuthForm } from "../components/AuthForm";
import { BookingStep } from "../components/BookingStep";
import { ChatStep } from "../components/ChatStep";
import { IdentityStep } from "../components/IdentityStep";
import { SupportCard } from "../components/SupportCard";
import { mockFetch } from "../test-utils/mockFetch";

beforeAll(() => {
  Object.defineProperty(globalThis, "crypto", { value: { randomUUID: () => "6f1b8c1e-0b7a-4d0c-9a51-7d0f3b2f1a11" } });
});

const slot = { id: 7, starts_at: "2030-01-07T15:00:00Z", duration_minutes: 30, visit_type: "telehealth", clinician_label: "Clinician A (fictional)" };

test("sign-up requires adult attestation and shows server errors", async () => {
  mockFetch({ "POST /api/auth/signup": { status: 403, body: { detail: "That invite code isn't valid." } } });
  render(<AuthForm onSignedIn={jest.fn()} />);
  const submit = screen.getByRole("button", { name: "Create account" });
  expect(submit).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Email"), "a@example.com");
  await userEvent.type(screen.getByLabelText(/Password/), "correct-horse-battery");
  await userEvent.type(screen.getByLabelText("Invite code"), "nope");
  await userEvent.click(screen.getByLabelText("I confirm I am 18 or older."));
  await userEvent.click(submit);
  expect(await screen.findByRole("alert")).toHaveTextContent("invite code isn't valid");
});

test("partial OCR pre-fills found fields, leaves missing blank, and marks them for review", async () => {
  const calls = mockFetch({
    "POST /api/documents/extract": {
      body: {
        fields: {
          full_name: { value: "AVERY TEST", confidence: 91, status: "found" },
          dob: { value: "1980-02-03", confidence: 41, status: "low_confidence" },
          address: { value: null, confidence: null, status: "missing" },
        },
        needs_review: ["dob"],
        missing: ["address"],
        message: "We filled in what we could read.",
      },
    },
    "PUT /api/intake/identity": { body: {} },
    "POST /api/events": { status: 204 },
  });
  const onSignal = jest.fn();
  const onSaved = jest.fn();
  render(<IdentityStep onSaved={onSaved} onSignal={onSignal} />);
  await userEvent.upload(screen.getByLabelText(/Upload a photo/), new File(["x"], "id.jpg", { type: "image/jpeg" }));
  expect(await screen.findByDisplayValue("AVERY TEST")).toBeInTheDocument();
  expect(screen.getByLabelText("Home address")).toHaveValue("");
  expect(screen.getByText("Not found in photo. Please fill in.")).toBeInTheDocument();
  expect(screen.getByText("Read from photo. Please check carefully.")).toBeInTheDocument();
  expect(onSignal).toHaveBeenCalledWith("ocr_low_confidence");
  await userEvent.type(screen.getByLabelText("Home address"), "1 FICTION WAY, NOWHERE OH 44000");
  await userEvent.click(screen.getByRole("button", { name: "These details are correct" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const saved = JSON.parse(String(calls.find((c) => c.url === "/api/intake/identity")!.init!.body));
  expect(saved.sources).toEqual({ full_name: "ocr_confirmed", dob: "ocr_confirmed", address: "manual" });
});

test("failed upload offers manual entry and raises the upload_failed signal", async () => {
  mockFetch({ "POST /api/documents/extract": { status: 422, body: { detail: "That file isn't a supported image." } }, "POST /api/events": { status: 204 } });
  const onSignal = jest.fn();
  render(<IdentityStep onSaved={jest.fn()} onSignal={onSignal} />);
  await userEvent.upload(screen.getByLabelText(/Upload a photo/), new File(["x"], "id.jpg", { type: "image/jpeg" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("supported image");
  expect(onSignal).toHaveBeenCalledWith("upload_failed");
  expect(screen.getByLabelText("Full name")).toBeEnabled();
});

test("chat shows AI disclosure, renders replies as text, and surfaces distress support", async () => {
  mockFetch({
    "POST /api/chat": {
      body: {
        mode: "ai",
        intent: "express_distress",
        reply: "<img src=x onerror=alert(1)> please call 988",
        fields: {},
        support: { trigger: "distress", title: "You don't have to do this alone", body: "Call 988", actions: [], urgent: true },
        ui_action: null,
        notice: null,
        disclosure: "You're chatting with an AI assistant.",
      },
    },
    "POST /api/events": { status: 204 },
  });
  const onSupport = jest.fn();
  const { container } = render(<ChatStep onDone={jest.fn()} onSupport={onSupport} onOpenScheduling={jest.fn()} />);
  expect(screen.getByText(/AI assistant/)).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Your message"), "I feel hopeless");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText(/please call 988/)).toBeInTheDocument();
  expect(container.querySelector("img")).toBeNull();
  expect(onSupport).toHaveBeenCalledWith(expect.objectContaining({ trigger: "distress" }));
});

test("chat falls back to the manual form when the API fails", async () => {
  mockFetch({ "POST /api/chat": { status: 500, body: { detail: "Something went wrong on our side." } } });
  render(<ChatStep onDone={jest.fn()} onSupport={jest.fn()} onOpenScheduling={jest.fn()} />);
  await userEvent.type(screen.getByLabelText("Your message"), "hello");
  await userEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByRole("status")).toHaveTextContent("fill in the form below");
  expect(screen.getByLabelText("Reason for visit")).toBeEnabled();
});

test("booking shows confirmation, and a conflict raises the booking_conflict signal", async () => {
  let bookings: unknown[] = [];
  mockFetch({
    "GET /api/slots": { body: [slot] },
    "GET /api/bookings/mine": () => ({ body: bookings }),
    "POST /api/bookings": () => ({ status: 409, body: { detail: "Someone just booked that time. Please pick another." } }),
    "POST /api/events": { status: 204 },
  });
  const onConflict = jest.fn();
  render(<BookingStep onConflict={onConflict} />);
  await userEvent.click(await screen.findByRole("button", { name: /Telehealth/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("pick another");
  expect(onConflict).toHaveBeenCalled();
  bookings = [{ id: "b1", status: "booked", confirmation_code: "AB12CD34", slot }];
});

test("urgent support content is announced as an alert", () => {
  render(<SupportCard content={{ trigger: "distress", title: "Help", body: "Call 988", actions: ["Call or text 988"], urgent: true }} />);
  expect(screen.getByRole("alert")).toHaveTextContent("Call 988");
});

test("app shows the synthetic-data banner and sends signed-out users to sign-up", async () => {
  mockFetch({ "GET /api/auth/me": { status: 401, body: { detail: "Please sign in." } }, "POST /api/events": { status: 204 } });
  render(<App />);
  expect(screen.getByRole("note")).toHaveTextContent("Demo, synthetic data only.");
  expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
});

test("a long pause on a step surfaces supportive content", async () => {
  jest.useFakeTimers();
  mockFetch({
    "GET /api/auth/me": { body: { id: "u1", role: "user" } },
    "GET /api/consent": { body: { active: true, version: "v1" } },
    "POST /api/support/evaluate": {
      body: { content: { trigger: "long_pause", title: "Take your time", body: "No rush.", actions: ["Continue"], urgent: false } },
    },
    "POST /api/events": { status: 204 },
  });
  render(<App />);
  await act(async () => {
    await Promise.resolve();
  });
  expect(await screen.findByRole("heading", { name: "Your details" })).toBeInTheDocument();
  expect(screen.queryByText("Take your time")).toBeNull();
  await act(async () => {
    jest.advanceTimersByTime(46_000);
  });
  expect(await screen.findByText("Take your time")).toBeInTheDocument();
  jest.useRealTimers();
});
