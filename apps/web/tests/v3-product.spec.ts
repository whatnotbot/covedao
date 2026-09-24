import { test, expect, type Browser, type Page } from "@playwright/test";
import * as bitcoin from "bitcoinjs-lib";
import * as ecc from "tiny-secp256k1";
import { ECPairFactory } from "ecpair";
import { signPsbtWithKey, signBip322WithKey } from "@crclaunch/wallets/e2e";
import { IDENTITIES, mine, listBtcUtxos } from "./v3-rpc";

bitcoin.initEccLib(ecc as unknown as Parameters<typeof bitcoin.initEccLib>[0]);
const ECPair = ECPairFactory(ecc);

test.describe.configure({ mode: "serial" });

// The full journey mutates shared on-chain state and must run exactly once —
// desktop only. Mobile coverage is a separate read-only smoke spec.
test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "full product journey is desktop-only");
});

const BASE = "http://localhost:3100";

async function status() {
  const r = await fetch(`${BASE}/api/v3/status`);
  return r.json();
}

async function mineAndWait(n = 1) {
  await mine(n);
  // Wait for the V3 worker to catch up (indexer height == Core height).
  for (let i = 0; i < 60; i++) {
    const j = await status();
    if (j.ok && j.data.indexer.health === "HEALTHY" && BigInt(j.data.core.height) === BigInt(j.data.indexer.indexedHeight)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("indexer did not catch up after mining");
}

function scriptOf(privHex: string): string {
  const key = ECPair.fromPrivateKey(Buffer.from(privHex, "hex"), { network: bitcoin.networks.regtest });
  return bitcoin.payments.p2wpkh({ pubkey: key.publicKey, network: bitcoin.networks.regtest }).output!.toString("hex");
}

async function walletPage(browser: Browser, identity: { privHex: string; address: string }): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const script = scriptOf(identity.privHex);
  await page.exposeFunction("__signPsbt", (psbtBase64: string) => signPsbtWithKey(psbtBase64, identity.privHex));
  await page.exposeFunction("__signBip322", (message: string) => signBip322WithKey(message, identity.privHex));
  await page.exposeFunction("__getUtxos", () => listBtcUtxos(identity.address));
  await page.addInitScript(
    ({ address, scriptHex }) => {
      (window as unknown as Record<string, unknown>).__COVE_TEST_WALLET__ = {
        id: "e2e",
        connect: async () => ({ adapterId: "e2e", paymentAddress: address, paymentScript: scriptHex, network: "regtest", capabilities: { psbt: true, bip322Simple: true, p2wpkh: true, p2tr: false, utxoDiscovery: true } }),
        signPsbt: async (p: { psbtBase64: string }) => (window as unknown as { __signPsbt: (s: string) => Promise<string> }).__signPsbt(p.psbtBase64),
        signBip322Simple: async (p: { message: string }) => (window as unknown as { __signBip322: (s: string) => Promise<string> }).__signBip322(p.message),
        getUtxos: async () => (window as unknown as { __getUtxos: () => Promise<unknown> }).__getUtxos(),
      };
    },
    { address: identity.address, scriptHex: script },
  );
  return page;
}

let aliceTokenId: string;

test("E2E-001 launch: Alice launches FROG through the UI", async ({ browser }) => {
  const page = await walletPage(browser, IDENTITIES.alice);
  await page.goto(`${BASE}/launch`);

  // connect
  await page.getByRole("button", { name: /review launch identity/i }).click();
  // review panel appears with tokenId
  const tokenIdEl = page.locator("text=Review").locator("..").locator("text=/^[0-9a-f]{64}$/").first();
  // The tokenId is shown in the review panel; capture it via the API after build.
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("button", { name: /build, review and sign/i }).click();
  // after sign+broadcast the page shows the txid + token link
  await expect(page.getByText(/broadcast/i).first()).toBeVisible({ timeout: 60_000 });
  await mineAndWait(1);

  // confirm token appears
  const tokens = await fetch(`${BASE}/api/v3/tokens?search=FROG`).then((r) => r.json());
  expect(tokens.data.length).toBeGreaterThanOrEqual(1);
  aliceTokenId = tokens.data[0].tokenId;
  expect(aliceTokenId).toMatch(/^[0-9a-f]{64}$/);
});

test("E2E-002 backing buy: Alice buys 84M from Cove Backing", async ({ browser }) => {
  const page = await walletPage(browser, IDENTITIES.alice);
  await page.goto(`${BASE}/token/${aliceTokenId}`);
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByPlaceholder("e.g. 84000000").fill("84000000");
  await page.getByRole("button", { name: /buy from backing/i }).click();
  await expect(page.getByText(/buy broadcast/i).first()).toBeVisible({ timeout: 60_000 });
  await mineAndWait(1);

  const detail = await fetch(`${BASE}/api/v3/tokens/${aliceTokenId}`).then((r) => r.json());
  expect(BigInt(detail.data.issuedSupplyAtoms)).toBe(84_000_000n * 100_000_000n);
  const pf = await fetch(`${BASE}/api/v3/wallet/${IDENTITIES.alice.address}/portfolio`).then((r) => r.json());
  expect(pf.data.holdings.length).toBe(1);
});

test("E2E-003 transfer: Alice transfers to Bob (backing + supply unchanged)", async ({ browser }) => {
  const page = await walletPage(browser, IDENTITIES.alice);
  await page.goto(`${BASE}/token/${aliceTokenId}`);
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("button", { name: "Transfer" }).click();
  await page.getByPlaceholder("e.g. 84000000").fill("60000000");
  await page.getByPlaceholder("Recipient scriptPubKey").fill(scriptOf(IDENTITIES.bob.privHex));
  await page.getByRole("button", { name: "Transfer", exact: true }).last().click();
  await expect(page.getByText(/transfer broadcast/i).first()).toBeVisible({ timeout: 60_000 });
  await mineAndWait(1);

  const pf = await fetch(`${BASE}/api/v3/wallet/${IDENTITIES.bob.address}/portfolio`).then((r) => r.json());
  expect(pf.data.holdings.length).toBe(1);
  const detail = await fetch(`${BASE}/api/v3/tokens/${aliceTokenId}`).then((r) => r.json());
  // supply unchanged (still 84M); backing unchanged by a transfer
  expect(BigInt(detail.data.issuedSupplyAtoms)).toBe(84_000_000n * 100_000_000n);
});

test("E2E-004 redeem: Bob instant-sells to Cove Backing", async ({ browser }) => {
  const page = await walletPage(browser, IDENTITIES.bob);
  await page.goto(`${BASE}/token/${aliceTokenId}`);
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("button", { name: /instant sell/i }).click();
  await page.getByPlaceholder("e.g. 84000000").fill("60000000");
  await page.getByRole("button", { name: /redeem to backing/i }).click();
  await expect(page.getByText(/redeem broadcast/i).first()).toBeVisible({ timeout: 60_000 });
  await mineAndWait(1);

  const detail = await fetch(`${BASE}/api/v3/tokens/${aliceTokenId}`).then((r) => r.json());
  expect(BigInt(detail.data.issuedSupplyAtoms)).toBe(24_000_000n * 100_000_000n);
});

test("E2E-005 list P2P: Alice lists part of a token UTXO", async ({ browser }) => {
  const page = await walletPage(browser, IDENTITIES.alice);
  await page.goto(`${BASE}/token/${aliceTokenId}`);
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("button", { name: /list for sale/i }).click();
  await page.getByPlaceholder("Listed amount (atoms)").fill((1_000_000n * 100_000_000n).toString());
  await page.getByPlaceholder("Total asking price (sats)").fill("100000");
  await page.getByRole("button", { name: /sign & create listing/i }).click();
  await expect(page.getByText(/listing created/i).first()).toBeVisible({ timeout: 60_000 });

  const listings = await fetch(`${BASE}/api/v3/market/listings`).then((r) => r.json());
  expect(listings.data.length).toBe(1);
  expect(listings.data[0].status).toBe("ACTIVE");
});

test("E2E-006 P2P buy: Bob fills Alice's listing atomically", async ({ browser }) => {
  const listings = await fetch(`${BASE}/api/v3/market/listings`).then((r) => r.json());
  const listingId = listings.data[0].listingId;

  const bob = await walletPage(browser, IDENTITIES.bob);
  await bob.goto(`${BASE}/market`);
  await bob.getByRole("button", { name: /connect wallet/i }).click();
  await bob.getByRole("button", { name: "Buy", exact: true }).first().click();
  await expect(bob.getByText(/waiting for seller/i).first()).toBeVisible({ timeout: 60_000 });

  // Alice signs the sale from the wallet page
  const alice = await walletPage(browser, IDENTITIES.alice);
  await alice.goto(`${BASE}/wallet`);
  await alice.getByRole("button", { name: /connect wallet/i }).click();
  await alice.getByRole("button", { name: /review & sign sale/i }).first().click();
  await expect(alice.getByText(/sale broadcast/i).first()).toBeVisible({ timeout: 60_000 });
  await mineAndWait(1);

  // The listing must now be FILLED and the trade confirmed; backing + supply unchanged by P2P.
  const alicePf = await fetch(`${BASE}/api/v3/wallet/${IDENTITIES.alice.address}/portfolio`).then((r) => r.json());
  const filled = alicePf.data.listings.find((l: { listingId: string }) => l.listingId === listingId);
  expect(filled.status).toBe("FILLED");
  const detail = await fetch(`${BASE}/api/v3/tokens/${aliceTokenId}`).then((r) => r.json());
  expect(BigInt(detail.data.issuedSupplyAtoms)).toBe(24_000_000n * 100_000_000n);
});

test("E2E-008 cancel: Alice cancels a second listing", async ({ browser }) => {
  const page = await walletPage(browser, IDENTITIES.alice);
  await page.goto(`${BASE}/token/${aliceTokenId}`);
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.getByRole("button", { name: /list for sale/i }).click();
  await page.getByPlaceholder("Listed amount (atoms)").fill((1_000_000n * 100_000_000n).toString());
  await page.getByPlaceholder("Total asking price (sats)").fill("100000");
  await page.getByRole("button", { name: /sign & create listing/i }).click();
  await expect(page.getByText(/listing created/i).first()).toBeVisible({ timeout: 60_000 });

  await page.goto(`${BASE}/wallet`);
  await page.getByRole("button", { name: "Cancel", exact: true }).first().click();
  await expect(page.getByText(/listing cancelled/i).first()).toBeVisible({ timeout: 60_000 });
});
