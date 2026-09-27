import { test, expect } from "@playwright/test";

/**
 * Against the real running engine (port 4000) AND a real local Ollama server
 * at http://localhost:11434 (no mocked network responses). Requires Ollama
 * to actually be running locally with at least one model pulled.
 */
test.describe("Model registry — Ollama", () => {
  test("registers a host, tests the connection, and lists real discovered models", async ({ page }) => {
    const hostName = `e2e-host-${Date.now()}`;

    await page.goto("/models");
    await expect(page.getByRole("heading", { name: "Model registry" })).toBeVisible();

    // Ollama tab is the default.
    await expect(page.getByRole("tab", { name: "Ollama (local)" })).toHaveAttribute("data-state", "active");

    await page.getByLabel("Host name").fill(hostName);
    await page.getByLabel("Host URL").fill("http://localhost:11434");

    // "Test connection" hits the real engine, which proxies the real Ollama /api/tags.
    await page.getByRole("button", { name: "Test connection" }).click();
    await expect(page.getByText(/Reachable · \d+ model\(s\) discovered/)).toBeVisible({ timeout: 15_000 });

    // Register the host for real, then confirm it shows up with its real models.
    await page.getByRole("button", { name: "Add host" }).click();

    const hostCard = page.getByTestId(`ollama-host-card-${hostName}`);
    await expect(hostCard).toBeVisible({ timeout: 15_000 });
    await expect(hostCard).toContainText("http://localhost:11434");

    // Real model discovered from the real Ollama server (used by the seeded devteam).
    await expect(hostCard.getByText("qwen2.5:3b")).toBeVisible({ timeout: 15_000 });
  });

  test("Cloud tab is clearly labeled as a non-functional UI shell", async ({ page }) => {
    await page.goto("/models");
    await page.getByRole("tab", { name: "Cloud" }).click();
    await expect(page.getByText(/isn't wired up in this environment/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Save key/i })).toBeDisabled();
  });
});
