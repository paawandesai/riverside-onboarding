import { expect, test } from "@playwright/test";
import { chatAndContinue, expectAccessible, expectNoHorizontalScroll, signUp, typeDetails } from "./helpers";

test("a booked patient appears on the staff schedule with their intake", async ({ page, browser }) => {
  await signUp(page);
  await chatAndContinue(page, "Knee pain since the weekend");
  await page.getByRole("button", { name: "Type it instead" }).click();
  await typeDetails(page, "Morgan Staffview");
  await page.getByRole("button", { name: "Save and continue" }).click();
  await page.getByRole("group", { name: /^Times on/ }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Book this time" }).click();
  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
  const code = (await page.getByText(/Confirmation code [0-9A-F]{8}/).textContent())!.replace("Confirmation code ", "");

  const staff = await (await browser.newContext()).newPage();
  await staff.goto("/account?mode=signin");
  await staff.getByLabel("Email").fill(process.env.E2E_STAFF_EMAIL!);
  await staff.getByLabel("Password", { exact: false }).fill(process.env.E2E_STAFF_PASSWORD!);
  await staff.getByRole("button", { name: "Sign in" }).click();
  await expect(staff.getByRole("heading", { level: 1, name: "Upcoming visits" })).toBeVisible();
  await expectAccessible(staff);
  await expectNoHorizontalScroll(staff);

  const card = staff.getByRole("listitem").filter({ hasText: /Morgan Staffview/i });
  await expect(card).toContainText("Details confirmed");
  await card.getByRole("link", { name: /Open intake/ }).click();
  await expect(staff.getByRole("heading", { level: 1, name: /Morgan Staffview/i })).toBeVisible();
  await expect(staff.getByText(`Confirmation code ${code}`)).toBeVisible();
  await expect(staff.getByRole("region", { name: /What the patient told us/ })).toContainText("Knee pain");
  await expectAccessible(staff);

  // The patient can't reach the staff pages or API.
  await page.goto("/staff");
  await expect(page.getByRole("alert")).toHaveText("This page is for clinic staff.");
  expect((await page.request.get("/api/staff/schedule")).status()).toBe(403);
});
