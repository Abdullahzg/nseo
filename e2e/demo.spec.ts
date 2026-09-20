import { test, expect } from "@playwright/test";

// The judge's path: open the site as a stranger, launch the demo, watch it work, see a deal.
test("guest can launch a demo and the agent reaches a deal", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Get your product featured");
  await page.getByRole("button", { name: "See the plan" }).click();
  await expect(page.getByText(/tokens/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Launch demo" }).click();
  await expect(page).toHaveURL(/\/campaigns\//, { timeout: 30_000 });
  // auto-step runs every 20 s while the tab is open; give the arc up to 6 minutes
  await expect(page.getByText(/Deal with/)).toBeVisible({ timeout: 360_000 });
  const deals = page.locator("text=Deals").first();
  await expect(deals).toBeVisible();
});

test("guest cannot see Settings and cannot pick Real mode", async ({ page }) => {
  await page.goto("/setup");
  await expect(page.getByRole("radio", { name: /Real/ })).toBeDisabled();
  await page.goto("/settings");
  await expect(page.getByText("Owner only")).toBeVisible();
});
