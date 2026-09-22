import { expect, test } from "@playwright/test";

const pages = [
  { path: "/", name: "homepage" },
  { path: "/launch", name: "launch" },
  { path: "/token/seed-frog-00000000000000000000000000000000", name: "token-page" },
  { path: "/demo", name: "demo" },
  { path: "/for-crc", name: "for-crc" },
  { path: "/mainnet/leaf", name: "mainnet-leaf" },
  { path: "/portfolio", name: "portfolio" },
];

test.describe("visual smoke (screenshots)", () => {
  for (const p of pages) {
    test(`${p.name} renders`, async ({ page }) => {
      await page.goto(p.path);
      await page.waitForLoadState("networkidle");
      // Each page must render its main content without a crash.
      await expect(page.locator("main")).toBeVisible();
      await page.screenshot({ path: `test-results/screenshots/${p.name}.png`, fullPage: true });
    });
  }
});
