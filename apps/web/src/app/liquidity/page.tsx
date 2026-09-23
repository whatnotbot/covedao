"use client";

import { useState } from "react";
import {
  ATOMS_PER_TOKEN,
  PUBLIC_SUPPLY_ATOMS,
  PUBLIC_SUPPLY_TOKENS,
  TOKENS_PER_STAGE,
  executeBuy,
  executeSell,
  getStageForSupply,
  getStagePrice,
  getTheoreticalFullRaise,
  graduatePool,
  pricePerMillionTokens,
  quoteBuy,
  quoteSell,
  type VirtualLiquidityPool,
} from "@crclaunch/curve";

const DEPLOYMENT = "f".repeat(64);
const CFG = { feeBps: 0n, maxSlippageBps: 0n };

function fmtTokens(atoms: bigint): string {
  const whole = atoms / ATOMS_PER_TOKEN;
  const frac = atoms % ATOMS_PER_TOKEN;
  return `${whole}.${frac.toString().padStart(8, "0").replace(/0+$/, "") || "0"}`;
}

function fmtBtc(sats: bigint): string {
  const whole = sats / 100_000_000n;
  const frac = sats % 100_000_000n;
  return `${whole}.${frac.toString().padStart(8, "0")}`;
}

function satsToBig(s: string): bigint | null {
  if (!/^\d+$/.test(s)) return null;
  return BigInt(s);
}

function tokensToAtoms(t: string): bigint | null {
  if (!/^\d+$/.test(t)) return null;
  return BigInt(t) * ATOMS_PER_TOKEN;
}

