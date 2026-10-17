import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch } from "../test-utils/mockFetch";
import { axeViolations, ME, PROGRESS, renderApp } from "../test-utils/render";

const signedOut = { "GET /api/auth/me": { status: 401, body: { detail: "Please sign in." } } };

const CONSENT_TEXT = {
  version: "2026-10-v2",
  summary: "How we use your information",
  points: ["We ask for your name.", "Chat is processed by Anthropic's Claude. Anthropic keeps it up to 30 days, or up to 2 years if flagged."],
  photo_scan: "Let me scan my ID.",
  details: ["Full notice paragraph."],
};

test("start page explains time, AI and requires the 18+ attestation before sign-up", async () => {
  mockFetch(signedOut);
  const { router, container } = renderApp("/");
  expect(await screen.findByRole("heading", { level: 1, name: /first visit/i })).toHaveFocus();
  expect(screen.getByText(/about 10 minutes/i)).toBeInTheDocument();
  expect(screen.getByText(/AI assistant\. It helps you fill this in\. It doesn't diagnose/i)).toBeInTheDocument();
  expect(screen.getByRole("note")).toHaveTextContent(/synthetic data only/i);
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(screen.getByText(/for adults/i)).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/");

  await userEvent.click(screen.getByLabelText("I'm 18 or older"));
  await userEvent.click(screen.getByRole("button", { name: "Get started" }));
  expect(router.state.location.pathname).toBe("/account");
});

test("a returning patient resumes at their next step", async () => {
  mockFetch({ "GET /api/auth/me": { body: ME }, "GET /api/progress": { body: { ...PROGRESS, assessment_done: true } } });
  const { router } = renderApp("/");
  await userEvent.click(await screen.findByRole("button", { name: "Get started" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/details"));
});

test("sign-up validates, sends the CSRF header and the adult attestation, then goes to consent", async () => {
  let signedIn = false;
  const calls = mockFetch({
    "GET /api/auth/me": () => (signedIn ? { body: ME } : { status: 401, body: {} }),
    "POST /api/auth/signup": () => ((signedIn = true), { status: 201, body: ME }),
    "GET /api/consent/text": { body: CONSENT_TEXT },
  });
  const { router, container } = renderApp("/account", { adult: true });
  await screen.findByRole("heading", { name: "Create your account" });
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.click(screen.getByRole("button", { name: "Create account" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/valid email/i);

  await userEvent.type(screen.getByLabelText("Email"), "pat@example.com");
  await userEvent.type(screen.getByLabelText("Password", { exact: false }), "a-long-password");
  await userEvent.type(screen.getByLabelText("Invite code", { exact: false }), "demo-code");
  await userEvent.click(screen.getByRole("button", { name: "Create account" }));

  await waitFor(() => expect(router.state.location.pathname).toBe("/consent"));
  const signup = calls.find((c) => c.url === "/api/auth/signup")!;
  expect(signup.body).toEqual({ email: "pat@example.com", password: "a-long-password", invite_code: "demo-code", adult_attestation: true });
  expect(signup.headers["X-Requested-With"]).toBe("onboarding-app");
});

test("sign-up without the start page's attestation goes back to start", async () => {
  mockFetch(signedOut);
  const { router } = renderApp("/account");
  await waitFor(() => expect(router.state.location.pathname).toBe("/"));
});

test("sign in shows the server's message on failure", async () => {
  mockFetch({ ...signedOut, "POST /api/auth/login": { status: 401, body: { detail: "Email or password is incorrect." } } });
  renderApp("/account?mode=signin");
  await userEvent.type(await screen.findByLabelText("Email"), "pat@example.com");
  await userEvent.type(screen.getByLabelText("Password"), "wrong");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
});

test("consent shows the short notice with retention, keeps photo consent optional and separate", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "GET /api/consent/text": { body: CONSENT_TEXT },
    "POST /api/consent": { status: 201, body: { active: true, version: "2026-10-v2", photo_scan: true } },
  });
  const { router, container } = renderApp("/consent");
  expect(await screen.findByText(/30 days, or up to 2 years/)).toBeInTheDocument();
  expect(screen.getByText("Full notice paragraph.")).not.toBeVisible();
  const photo = screen.getByRole("switch", { name: "Let me scan my ID" });
  expect(photo).not.toBeChecked();
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.click(photo);
  await userEvent.click(screen.getByRole("button", { name: "I agree, continue" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/chat"));
  expect(calls.find((c) => c.method === "POST" && c.url === "/api/consent")!.body).toEqual({ photo_scan: true });
});

test("declining consent leads to the front desk path, not a dead end", async () => {
  mockFetch({ "GET /api/auth/me": { body: ME }, "GET /api/consent/text": { body: CONSENT_TEXT } });
  const { router } = renderApp("/consent");
  await userEvent.click(await screen.findByRole("link", { name: /finish at the front desk/i }));
  expect(router.state.location.pathname).toBe("/front-desk");
  expect(await screen.findByText(/bring your photo id/i)).toBeInTheDocument();
});

test("steps after sign-up redirect to sign in without a session", async () => {
  mockFetch(signedOut);
  const { router } = renderApp("/book");
  await waitFor(() => expect(router.state.location.pathname).toBe("/account"));
  expect(router.state.location.search).toBe("?mode=signin");
});
