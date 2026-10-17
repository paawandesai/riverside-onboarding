import { expect, test } from "@playwright/test";
import { chatAndContinue, expectAccessible, expectNoHorizontalScroll, signUp, typeDetails } from "./helpers";

// Every screen: axe WCAG 2.2 AA with real CSS (colour contrast included), and no sideways scroll at 320px.
test("each screen passes axe and fits 320px wide", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const check = async () => {
    await expectAccessible(page);
    await expectNoHorizontalScroll(page);
  };
  await page.goto("/");
  await check();
  await page.getByLabel("I'm 18 or older").check();
  await page.getByRole("button", { name: "Get started" }).click();
  await check();
  await page.goto("/");
  await signUp(page, { photo: true });
  await check(); // chat
  await chatAndContinue(page);
  await check(); // ID capture
  await page.getByRole("button", { name: "Type it instead" }).click();
  await check(); // details form
  await typeDetails(page);
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page.getByRole("heading", { name: "Pick a time" })).toBeVisible();
  await check();
  await page.getByRole("group", { name: /^Times on/ }).getByRole("button").first().click();
  await page.getByRole("button", { name: "Book this time" }).click();
  await expect(page.getByRole("heading", { name: "You're booked" })).toBeVisible();
  await check();
  await page.getByRole("link", { name: "My information", exact: true }).click();
  await check();
});

test("keyboard only: start to account without a mouse, focus visible on arrival", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await page.getByLabel("I'm 18 or older").evaluate((el) => el === document.activeElement)) break;
  }
  await page.keyboard.press("Space");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Get started" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeFocused();
});

test("200% text size keeps the start screen usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto("/");
  await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
  await expectNoHorizontalScroll(page);
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
});
