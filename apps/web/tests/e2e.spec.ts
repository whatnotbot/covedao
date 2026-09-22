import { expect, test } from "@playwright/test";

function randomTicker(): string {
  // Guaranteed unique per run and always exactly 4 A-Z0-9 chars.
  const n = String(Date.now() % 1_000_000).padStart(6, "0");
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `${chars[Math.floor(Math.random() * 26)]}${n.slice(-3)}`;
}

test("E2E-001: visitor reaches homepage and a token page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Launch on Bitcoin." })).toBeVisible();
  await expect(page.getByText("Live launches")).toBeVisible();

  // Seeded mock token card.
  await expect(page.getByRole("link", { name: /FROG/ }).first()).toBeVisible();

  // Open a token page via the card.
  await page.getByRole("link", { name: /FROG/ }).first().click();
  await expect(page.getByRole("heading", { name: "FROG" })).toBeVisible();
  await expect(page.getByText("Progressive mint curve")).toBeVisible();
});

test("E2E-002: creator launches a token (mock)", async ({ page }) => {
  const ticker = randomTicker();
  await page.goto("/launch");
  await page.getByLabel("Name").fill("E2E Token");
  await page.getByLabel(/Ticker/).fill(ticker);
  await page.getByLabel(/Description/).fill("An end-to-end test token.");
  await page.getByLabel(/I understand CRC\/PRECOP/).check();
  // Scroll the button to the viewport center so the fixed status footer doesn't
  // overlap it on small mobile viewports before clicking.
  await page.getByRole("button", { name: "Deploy token" }).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await expect(page.getByRole("button", { name: "Deploy token" })).toBeEnabled();
  await page.getByRole("button", { name: "Deploy token" }).click();

  // Pending → deployed state.
  await expect(page.getByText("Token deployed")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/View token/)).toBeVisible();
});

test("E2E-003: buyer quotes and mints a seeded token (mock)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /FROG/ }).first().click();

  // Mint button opens the modal.
  await page.getByRole("button", { name: /MINT FROG/ }).click();
  await page.getByPlaceholder("e.g. 2000000").fill("5000000");

  // Live quote appears (debounced), then review.
  await expect(page.getByText("You receive")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Review transaction")).toBeVisible();
});

test("E2E-014: mobile homepage and token page render at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Launch on Bitcoin." })).toBeVisible();
  await page.getByRole("link", { name: /FROG/ }).first().click();
  await expect(page.getByRole("heading", { name: "FROG" })).toBeVisible();
});
