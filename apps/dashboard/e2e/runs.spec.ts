import { test, expect } from "@playwright/test";

/**
 * The big one: launches a REAL run against the seeded devteam team via the
 * real engine, which really calls a real local Ollama model per obligation.
 * No mocked network responses. This is genuinely slow (real LLM latency),
 * hence the generous per-test timeout.
 */
test.describe("Runs", () => {
  test("launches a run and streams at least one live trace event over the WebSocket", async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto("/runs?teamId=devteam");
    await expect(page.getByRole("heading", { name: "Runs", exact: true })).toBeVisible();

    // The launcher form should have pre-selected the devteam team from the query param.
    await expect(page.getByRole("combobox").first()).toContainText("DevTeam");

    await page.getByRole("button", { name: "Start run" }).click();

    // POST /api/runs -> 202, then client-side redirect to /runs/:id.
    await page.waitForURL(/\/runs\/[^/?]+$/, { timeout: 15_000 });

    await expect(page.getByTestId("run-status-badge")).toBeVisible();

    // The WebSocket trace stream should connect...
    await expect(page.getByText(/^open$/)).toBeVisible({ timeout: 15_000 });

    // ...and at least one real TraceEvent frame should arrive. This is the
    // slow part: the engine is actually calling a local Ollama model.
    await expect
      .poll(
        async () => page.getByTestId("trace-event-row").count(),
        { timeout: 90_000, message: "expected at least one live trace event to stream in" },
      )
      .toBeGreaterThan(0);

    // The first event should be a real RunTeam bookkeeping step, not a placeholder.
    await expect(page.getByTestId("trace-event-row").first()).toContainText(/RunTeam|Lift|Propagate|GuardedRestore|Adapt/);
  });

  test("run list shows launched runs and links to their detail page", async ({ page }) => {
    await page.goto("/runs");
    await expect(page.getByRole("heading", { name: "Recent runs" })).toBeVisible();
    // At least the run from the previous test (or any prior run) should be listed.
    await expect(page.getByRole("link").filter({ hasText: "devteam" }).first()).toBeVisible({ timeout: 10_000 });
  });
});
