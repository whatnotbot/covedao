import type { V3TokenCardData } from "@/components/TokenCard";

/**
 * Fixture tokens for the `?demo=1` design preview.
 *
 * Every page in this app is data-driven, which means an empty database renders
 * an empty design — impossible to review. These fixtures exercise the states
 * that actually differ visually: an untouched launch, a mid-curve token, one a
 * hair from the cap, one at the cap, one with a live P2P ask and one without.
 * Values are plausible under the real curve (840M public cap, 20 stages,
 * ~24,196,788 sats at full subscription) so proportions look truthful.
 *
 * Demo mode is strictly a client-side render path. It never touches the API,
 * never writes, and is inert unless `?demo=1` is present in the URL.
 */

const ATOMS = 100_000_000n;
const CAP = 1_000_000_000n * ATOMS;

function token(
  i: number,
  ticker: string,
  name: string,
  pctIssued: number,
  opts: { holders: number; ask?: bigint; stage: number },
): V3TokenCardData {
  const issued = (CAP * BigInt(Math.round(pctIssued * 100))) / 10_000n;
  // Backing tracks issuance roughly along the geometric curve.
  const backing = (24_196_788n * BigInt(Math.round(pctIssued * 100))) / 10_000n;
  return {
    tokenId: `${i}${ticker.toLowerCase()}`.padEnd(8, "0").repeat(8).slice(0, 64),
    ticker,
    displayName: name,
    description: "",
    deployHeight: 968_100 + i * 37,
    issuedSupplyAtoms: issued.toString(),
    publicCapAtoms: CAP.toString(),
    backingSats: backing.toString(),
    curveStage: opts.stage,
    holderCount: opts.holders,
    bestAskSats: opts.ask ? opts.ask.toString() : null,
    // Mirrors the server-derived flag so demo mode shows the same badges.
    graduated: issued >= CAP,
  };
}

export const DEMO_TOKENS: V3TokenCardData[] = [
  token(1, "FROG", "Frog", 4.2, { holders: 38, stage: 1, ask: 1_400n }),
  token(2, "SATCAT", "Satoshi Cat", 23.8, { holders: 214, stage: 5, ask: 6_900n }),
  token(3, "TIDE", "Tide", 51.5, { holders: 486, stage: 11 }),
  token(4, "ANCHOR", "Anchor", 78.3, { holders: 1_027, stage: 16, ask: 41_500n }),
  token(5, "HARBOR", "Harbor", 99.4, { holders: 1_884, stage: 20, ask: 88_200n }),
  token(6, "REEF", "Reef", 100, { holders: 2_311, stage: 20, ask: 151_230n }),
];

/** Shape of the /api/v3/tokens/[tokenId] detail payload, for the demo path. */
export interface DemoTokenDetail {
  tokenId: string;
  ticker: string;
  displayName: string;
  description: string;
  deployTxid: string;
  deployHeight: string;
  policyVersion: number;
  issuedSupplyAtoms: string;
  publicCapAtoms: string;
  remainingCapacityAtoms: string;
  backingSats: string;
  backingOutpoint: { txid: string; vout: number };
  stateHash: string;
  curveStage: number;
  holderCount: number;
  bestAskSats: string | null;
  activeListingCount: number;
}

/**
 * Detail fixture for `?demo=1`. Derived from the ANCHOR card so the numbers
 * agree with what Explore shows — a mid-late token at stage 16, still open,
 * with live listings. The hex values are plausible-looking but inert.
 */
export const DEMO_TOKEN_DETAIL: DemoTokenDetail = (() => {
  const t = DEMO_TOKENS[3]!; // ANCHOR
  const issued = BigInt(t.issuedSupplyAtoms);
  const cap = BigInt(t.publicCapAtoms);
  return {
    tokenId: t.tokenId,
    ticker: t.ticker,
    displayName: t.displayName,
    description: "A deterministic-backing demonstration token.",
    deployTxid: "4a1f" + "c7e2b9".repeat(10) + "00",
    deployHeight: String(t.deployHeight),
    policyVersion: 3,
    issuedSupplyAtoms: issued.toString(),
    publicCapAtoms: cap.toString(),
    remainingCapacityAtoms: (cap - issued).toString(),
    backingSats: t.backingSats.toString(),
    backingOutpoint: { txid: "9b3e" + "d10a4f".repeat(10) + "11", vout: 1 },
    stateHash: "e27d7047a2a2f05a3f7ac319e12207c11487b59dcb212402785c129b85c518e2",
    curveStage: t.curveStage,
    holderCount: t.holderCount,
    bestAskSats: t.bestAskSats,
    graduated: issued >= cap,
    activeListingCount: 7,
  };
})();

/* ── Market ──────────────────────────────────────────────────────────── */

export interface DemoListing {
  id: string;
  listingId: string;
  tokenId: string;
  amountAtoms: string;
  totalPriceSats: string;
  expiryHeight: string;
  status: string;
  sellerTokenScript: string;
}

/**
 * An order book spanning the ask ladder — tight at the top, thinning with
 * depth, which is how a real early market looks. Statuses cover the lifecycle
 * a buyer or seller actually sees: ACTIVE, RESERVED mid-fill, and BROADCAST
 * awaiting confirmation.
 */
