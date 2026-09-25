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
const CAP = 840_000_000n * ATOMS;

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
