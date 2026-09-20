import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("loads and shows hero content", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Geseo")).toBeVisible();
    await expect(page.locator("text=AI Outreach Platform")).toBeVisible();
  });

  test("has feature sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=Discover")).toBeVisible();
    await expect(page.locator("text=Qualify")).toBeVisible();
    await expect(page.locator("text=Contact")).toBeVisible();
    await expect(page.locator("text=Outreach")).toBeVisible();
  });

  test("shows stat counters", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("text=8 AI Agents")).toBeVisible();
    await expect(page.locator("text=16 Tool endpoints")).toBeVisible();
  });

  test("has navigation to campaigns", async ({ page }) => {
    await page.goto("/");
    const link = page.locator("a", { hasText: /open dashboard|campaigns/i }).first();
    await expect(link).toBeVisible();
  });
});

test.describe("Sidebar navigation", () => {
  test("sidebar renders with all nav items", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    await expect(page.locator("nav a", { hasText: "Campaigns" })).toBeVisible();
    await expect(page.locator("nav a", { hasText: "Decisions" })).toBeVisible();
    await expect(page.locator("nav a", { hasText: "Inbox" })).toBeVisible();
    await expect(page.locator("nav a", { hasText: "Agent Runs" })).toBeVisible();
    await expect(page.locator("nav a", { hasText: "Settings" })).toBeVisible();
  });

  test("sidebar collapses and expands", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    const toggleBtn = page.locator("button").filter({ has: page.locator("svg.lucide-chevron-left") }).first();
    await toggleBtn.click();
    await expect(page.locator("nav a", { hasText: "Campaigns" })).not.toBeVisible();
    await toggleBtn.click();
    await expect(page.locator("nav a", { hasText: "Campaigns" })).toBeVisible();
  });
});