export const DEMO_LISTINGS: DemoListing[] = [
  ["ANCHOR", 1_000_000n, 41_500n, "ACTIVE"],
  ["ANCHOR", 2_500_000n, 106_000n, "ACTIVE"],
  ["ANCHOR", 750_000n, 32_400n, "ACTIVE"],
  ["ANCHOR", 4_000_000n, 176_000n, "ACTIVE"],
  ["ANCHOR", 1_800_000n, 81_900n, "RESERVED"],
  ["ANCHOR", 6_200_000n, 291_400n, "ACTIVE"],
  ["ANCHOR", 500_000n, 24_750n, "BROADCAST"],
  ["REEF", 500_000n, 75_600n, "ACTIVE"],
  ["REEF", 5_000_000n, 771_000n, "RESERVED"],
  ["HARBOR", 3_000_000n, 265_000n, "ACTIVE"],
  ["SATCAT", 10_000_000n, 690_000n, "BROADCAST"],
  ["FROG", 25_000_000n, 350_000n, "ACTIVE"],
].map(([ticker, amt, price, status], i) => {
  const t = DEMO_TOKENS.find((x) => x.ticker === ticker)!;
  return {
    id: `fill-${i}`,
    listingId: `${i}`.padStart(2, "0") + "c4e9".repeat(15),
    tokenId: t.tokenId,
    amountAtoms: ((amt as bigint) * 100_000_000n).toString(),
    totalPriceSats: (price as bigint).toString(),
    expiryHeight: String(969_000 + i * 144),
    status: status as string,
    sellerTokenScript: "0014" + `${i}`.repeat(40).slice(0, 40),
  };
});

/* ── Wallet ──────────────────────────────────────────────────────────── */

export const DEMO_PORTFOLIO = {
  holdings: [
    { tokenId: DEMO_TOKENS[3]!.tokenId, amountAtoms: (4_200_000n * 100_000_000n).toString(), utxoCount: 3 },
    { tokenId: DEMO_TOKENS[5]!.tokenId, amountAtoms: (880_000n * 100_000_000n).toString(), utxoCount: 1 },
    { tokenId: DEMO_TOKENS[0]!.tokenId, amountAtoms: (12_500_000n * 100_000_000n).toString(), utxoCount: 2 },
  ],
  tokenUtxos: [
    { txid: "a1" + "3f8c".repeat(15) + "0", vout: 1, tokenId: DEMO_TOKENS[3]!.tokenId, amountAtoms: (2_000_000n * 100_000_000n).toString() },
    { txid: "b2" + "7d4e".repeat(15) + "1", vout: 1, tokenId: DEMO_TOKENS[3]!.tokenId, amountAtoms: (1_400_000n * 100_000_000n).toString() },
    { txid: "c3" + "9a12".repeat(15) + "2", vout: 2, tokenId: DEMO_TOKENS[5]!.tokenId, amountAtoms: (880_000n * 100_000_000n).toString() },
  ],
  listings: [
    { listingId: "01c4e9".repeat(10).slice(0, 60), tokenId: DEMO_TOKENS[3]!.tokenId, amountAtoms: (1_000_000n * 100_000_000n).toString(), totalPriceSats: "41500", status: "ACTIVE" },
    { listingId: "02f7a1".repeat(10).slice(0, 60), tokenId: DEMO_TOKENS[0]!.tokenId, amountAtoms: (5_000_000n * 100_000_000n).toString(), totalPriceSats: "70000", status: "CANCELLED" },
  ],
  // A fill awaiting the seller's signature — the one state that needs action.
  fills: [
    {
      id: "fill-live",
      listingId: "03b2c8".repeat(10).slice(0, 60),
      tokenId: DEMO_TOKENS[5]!.tokenId,
      status: "BUYER_SIGNED",
      amountAtoms: (500_000n * 100_000_000n).toString(),
      totalPriceSats: "75600",
      marketFeeSats: "378",
      minerFeeSats: "1100",
      unsignedTxDigest: "7f2a" + "c91d".repeat(14) + "3b",
      psbtBase64: "cHNidP8BAH0CAAAAAe==",
      txid: null,
    },
  ],
};

/* ── Activity ────────────────────────────────────────────────────────── */

export interface DemoEvent {
  txid: string;
  blockHeight: string;
  operation: string;
  tokenId: string | null;
  valid: boolean;
}

/** Includes one REJECTED row — the failure state has to be designed too. */
export const DEMO_EVENTS: DemoEvent[] = [
  ["MINT", "ANCHOR", true],
  ["TRANSFER", "REEF", true],
  ["MINT", "HARBOR", true],
  ["REDEEM", "SATCAT", true],
  ["MINT", "FROG", false],
  ["TRANSFER", "ANCHOR", true],
  ["DEPLOY", "TIDE", true],
  ["MINT", "REEF", true],
].map(([op, ticker, valid], i) => ({
  txid: `${i}`.padStart(2, "0") + "e4a7b1".repeat(10) + "cd",
  blockHeight: String(968_322 - i * 3),
  operation: op as string,
  tokenId: DEMO_TOKENS.find((t) => t.ticker === ticker)?.tokenId ?? null,
  valid: valid as boolean,
}));
