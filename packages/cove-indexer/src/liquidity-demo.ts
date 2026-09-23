/**
 * LEGACY / REFERENCE — Cove V1 graduation + virtual constant-product liquidity
 * pool demo (deterministic, offline).
 *
 * Simulates the full product lifecycle: DEPLOY FROG → MINT all 840M public
 * supply → GRADUATE (seed the virtual constant-product pool) → BUY → BUY →
 * SELL, and prints a transcript of exactly where BTC and tokens move.
 *
 * This is a mock/regtest/testing simulator and is NOT the production token
 * protocol. It does NOT touch mainnet, change the Cove V1 wire consensus, or
 * alter the frozen state root. See docs/COVE_COVENANT_ARCHITECTURE.md.
 */
import {
  ATOMS_PER_TOKEN,
  GRADUATION_RESERVE_ATOMS,
  PUBLIC_SUPPLY_ATOMS,
  STAGE_COUNT,
  TOKENS_PER_STAGE,
  constantProduct,
  getStagePrice,
  getTheoreticalFullRaise,
  pricePerMillionTokens,
  quoteExactTokens,
  LiquiditySimulator,
} from "@crclaunch/curve";

const DEPLOYMENT = "f".repeat(64);
const CFG = { feeBps: 0n, maxSlippageBps: 0n };

function fmtTokens(atoms: bigint): string {
  const whole = atoms / ATOMS_PER_TOKEN;
  const frac = atoms % ATOMS_PER_TOKEN;
  return `${whole}.${frac.toString().padStart(8, "0")}`;
}

function fmtBtc(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const frac = sats % 100_000_000n;
  return `${whole}.${frac.toString().padStart(8, "0")}`;
}

function main(): void {
  const line = "─".repeat(64);
  console.log(line);
  console.log("COVE V1 — GRADUATION + VIRTUAL LIQUIDITY POOL DEMO");
  console.log(line);

  // 1. DEPLOY
  console.log("\n[1] DEPLOY");
  console.log(`    ticker: FROG (deployment ${DEPLOYMENT.slice(0, 8)}…)`);

  // 2. MINT all 840M public supply (20 stages × 42M)
  console.log("\n[2] MINT — all 840M public supply (20 stages × 42M tokens)");
  let supply = 0n;
  let reserve = 0n;
  for (let stage = 1; stage <= STAGE_COUNT; stage++) {
    const q = quoteExactTokens({ desiredTokens: TOKENS_PER_STAGE, currentSupply: supply });
    reserve += q.curveContributionSats;
    supply += q.tokens;
    console.log(
      `    stage ${String(stage).padStart(2)}  +${TOKENS_PER_STAGE} tokens  @ ${getStagePrice(stage)} sats/1M  →  +${q.curveContributionSats} sats`,
    );
  }
  console.log(`    TOTAL public minted: ${supply} tokens`);
  console.log(`    TOTAL curve reserve: ${reserve} sats (${fmtBtc(reserve)} BTC)`);
  console.log(`    (theoretical full raise: ${getTheoreticalFullRaise()} sats)`);

  // 3. GRADUATE
  console.log("\n[3] GRADUATE");
  const sim = new LiquiditySimulator();
  const pool = sim.graduate(DEPLOYMENT, reserve, PUBLIC_SUPPLY_ATOMS);
  console.log(`    token reserve: ${fmtTokens(pool.tokenReserveAtoms)} FROG (${GRADUATION_RESERVE_ATOMS / ATOMS_PER_TOKEN} reserved)`);
  console.log(`    btc reserve:   ${pool.btcReserveSats} sats (${fmtBtc(pool.btcReserveSats)} BTC)`);
  console.log(`    starting price: ~${pricePerMillionTokens(pool)} sats / 1M FROG`);
  console.log(`    k (constant product): ${constantProduct(pool)}`);

  // 4. Alice BUY
  console.log("\n[4] Alice BUY with 10,000 sats");
  sim.fundSats("alice", 10_000n);
  const aliceBuy = sim.buy("alice", 10_000n, CFG);
  console.log(`    sats in:        10,000`);
  console.log(`    tokens out:     ${fmtTokens(aliceBuy.tokensOut)} FROG`);
  console.log(`    price before:   ${pricePerMillionTokens(pool)} sats/1M`);
  console.log(`    price after:    ${pricePerMillionTokens(aliceBuy.pool)} sats/1M`);
  console.log(`    Alice FROG:     ${fmtTokens(sim.user("alice").tokenAtoms)}`);

  // 5. Bob BUY
  console.log("\n[5] Bob BUY with 25,000 sats");
  sim.fundSats("bob", 25_000n);
  const bobBuy = sim.buy("bob", 25_000n, CFG);
  console.log(`    sats in:        25,000`);
  console.log(`    tokens out:     ${fmtTokens(bobBuy.tokensOut)} FROG`);
  console.log(`    price after:    ${pricePerMillionTokens(bobBuy.pool)} sats/1M`);
  console.log(`    Bob FROG:       ${fmtTokens(sim.user("bob").tokenAtoms)}`);

  // 6. Alice SELL half her FROG
  const aliceSellAmount = sim.user("alice").tokenAtoms / 2n;
  console.log(`\n[6] Alice SELL ${fmtTokens(aliceSellAmount)} FROG`);
  const aliceSell = sim.sell("alice", aliceSellAmount, CFG);
  console.log(`    tokens in:      ${fmtTokens(aliceSellAmount)} FROG`);
  console.log(`    sats out:       ${aliceSell.satsOut}`);
  console.log(`    price after:    ${pricePerMillionTokens(aliceSell.pool)} sats/1M`);
  console.log(`    Alice sats:     ${sim.user("alice").sats}`);
  console.log(`    Alice FROG:     ${fmtTokens(sim.user("alice").tokenAtoms)}`);

  // Final state
  const final = sim.requirePool();
  console.log("\n[7] FINAL POOL STATE");
  console.log(`    token reserve:  ${fmtTokens(final.tokenReserveAtoms)} FROG`);
  console.log(`    btc reserve:    ${final.btcReserveSats} sats (${fmtBtc(final.btcReserveSats)} BTC)`);
  console.log(`    price:          ${pricePerMillionTokens(final)} sats / 1M FROG`);
  console.log(`    k (constant):   ${constantProduct(final)}`);
  console.log(`    total BTC vol:  ${final.totalBtcVolumeSats} sats`);
  console.log(`    total tok vol:  ${fmtTokens(final.totalTokenVolumeAtoms)} FROG`);
  console.log(`    trades:         ${final.tradeCount}`);
  console.log(line);
  console.log("Demo complete. This is a deterministic simulator — mainnet is NOT activated.");
}

import { pathToFileURL } from "node:url";
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
