import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch } from "../test-utils/mockFetch";
import { axeViolations, ME, renderApp } from "../test-utils/render";

const reply = (over: object = {}) => ({
  mode: "ai",
  intent: "provide_details",
  reply: "Thanks, I'll note that for the care team.",
  fields: { reason_for_visit: "headaches", symptom_duration: "two weeks", visit_type_preference: null, accessibility_needs: null },
  support: null,
  ui_action: null,
  notice: null,
  disclosure: "You're chatting with an AI assistant.",
  ...over,
});

test("chat opens with a labelled AI greeting and renders replies as plain text", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/chat": { body: reply({ reply: "<img src=x onerror=alert(1)> **bold** https://evil.example" }) },
  });
  const { container } = renderApp("/chat");
  const log = await screen.findByRole("log");
  expect(within(log).getByText(/My replies are written by AI/)).toBeInTheDocument();
  expect(within(log).getAllByText("AI").length).toBe(1);
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.type(screen.getByLabelText("Message"), "Headaches for two weeks{Enter}");
  expect(await within(log).findByText(/<img src=x onerror=alert\(1\)>/)).toBeInTheDocument();
  expect(log.querySelector("img")).toBeNull();
  expect(log.querySelector("a")).toBeNull();
  expect(calls.find((c) => c.url === "/api/chat")!.body).toEqual({ messages: [{ role: "user", content: "Headaches for two weeks" }] });
});

test("captured details carry over: continue saves the assessment and moves on", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/chat": { body: reply() },
    "PUT /api/intake/assessment": { body: {} },
    "GET /api/consent": { body: { active: true, version: "v", photo_scan: false } },
  });
  const { router } = renderApp("/chat");
  await userEvent.click(await screen.findByRole("button", { name: "A new symptom" }));
  await userEvent.click(await screen.findByRole("button", { name: "That's everything, continue" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/details"));
  expect(calls.find((c) => c.url === "/api/intake/assessment")!.body).toEqual({
    reason_for_visit: "headaches",
    symptom_duration: "two weeks",
    visit_type_preference: null,
    accessibility_needs: null,
  });
});

test("distress shows the supportive card with crisis line from the server", async () => {
  mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/chat": {
      body: reply({
        intent: "express_distress",
        reply: "I'm sorry you're going through this. Please call or text 988.",
        fields: {},
        support: { trigger: "distress", title: "It sounds like this is a lot right now.", body: "Call or text 988.", actions: [{ id: "talk_to_person", label: "Talk to a person" }], urgent: true },
      }),
    },
  });
  renderApp("/chat");
  await userEvent.type(await screen.findByLabelText("Message"), "I can't go on{Enter}");
  // Urgent content is an alert (announced at once) and takes focus.
  const card = await screen.findByRole("alert", { name: /a lot right now/ });
  expect(card).toHaveTextContent("988");
  await userEvent.click(within(card).getByRole("button", { name: "Talk to a person" }));
  expect(await screen.findByRole("dialog", { name: "Help" })).toHaveTextContent("555-0142");
});

test("when the assistant fails, a card offers retry or a form prefilled with what was said", async () => {
  let attempts = 0;
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/chat": () => (++attempts === 1 ? { body: reply({ fields: { reason_for_visit: "back pain" } }) } : { status: 502, body: {} }),
    "POST /api/support/evaluate": {
      body: { content: { trigger: "llm_unavailable", title: "I'm having trouble responding.", body: "...", actions: [{ id: "try_again", label: "Try again" }, { id: "use_form", label: "Continue with a form" }], urgent: false } },
    },
  });
  renderApp("/chat");
  await userEvent.type(await screen.findByLabelText("Message"), "Back pain{Enter}");
  await screen.findByText(/note that for the care team/);
  await userEvent.type(screen.getByLabelText("Message"), "Since Monday{Enter}");
  const card = await screen.findByRole("complementary", { name: /trouble responding/ });
  expect(calls.find((c) => c.url === "/api/support/evaluate")!.body).toEqual({ llm_unavailable: true });

  await userEvent.click(within(card).getByRole("button", { name: "Continue with a form" }));
  expect(await screen.findByLabelText("Why would you like to be seen?")).toHaveValue("back pain");
});

test("if the assistant fails before extracting anything, the form starts with the patient's own words", async () => {
  mockFetch({
    "GET /api/auth/me": { body: ME },
    "POST /api/chat": { status: 502, body: {} },
    "POST /api/support/evaluate": {
      body: { content: { trigger: "llm_unavailable", title: "I'm having trouble responding.", body: "...", actions: [{ id: "try_again", label: "Try again" }, { id: "use_form", label: "Continue with a form" }], urgent: false } },
    },
  });
  renderApp("/chat");
  await userEvent.type(await screen.findByLabelText("Message"), "Knee pain{Enter}");
  const card = await screen.findByRole("complementary", { name: /trouble responding/ });
  await userEvent.click(within(card).getByRole("button", { name: "Continue with a form" }));
  expect(await screen.findByLabelText("Why would you like to be seen?")).toHaveValue("Knee pain");
});

test("the form path works on its own and validates the reason", async () => {
  const calls = mockFetch({ "GET /api/auth/me": { body: ME }, "PUT /api/intake/assessment": { body: {} } });
  const { router, container } = renderApp("/chat");
  await userEvent.click(await screen.findByRole("button", { name: "Use a form instead" }));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/why you'd like to be seen/i);
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.type(screen.getByLabelText("Why would you like to be seen?"), "Annual check-up");
  await userEvent.click(screen.getByLabelText("Video (telehealth)"));
  await userEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/details"));
  expect(calls.find((c) => c.url === "/api/intake/assessment")!.body).toMatchObject({
    reason_for_visit: "Annual check-up",
    visit_type_preference: "telehealth",
  });
});
