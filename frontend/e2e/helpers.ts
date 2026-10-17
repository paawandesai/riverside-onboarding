import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export const INVITE = "e2e-invite";
export const FIXTURES = new URL("../../fixtures/", import.meta.url).pathname;

let counter = 0;
export const email = () => `e2e-${Date.now()}-${counter++}@example.com`;

/** WCAG 2.2 A/AA axe scan of the current screen; fails on any violation. */
export async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

/** No sideways scrolling at the current viewport (checked at 320px wide). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

export async function signUp(page: Page, opts: { photo?: boolean } = {}) {
  await page.goto("/");
  await page.getByLabel("I'm 18 or older").check();
  await page.getByRole("button", { name: "Get started" }).click();
  await page.getByLabel("Email").fill(email());
  await page.getByLabel("Password", { exact: false }).fill("e2e-password-123");
  await page.getByLabel("Invite code", { exact: false }).fill(INVITE);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "How we use your information" })).toBeVisible();
  if (opts.photo) await page.getByRole("switch", { name: "Let me scan my ID" }).check();
  await page.getByRole("button", { name: "I agree, continue" }).click();
  await expect(page.getByRole("log")).toBeVisible();
}

export async function chatAndContinue(page: Page, message = "I've had headaches for two weeks") {
  await page.getByLabel("Message").fill(message);
  await page.getByLabel("Message").press("Enter");
  await page.getByRole("button", { name: "That's everything, continue" }).click();
  await expect(page).toHaveURL(/\/details$/);
}

export async function typeDetails(page: Page) {
  await page.getByLabel("Full legal name").fill("Avery Quinn");
  await page.getByLabel("Month").fill("4");
  await page.getByLabel("Day").fill("12");
  await page.getByLabel("Year").fill("1985");
  await page.getByLabel("Street address").fill("12 Elm St");
  await page.getByLabel("City").fill("Maple Grove");
  await page.getByLabel("State").fill("MN");
  await page.getByLabel("ZIP").fill("55311");
}
