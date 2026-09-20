import { test, expect } from "@playwright/test";

test.describe("Inbox page", () => {
  test("loads and shows inbox heading", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.locator("text=Inbox")).toBeVisible();
  });

  test("shows tab buttons", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.locator("button", { hasText: "Unread" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Responses" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Awaiting" })).toBeVisible();
    await expect(page.locator("button", { hasText: "Filtered" })).toBeVisible();
  });

  test("search input exists", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.locator("input[placeholder*='Search']")).toBeVisible();
  });

  test("shows empty state when no people selected", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.locator("text=Pick a person")).toBeVisible();
  });

  test("sort dropdown works", async ({ page }) => {
    await page.goto("/inbox");
    const trigger = page.locator("button[role='combobox'], [data-slot='select-trigger']").first();
    if (await trigger.count() > 0) {
      await trigger.click();
      await expect(page.locator("[role='option']", { hasText: /newest|oldest|name/i }).first()).toBeVisible();
    }
  });

  test("tab switching works", async ({ page }) => {
    await page.goto("/inbox");
    await page.locator("button", { hasText: "Filtered" }).click();
    await expect(page.locator("button", { hasText: "Filtered" })).toHaveAttribute("class", /highlight/);
  });

  test("sentiment filter buttons exist", async ({ page }) => {
    await page.goto("/inbox");
    await expect(page.locator("button[title='All sentiments']")).toBeVisible();
    await expect(page.locator("button[title='Positive only']")).toBeVisible();
    await expect(page.locator("button[title='Neutral only']")).toBeVisible();
    await expect(page.locator("button[title='Negative only']")).toBeVisible();
  });
});