export default function LiquidityPage() {
  const [supply, setSupply] = useState<bigint>(0n);
  const [reserve, setReserve] = useState<bigint>(0n);
  const [pool, setPool] = useState<VirtualLiquidityPool | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [buySats, setBuySats] = useState("10000");
  const [sellTokens, setSellTokens] = useState("1000000");
  const [tradeMsg, setTradeMsg] = useState<string | null>(null);

  const soldOut = supply >= PUBLIC_SUPPLY_TOKENS;
  const stage = soldOut ? 20 : getStageForSupply(supply);

  function mintStage() {
    if (soldOut) return;
    // Mint one full stage (42M) of the remaining public supply.
    const remaining = PUBLIC_SUPPLY_TOKENS - supply;
    const amount = TOKENS_PER_STAGE < remaining ? TOKENS_PER_STAGE : remaining;
    // Cost = 42M * price / 1M = 42 * price (exact, no rounding).
    const price = getStagePrice(stage);
    const cost = amount * price / 1_000_000n;
    setSupply(supply + amount);
    setReserve(reserve + cost);
    setLogs((l) => [...l, `MINT +${amount} tokens @ ${price} sats/1M → ${cost} sats`]);
    setTradeMsg(null);
  }

  function mintAll() {
    // Jump straight to sold out and graduate.
    const fullRaise = getTheoreticalFullRaise();
    setSupply(PUBLIC_SUPPLY_TOKENS);
    setReserve(fullRaise);
    const p = graduatePool(DEPLOYMENT, fullRaise, PUBLIC_SUPPLY_ATOMS);
    setPool(p);
    setLogs((l) => [...l, `SOLD OUT → GRADUATED. Seeded pool: ${fmtTokens(p.tokenReserveAtoms)} FROG + ${fmtBtc(p.btcReserveSats)} BTC`]);
    setTradeMsg(null);
  }

  function doBuy() {
    if (!pool) return;
    const sats = satsToBig(buySats);
    if (sats === null || sats <= 0n) { setTradeMsg("Enter a positive sat amount."); return; }
    try {
      const q = quoteBuy(pool, sats, CFG);
      const r = executeBuy(pool, q);
      setPool(r.pool);
      setLogs((l) => [...l, `BUY ${sats} sats → ${fmtTokens(r.tokensOut)} FROG (impact ${q.priceImpactBps} bps)`]);
      setTradeMsg(`You paid ${sats} sats, received ${fmtTokens(r.tokensOut)} FROG.`);
    } catch (e) {
      setTradeMsg(e instanceof Error ? e.message : "Buy failed.");
    }
  }

  function doSell() {
    if (!pool) return;
    const atoms = tokensToAtoms(sellTokens);
    if (atoms === null || atoms <= 0n) { setTradeMsg("Enter a positive token amount."); return; }
    try {
      const q = quoteSell(pool, atoms, CFG);
      const r = executeSell(pool, q);
      setPool(r.pool);
      setLogs((l) => [...l, `SELL ${fmtTokens(atoms)} FROG → ${r.satsOut} sats (impact ${q.priceImpactBps} bps)`]);
      setTradeMsg(`You sold ${fmtTokens(atoms)} FROG, received ${r.satsOut} sats.`);
    } catch (e) {
      setTradeMsg(e instanceof Error ? e.message : "Sell failed.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Cove V1 Liquidity Simulator</h1>
        <p className="mt-1 text-sm text-gray-400">
          Deterministic graduation + constant-product virtual pool. Mock/regtest only — not activated on mainnet.
        </p>
      </div>

      <section className="rounded-3xl border border-border bg-surface p-6">
        <h2 className="font-semibold text-white">FROG</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl border border-border bg-bg p-3">
            <div className="text-xs text-gray-500">Minted</div>
            <div className="font-mono-nums text-white">{supply.toString()} / {PUBLIC_SUPPLY_TOKENS.toString()}</div>
          </div>
          <div className="rounded-xl border border-border bg-bg p-3">
            <div className="text-xs text-gray-500">Stage</div>
            <div className="font-mono-nums text-white">{stage} / 20</div>
          </div>
          <div className="rounded-xl border border-border bg-bg p-3">
            <div className="text-xs text-gray-500">Curve reserve</div>
            <div className="font-mono-nums text-white">{reserve.toString()} sats</div>
          </div>
        </div>

        {!soldOut ? (
          <div className="mt-4 flex gap-2">
            <button onClick={mintStage} className="rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white">
              MINT next 42M
            </button>
            <button onClick={mintAll} className="rounded-xl border border-brand px-4 py-2 text-sm font-semibold text-white">
              MINT ALL → GRADUATE
            </button>
          </div>
        ) : (
          <p className="mt-4 text-sm font-semibold text-success">PUBLIC MINT SOLD OUT · GRADUATED</p>
        )}
      </section>

      {pool && (
        <>
          <section className="rounded-3xl border border-border bg-surface p-6">
            <h2 className="font-semibold text-white">Pool</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-border bg-bg p-3">
                <div className="text-xs text-gray-500">BTC reserve</div>
                <div className="font-mono-nums text-white">{fmtBtc(pool.btcReserveSats)} BTC</div>
              </div>
              <div className="rounded-xl border border-border bg-bg p-3">
                <div className="text-xs text-gray-500">Token reserve</div>
                <div className="font-mono-nums text-white">{fmtTokens(pool.tokenReserveAtoms)} FROG</div>
              </div>
              <div className="rounded-xl border border-border bg-bg p-3">
                <div className="text-xs text-gray-500">Price</div>
                <div className="font-mono-nums text-white">~{pricePerMillionTokens(pool)} sats / 1M</div>
              </div>
              <div className="rounded-xl border border-border bg-bg p-3">
                <div className="text-xs text-gray-500">Trades</div>
                <div className="font-mono-nums text-white">{pool.tradeCount.toString()}</div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-3xl border border-border bg-surface p-5">
              <h3 className="font-semibold text-white">Buy FROG</h3>
              <input
                value={buySats}
                onChange={(e) => setBuySats(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="sats"
                className="mt-2 w-full rounded-xl border border-border bg-bg px-4 py-3 text-white outline-none focus:border-brand"
              />
              <button onClick={doBuy} className="mt-3 w-full rounded-xl bg-brand py-3 font-semibold text-white">
                Buy FROG
              </button>
            </div>
            <div className="rounded-3xl border border-border bg-surface p-5">
              <h3 className="font-semibold text-white">Sell FROG</h3>
              <input
                value={sellTokens}
                onChange={(e) => setSellTokens(e.target.value.replace(/[^0-9]/g, ""))}
                inputMode="numeric"
                placeholder="tokens"
                className="mt-2 w-full rounded-xl border border-border bg-bg px-4 py-3 text-white outline-none focus:border-brand"
              />
              <button onClick={doSell} className="mt-3 w-full rounded-xl bg-brand py-3 font-semibold text-white">
                Sell FROG
              </button>
            </div>
          </section>

          {tradeMsg && <p className="text-sm text-gray-300">{tradeMsg}</p>}
        </>
      )}

      {logs.length > 0 && (
        <section className="rounded-3xl border border-border bg-surface p-6">
          <h2 className="mb-2 font-semibold text-white">Transcript</h2>
          <div className="space-y-1 text-sm text-gray-400">
            {logs.map((l, i) => <div key={i} className="font-mono-nums">{l}</div>)}
          </div>
        </section>
      )}
    </div>
  );
}
