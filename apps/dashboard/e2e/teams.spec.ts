import { test, expect } from "@playwright/test";

/**
 * Against the real running engine (apps/engine, port 4000) with its seeded
 * "devteam" (RA/AR/DV/TS). No mocked responses.
 */
test.describe("Teams", () => {
  test("lists the seeded devteam team", async ({ page }) => {
    await page.goto("/teams");
    await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();

    const teamCard = page.getByTestId("team-card-devteam");
    await expect(teamCard).toBeVisible();
    await expect(teamCard).toContainText("DevTeam (RA / AR / DV / TS)");
  });

  test("team detail renders all 4 agents and 4 edges on the canvas", async ({ page }) => {
    await page.goto("/teams/devteam");

    await expect(page.getByRole("heading", { name: "DevTeam (RA / AR / DV / TS)" })).toBeVisible();

    // The reactflow canvas mounted with one node per agent, one edge per EdgeDef.
    await expect(page.locator(".react-flow")).toBeVisible();
    for (const id of ["RA", "AR", "DV", "TS"]) {
      await expect(page.getByTestId(`agent-node-${id}`)).toBeVisible();
    }
    await expect(page.locator(".react-flow__node")).toHaveCount(4);
    await expect(page.locator(".react-flow__edge")).toHaveCount(4);

    // Agents card: real per-agent data from the engine (not placeholders).
    await expect(page.getByRole("heading", { name: "Agents (4)" })).toBeVisible();
    for (const id of ["RA", "AR", "DV", "TS"]) {
      const row = page.getByTestId(`agent-row-${id}`);
      await expect(row).toBeVisible();
      await expect(row).toContainText("qwen2.5:3b");
      await expect(row).toContainText("ollama");
    }

    // Edges table: all 4 edges from the real team model, with real oracle kinds.
    await expect(page.getByRole("heading", { name: "Edges (4)" })).toBeVisible();
    await expect(page.getByTestId("edge-row-e1")).toContainText("<->");
    await expect(page.getByTestId("edge-row-e2")).toContainText("->");
    await expect(page.getByTestId("edge-row-e3")).toContainText("->");
    await expect(page.getByTestId("edge-row-e4")).toContainText("<->");

    // Adaptation rules (Lambda) from the seed data.
    await expect(page.getByText("insert-impact-analyst")).toBeVisible();
  });

  test("shows a clear error state for a nonexistent team", async ({ page }) => {
    await page.goto("/teams/does-not-exist");
    await expect(page.getByText(/could not load this team/i)).toBeVisible();
  });
});
