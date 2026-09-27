import { test, expect } from "@playwright/test";

const theme = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.dataset.theme);

test.describe("theme toggle", () => {
  test("light and dark persist across reload", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/teams");

    await page.getByTestId("theme-dark").click();
    await expect.poll(() => theme(page)).toBe("dark");
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");

    await page.reload();
    expect(await theme(page)).toBe("dark"); // applied before hydration, no flash
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("theme-light").click();
    await expect.poll(() => theme(page)).toBe("light");
  });

  test("system follows the OS preference live", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/teams");
    await page.getByTestId("theme-system").click();
    await expect.poll(() => theme(page)).toBe("dark");

    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => theme(page)).toBe("light");
    await expect(page.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");
  });

  test("first visit with no stored choice uses the OS preference", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/teams");
    expect(await theme(page)).toBe("dark");
    await expect(page.getByTestId("theme-system")).toHaveAttribute("aria-checked", "true");
  });
});
