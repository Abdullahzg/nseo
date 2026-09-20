import { test, expect } from "@playwright/test";

test.describe("Dashboard page", () => {
  test("loads and shows dashboard", async ({ page }) => {
    await page.goto("/dashboard");
    const body = await page.locator("body").textContent();
    expect(body?.length).toBeGreaterThan(100);
  });
});
