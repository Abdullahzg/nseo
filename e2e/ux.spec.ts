import { test, expect } from "@playwright/test";

test.describe("Keyboard navigation", () => {
  test("sidebar nav items are focusable", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    const navLinks = page.locator("nav a");
    const count = await navLinks.count();
    expect(count).toBeGreaterThanOrEqual(3);
    await navLinks.first().focus();
    await expect(navLinks.first()).toBeFocused();
  });
});

test.describe("Responsive design", () => {
  test("mobile viewport shows hamburger menu", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/campaigns/autonomous");
    const hamburger = page.locator("button[aria-label='Toggle sidebar']");
    await expect(hamburger).toBeVisible();
  });

  test("sidebar opens on mobile when hamburger clicked", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/campaigns/autonomous");
    await page.locator("button[aria-label='Toggle sidebar']").click();
    await expect(page.locator("nav a", { hasText: "Campaigns" })).toBeVisible();
  });

  test("desktop viewport hides hamburger", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/campaigns/autonomous");
    const hamburger = page.locator("button[aria-label='Toggle sidebar']");
    await expect(hamburger).not.toBeVisible();
  });
});

test.describe("Error handling", () => {
  test("404 page renders for unknown routes", async ({ page }) => {
    const resp = await page.goto("/nonexistent-page-xyz");
    expect(resp?.status()).toBe(404);
  });
});

test.describe("Page loading states", () => {
  test("campaign list shows content without infinite spinner", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    await page.waitForTimeout(2000);
    const spinner = page.locator("svg.animate-spin");
    const spinnerCount = await spinner.count();
    expect(spinnerCount).toBeLessThanOrEqual(1);
  });
});
