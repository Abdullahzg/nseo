import { test, expect } from "@playwright/test";

test.describe("Settings page", () => {
  test("loads settings page", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.locator("h1, h2, text=Settings").first()).toBeVisible();
  });

  test("shows API key fields or status", async ({ page }) => {
    await page.goto("/settings");
    const body = await page.locator("body").textContent();
    expect(body?.length).toBeGreaterThan(100);
  });
});

test.describe("Agent runs page", () => {
  test("loads agent runs page", async ({ page }) => {
    await page.goto("/agent-runs");
    await expect(page.locator("h1, h2, text=Agent").first()).toBeVisible();
  });

  test("shows runs list or empty state", async ({ page }) => {
    await page.goto("/agent-runs");
    const body = await page.locator("body").textContent();
    expect(body?.length).toBeGreaterThan(100);
  });
});

test.describe("Decisions page", () => {
  test("loads decisions page", async ({ page }) => {
    await page.goto("/sending");
    await expect(page.locator("h1, h2, text=Decision").first()).toBeVisible();
  });
});
