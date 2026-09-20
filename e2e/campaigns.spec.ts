import { test, expect } from "@playwright/test";

test.describe("Campaign list page", () => {
  test("loads and shows page heading", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    await expect(page.locator("h1")).toContainText("Campaigns");
  });

  test("shows pipeline summary", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    await expect(page.locator("text=Pipeline")).toBeVisible();
  });

  test("shows create button", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    await expect(page.locator("a", { hasText: /create|new/i }).first()).toBeVisible();
  });

  test("renders campaign cards or empty state", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    const cards = page.locator(".rounded-lg.border").filter({ hasText: /draft|planning|discovering|qualifying|outreaching|monitoring|completed/ });
    const empty = page.locator("text=No campaigns");
    const hasCards = await cards.count() > 0;
    const hasEmpty = await empty.count() > 0;
    expect(hasCards || hasEmpty).toBeTruthy();
  });

  test("new campaign page has form fields", async ({ page }) => {
    await page.goto("/campaigns/new");
    await expect(page.locator("h1")).toContainText(/new|create/i);
    await expect(page.locator("input, textarea").first()).toBeVisible();
  });
});

test.describe("Campaign detail page", () => {
  test("loads a campaign detail when ID provided", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    const firstCard = page.locator(".rounded-lg.border.cursor-pointer, a[href*='/campaigns/']").first();
    if (await firstCard.count() > 0) {
      await firstCard.click();
      await page.waitForURL(/\/campaigns\//, { timeout: 5000 });
      await expect(page.locator("h1")).toBeVisible();
    }
  });

  test("shows agent board on detail page", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    const link = page.locator("a[href*='/campaigns/']").filter({ hasNotText: /autonomous|new/ }).first();
    if (await link.count() > 0) {
      await link.click();
      await page.waitForURL(/\/campaigns\//, { timeout: 5000 });
      await expect(page.locator("text=Agents")).toBeVisible();
    }
  });

  test("shows settings panel on detail page", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    const link = page.locator("a[href*='/campaigns/']").filter({ hasNotText: /autonomous|new/ }).first();
    if (await link.count() > 0) {
      await link.click();
      await page.waitForURL(/\/campaigns\//, { timeout: 5000 });
      await expect(page.locator("text=Campaign settings")).toBeVisible();
    }
  });

  test("shows funnel stats on detail page", async ({ page }) => {
    await page.goto("/campaigns/autonomous");
    const link = page.locator("a[href*='/campaigns/']").filter({ hasNotText: /autonomous|new/ }).first();
    if (await link.count() > 0) {
      await link.click();
      await page.waitForURL(/\/campaigns\//, { timeout: 5000 });
      await expect(page.locator("text=Funnel")).toBeVisible();
    }
  });
});
