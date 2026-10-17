import { expect, test } from "@playwright/test";
import { chatAndContinue, expectAccessible, FIXTURES, signUp, typeDetails } from "./helpers";

test("ID scan path: consent, chat, scan, check, book, done", async ({ page }) => {
  await signUp(page, { photo: true });
  await chatAndContinue(page);

  await page.locator("#id-photo").setInputFiles(`${FIXTURES}generated-ids/specimen-01.jpg`);
  await page.getByRole("button", { name: "Use this photo" }).click();
  await expect(page.getByRole("heading", { name: "Check your details" })).toBeVisible({ timeout: 20_000 });
  // specimen-01 is a clean scan: its labels.json values come back for checking.
  await expect(page.getByLabel("Full legal name")).toHaveValue("LENNON OAKHURST");
  await expect(page.getByLabel("Year")).toHaveValue("1961");
  await expect(page.getByLabel("ZIP")).toHaveValue("53554");
  await expect(page.getByText("From your photo, please check").first()).toBeVisible();
  await page.getByRole("button", { name: "These are correct" }).click();

  await expect(page.getByRole("heading", { name: "Pick a time" })).toBeVisible();
  await page
    .getByRole("group", { name: /^Times on/ })
    .getByRole("button")
    .first()
    .click();
  await page.getByRole("button", { name: "Book this time" }).click();
  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
  await expect(page.getByText(/Confirmation code [0-9A-F]{8}/)).toBeVisible();
  await expect(page.getByText(/Reason for visit \(patient's words\)/)).toBeVisible();

  // The server kept no image: the intake record holds only the confirmed text fields.
  const intake = await page.request.get("/api/intake").then((r) => r.json());
  expect(intake.field_sources).toEqual({
    full_name: "ocr_confirmed",
    dob: "ocr_confirmed",
    address: "ocr_confirmed",
  });
});

test("unreadable photo falls back to typing", async ({ page }) => {
  await signUp(page, { photo: true });
  await chatAndContinue(page);
  // A plain white image: valid format, nothing to read.
  const blank = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAMgAAAB4CAIAAAA0B1D0AAAAk0lEQVR42u3BAQ0AAADCoPdPbQ8HFAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPBjGwYAAeq4VaEAAAAASUVORK5CYII=",
    "base64",
  );
  await page.locator("#id-photo").setInputFiles({ name: "blank.png", mimeType: "image/png", buffer: blank });
  await page.getByRole("button", { name: "Use this photo" }).click();
  const card = page.getByRole("complementary").filter({ hasText: "hard to read" });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: "Type it instead" }).click();
  await expect(page.getByRole("heading", { name: /hard to read/ })).toBeVisible();
  await typeDetails(page);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Pick a time" })).toBeVisible();
});

test("assistant failure offers the form, prefilled with what was typed", async ({ page }) => {
  await signUp(page);
  // Break only the chat call, to exercise the failure path (this is not a latency measurement).
  await page.route("**/api/chat", (route) => route.fulfill({ status: 502, body: "{}" }));
  await page.getByLabel("Message").fill("Knee pain");
  await page.getByLabel("Message").press("Enter");
  const card = page.getByRole("complementary").filter({ hasText: "trouble responding" });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Continue with a form" }).click();
  await expect(page.getByLabel("Why would you like to be seen?")).toHaveValue("Knee pain");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page).toHaveURL(/\/details$/);
});

test("two patients, one slot: the second sees it was taken and nearby times", async ({ browser }) => {
  const a = await (await browser.newContext()).newPage();
  const b = await (await browser.newContext()).newPage();
  for (const p of [a, b]) {
    await signUp(p);
    await chatAndContinue(p);
    await p.getByRole("button", { name: "Type it instead" }).click();
    await typeDetails(p);
    await p.getByRole("button", { name: "Save and continue" }).click();
    await expect(p.getByRole("heading", { name: "Pick a time" })).toBeVisible();
    await p.getByRole("button", { name: "No preference" }).click();
    await p
      .getByRole("group", { name: /^Times on/ })
      .getByRole("button")
      .first()
      .click();
  }
  await a.getByRole("button", { name: "Book this time" }).click();
  await expect(a.getByRole("heading", { name: "You're booked" })).toBeVisible();
  await b.getByRole("button", { name: "Book this time" }).click();
  await expect(b.getByText(/^Someone just booked/)).toBeVisible();
  expect(await b.locator(".chip--highlight").count()).toBeGreaterThan(0);
  await b.locator(".chip--highlight").first().click();
  await b.getByRole("button", { name: "Book this time" }).click();
  await expect(b.getByRole("heading", { name: "You're booked" })).toBeVisible();
});

test("withdrawing consent deletes the saved details", async ({ page }) => {
  await signUp(page);
  await chatAndContinue(page);
  await page.getByRole("button", { name: "Type it instead" }).click();
  await typeDetails(page);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Pick a time" })).toBeVisible();
  expect((await page.request.get("/api/intake")).status()).toBe(200);

  await page.getByRole("link", { name: "My information", exact: true }).click();
  await page.getByRole("button", { name: /withdraw consent/i }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, delete" }).click();
  await expect(page.getByRole("heading", { name: "Your information has been deleted" })).toBeVisible();
  expect((await page.request.get("/api/intake")).status()).toBe(404);
  await expectAccessible(page);
});

test("security headers are set and the page works under the CSP", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  const res = await page.goto("/");
  const headers = res!.headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["x-robots-tag"]).toContain("noindex");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  // Dialogs add a scroll-lock <style> tag; it must carry the page's CSP nonce, not be blocked.
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByRole("dialog", { name: "Help" })).toBeVisible();
  expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  expect(errors.filter((e) => /Content Security Policy/i.test(e))).toEqual([]);
});

test("opening or reloading a deep link loads the app instead of a 404", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await signUp(page);
  await page.reload();
  await expect(page.getByRole("log")).toBeVisible();
});
