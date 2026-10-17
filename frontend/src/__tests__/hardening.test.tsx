import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router";
import { stepId } from "../app/support";
import { ErrorPage } from "../app/ErrorPage";
import { bookingIcs } from "../features/ics";
import { mockFetch } from "../test-utils/mockFetch";
import { ME, renderApp } from "../test-utils/render";

const NO_CONSENT = {
  consent: false,
  photo_scan: false,
  assessment_done: false,
  identity_done: false,
  booked: false,
};

test.each(["/chat", "/details", "/details/confirm", "/book"])("%s without consent goes to the consent notice", async (path) => {
  mockFetch({
    "GET /api/auth/me": { body: ME },
    "GET /api/progress": { body: NO_CONSENT },
    "GET /api/consent/text": {
      body: {
        version: "v",
        summary: "How we use your information",
        points: [],
        photo_scan: "",
        details: [],
      },
    },
  });
  const { router } = renderApp(path);
  await waitFor(() => expect(router.state.location.pathname).toBe("/consent"));
});

test("a failed chat turn says so in place and opens the form, even when support content can't load", async () => {
  mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/chat": { status: 502, body: {} },
    "POST /api/support/evaluate": { status: 502, body: {} },
  });
  renderApp("/chat");
  await userEvent.type(await screen.findByLabelText("Message"), "Knee pain{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent(/didn't go through/);
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(await screen.findByLabelText(/Why would you like/i)).toBeInTheDocument();
});

test("assistant replies are sent back with the server's signature", async () => {
  let n = 0;
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/chat": () => ({
      body: {
        mode: "ai",
        intent: "provide_details",
        reply: `reply ${++n}`,
        reply_sig: `sig-${n}`,
        fields: {},
        support: null,
        ui_action: null,
        notice: null,
        disclosure: "AI",
      },
    }),
  });
  renderApp("/chat");
  const box = await screen.findByLabelText("Message");
  await userEvent.type(box, "Knee pain{Enter}");
  await screen.findByText("reply 1");
  await userEvent.type(box, "Two weeks{Enter}");
  await screen.findByText("reply 2");
  const second = calls.filter((c) => c.url === "/api/chat")[1].body as {
    messages: unknown[];
  };
  expect(second.messages[1]).toEqual({
    role: "assistant",
    content: "reply 1",
    sig: "sig-1",
  });
});

test("the chat asks people not to type identifiers", async () => {
  mockFetch({ "GET /api/auth/me": { body: ME } });
  renderApp("/chat");
  const box = await screen.findByLabelText("Message");
  expect(box).toHaveAccessibleDescription(/don't include your name, date of birth or address/);
});

test("the router's error screen keeps the demo banner and has one main landmark", () => {
  const router = createMemoryRouter([{ path: "/", element: <ErrorPage standalone /> }]);
  const { container } = render(<RouterProvider router={router} />);
  expect(screen.getByRole("note")).toHaveTextContent(/synthetic/i);
  expect(container.querySelectorAll("main")).toHaveLength(1);
});

test("a 404 inside the app doesn't add a second main landmark", async () => {
  mockFetch({ "GET /api/auth/me": { status: 401, body: {} } });
  const { container } = renderApp("/no-such-page");
  await screen.findByRole("heading", { name: "Page not found" });
  expect(container.querySelectorAll("main")).toHaveLength(1);
});

test("funnel events only ever use known step names", () => {
  expect(stepId("/details/confirm")).toBe("confirm");
  expect(stepId("/staff/patients/8f0c1d2e-0000-4000-8000-000000000000")).toBe("staff_patient");
  expect(stepId("/some/typed/path")).toBe("other");
  expect(stepId("/")).toBe("start");
});

test("calendar text is escaped so commas and line breaks can't break the file", () => {
  const ics = bookingIcs(
    {
      id: "b1\r\nATTENDEE:x",
      status: "booked",
      confirmation_code: "AB12",
      slot: {
        id: 1,
        starts_at: "2030-01-07T15:00:00Z",
        duration_minutes: 40,
        visit_type: "in_person",
        clinician_label: "x",
      },
    },
    "Maple Grove",
    "200 Orchard Lane, Maple Grove (fictional)",
  );
  expect(ics).toContain("LOCATION:200 Orchard Lane\\, Maple Grove (fictional)");
  expect(ics.split("\r\n").some((l) => l.startsWith("ATTENDEE"))).toBe(false);
});

test("sign-up says what's stored before consent and links the notice", async () => {
  mockFetch({
    "GET /api/auth/me": { status: 401, body: {} },
    "GET /api/consent/text": {
      body: {
        version: "v",
        summary: "s",
        points: ["Point one"],
        photo_scan: "",
        details: [],
      },
    },
  });
  renderApp("/account", { adult: true });
  expect(await screen.findByText(/We store your email and password/)).toBeInTheDocument();
  const notice = await screen.findByText("Read the privacy notice");
  await userEvent.click(notice);
  expect(within(notice.closest("details")!).getByText("Point one")).toBeVisible();
});
