import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockFetch } from "../test-utils/mockFetch";
import { axeViolations, ME, renderApp } from "../test-utils/render";

const consent = (photo_scan: boolean) => ({ "GET /api/consent": { body: { active: true, version: "v2", photo_scan } } });
const card = () => new File(["fake-jpeg"], "card.jpg", { type: "image/jpeg" });

const extracted = {
  fields: {
    full_name: { value: "LENNON OAKHURST", confidence: 91, status: "found" },
    dob: { value: "1961-12-20", confidence: 55, status: "low_confidence" },
    address: { value: "8986 CEDAR HOLLOW DR, WESTBURY PINES WI", confidence: 80, status: "found" },
  },
  needs_review: ["dob"],
  missing: [],
  message: "Please check.",
  image_retained: false,
};

test("without photo consent, ID scanning is offered as opt-in and typing works", async () => {
  const calls = mockFetch({ "GET /api/auth/me": { body: ME }, ...consent(false), "PUT /api/consent/photo": { body: { active: true, version: "v2", photo_scan: true } } });
  const { router } = renderApp("/details");
  expect(await screen.findByText(/ID scanning is off/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Turn on ID scanning" }));
  expect(calls.find((c) => c.method === "PUT" && c.url === "/api/consent/photo")!.body).toEqual({ photo_scan: true });
  await userEvent.click(screen.getByRole("button", { name: "Type it instead" }));
  expect(router.state.location.pathname).toBe("/details/confirm");
  expect(await screen.findByRole("heading", { name: "Type your details" })).toBeInTheDocument();
});

test("client rejects the wrong file type before upload", async () => {
  const calls = mockFetch({ "GET /api/auth/me": { body: ME }, ...consent(true) });
  const { container } = renderApp("/details");
  await screen.findByText(/Lay it flat/);
  expect(await axeViolations(container)).toEqual([]);
  const input = container.querySelector<HTMLInputElement>("#id-photo")!;
  await userEvent.upload(input, new File(["%PDF"], "id.pdf", { type: "application/pdf" }), { applyAccept: false });
  expect(await screen.findByRole("alert")).toHaveTextContent(/isn't a JPG, PNG, WebP or HEIC/);
  expect(calls.some((c) => c.url === "/api/documents/extract")).toBe(false);
});

test("photo is reviewed, read, and every field is shown for checking with where it came from", async () => {
  const calls = mockFetch({
    "GET /api/auth/me": { body: ME },
    ...consent(true),
    "POST /api/documents/extract": { body: extracted },
    "POST /api/support/evaluate": { body: { content: null } },
    "PUT /api/intake/identity": { body: {} },
  });
  const { container, router } = renderApp("/details");
  await screen.findByText(/Lay it flat/);
  await userEvent.upload(container.querySelector<HTMLInputElement>("#id-photo")!, card());
  expect(screen.getByRole("img", { name: /preview of your id photo/i })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Use this photo" }));

  expect(await screen.findByRole("heading", { name: "Check your details" })).toBeInTheDocument();
  expect(screen.getByLabelText("Full legal name")).toHaveValue("LENNON OAKHURST");
  expect(screen.getByLabelText("Month")).toHaveValue("12");
  expect(screen.getByLabelText("Street address")).toHaveValue("8986 CEDAR HOLLOW DR");
  // ZIP wasn't on the photo: left blank, said so, and focused. Nothing invented.
  expect(screen.getByLabelText("ZIP")).toHaveValue("");
  expect(screen.getByLabelText("ZIP")).toHaveFocus();
  expect(screen.getAllByText("From your photo, please check").length).toBeGreaterThan(2);
  expect(screen.getAllByText(/We couldn't read this/).length).toBe(1);
  expect(calls.find((c) => c.url === "/api/support/evaluate")!.body).toEqual({ ocr_low_confidence: true });
  expect(await axeViolations(container)).toEqual([]);

  await userEvent.type(screen.getByLabelText("ZIP"), "53554");
  await userEvent.clear(screen.getByLabelText("Full legal name"));
  await userEvent.type(screen.getByLabelText("Full legal name"), "Lennon Oakhurst");
  await userEvent.click(screen.getByRole("button", { name: "These are correct" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/book"));
  expect(calls.find((c) => c.url === "/api/intake/identity")!.body).toEqual({
    full_name: "Lennon Oakhurst",
    dob: "1961-12-20",
    address: "8986 CEDAR HOLLOW DR, WESTBURY PINES WI 53554",
    sources: { full_name: "ocr_edited", dob: "ocr_confirmed", address: "ocr_edited" },
  });
});

test("an unreadable photo leads to a supportive card and the typed form, never a dead end", async () => {
  mockFetch({
    "GET /api/auth/me": { body: ME },
    ...consent(true),
    "POST /api/documents/extract": { status: 422, body: { detail: "That file isn't a supported image." } },
    "POST /api/support/evaluate": {
      body: { content: { trigger: "upload_failed", title: "That photo was hard to read. That's okay.", body: "...", actions: [{ id: "try_again", label: "Try again" }, { id: "type_instead", label: "Type it instead" }], urgent: false } },
    },
  });
  const { container, router } = renderApp("/details");
  await screen.findByText(/Lay it flat/);
  await userEvent.upload(container.querySelector<HTMLInputElement>("#id-photo")!, card());
  await userEvent.click(screen.getByRole("button", { name: "Use this photo" }));
  const support = await screen.findByRole("complementary", { name: /hard to read/ });
  await userEvent.click(within(support).getByRole("button", { name: "Type it instead" }));
  expect(router.state.location.pathname).toBe("/details/confirm");
  expect(await screen.findByRole("heading", { name: /hard to read/ })).toBeInTheDocument();
  expect(screen.getByLabelText("Full legal name")).toHaveValue("");
});

test("typed details are validated: real date, adults only, address parts", async () => {
  const calls = mockFetch({ "GET /api/auth/me": { body: ME }, "PUT /api/intake/identity": { body: {} } });
  const { router } = renderApp("/details/confirm");
  await screen.findByRole("heading", { name: "Type your details" });
  await userEvent.type(screen.getByLabelText("Full legal name"), "Avery Quinn");
  await userEvent.type(screen.getByLabelText("Month"), "2");
  await userEvent.type(screen.getByLabelText("Day"), "30");
  await userEvent.type(screen.getByLabelText("Year"), "1990");
  await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  const summary = await screen.findByRole("alert");
  expect(summary).toHaveTextContent(/real date of birth/);
  expect(summary).toHaveTextContent(/street address/);
  expect(summary).toHaveTextContent(/ZIP/);

  await userEvent.clear(screen.getByLabelText("Day"));
  await userEvent.type(screen.getByLabelText("Day"), "3");
  await userEvent.clear(screen.getByLabelText("Year"));
  await userEvent.type(screen.getByLabelText("Year"), String(new Date().getFullYear() - 10));
  await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/adults/);

  await userEvent.clear(screen.getByLabelText("Year"));
  await userEvent.type(screen.getByLabelText("Year"), "1990");
  await userEvent.type(screen.getByLabelText("Street address"), "12 Elm St");
  await userEvent.type(screen.getByLabelText("City"), "Maple Grove");
  await userEvent.type(screen.getByLabelText("State"), "mn");
  await userEvent.type(screen.getByLabelText("ZIP"), "55311");
  await userEvent.click(screen.getByRole("button", { name: "Save and continue" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/book"));
  expect(calls.find((c) => c.url === "/api/intake/identity")!.body).toEqual({
    full_name: "Avery Quinn",
    dob: "1990-02-03",
    address: "12 Elm St, Maple Grove MN 55311",
    sources: { full_name: "manual", dob: "manual", address: "manual" },
  });
});
