import { test, expect } from "@playwright/test";

/**
 * apps/bench is not running in this environment (it's being built by a
 * separate agent). These pages must degrade to a clear "service unavailable"
 * empty state rather than crashing or fabricating data — that's what these
 * tests check, against whatever is (or isn't) actually listening on :8000.
 */
test.describe("Benchmarks & Evaluation — bench service unavailable", () => {
  test("Benchmarks page shows a clear unavailable state instead of crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/benchmarks");
    await expect(page.getByRole("heading", { name: "Benchmarks", exact: true })).toBeVisible();
    await expect(page.getByText(/bench service unavailable/i).first()).toBeVisible({ timeout: 10_000 });

    // The launcher and known-dataset placeholders should still render.
    await expect(page.getByRole("button", { name: "Run" })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("Evaluation page shows a clear unavailable state instead of crashing", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(err.message));

    await page.goto("/evaluation");
    await expect(page.getByRole("heading", { name: "Evaluation", exact: true })).toBeVisible();
    await expect(page.getByText(/bench service unavailable/i).first()).toBeVisible({ timeout: 10_000 });

    // RQ tabs still render and switch even with no data.
    await page.getByRole("tab", { name: "RQ3" }).click();
    await expect(page.getByText(/no-guards/)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
