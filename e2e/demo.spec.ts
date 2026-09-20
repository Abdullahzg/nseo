import { test, expect } from "@playwright/test";

// The judge's path: open the site as a stranger, launch the demo, watch it work, see a deal.
test("a visitor can launch a demo and the agent reaches a deal", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/setup");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Get your product featured");
  await page.getByRole("button", { name: "See the plan" }).click();
  await expect(page.getByText(/tokens/)).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Launch demo" }).click();
  await expect(page).toHaveURL(/\/campaigns\//, { timeout: 30_000 });
  // auto-step runs every 12 s while the tab is open; the arc needs ~12 steps
  await expect(page.getByText(/Deal with/).first()).toBeVisible({ timeout: 420_000 });
  await page.goto("/deals");
  await expect(page.getByRole("heading", { name: "Deals" })).toBeVisible();
});

test("guests cannot pick Real mode or open Settings; owners can", async ({ page, request }) => {
  const me = await (await request.get("/api/me")).json();
  await page.goto("/setup");
  const real = page.getByRole("radio", { name: /Real/ });
  if (me.kind === "guest") {
    await expect(real).toBeDisabled();
    await page.goto("/settings");
    await expect(page.getByText("Owner only")).toBeVisible();
  } else {
    // owner without a saved Gmail app password: Real stays disabled with the reason
    if (!me.can_send_real) await expect(real).toBeDisabled();
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  }
});
