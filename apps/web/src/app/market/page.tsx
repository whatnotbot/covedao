"use client";

import { useSearchParams } from "next/navigation";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useIndexedHeight } from "@/lib/use-indexed-height";
import Link from "next/link";
import { DEMO_LISTINGS, DEMO_TOKENS } from "@/lib/demo-tokens";
import { useWallet } from "@/components/WalletProvider";
import { fmtBtc, fmtTokens, fmtInt } from "@/lib/format";
import { Sparkline } from "@/components/Sparkline";
import { Tile } from "@/components/Tile";
import { useSparklines } from "@/lib/use-sparklines";
import { unitPriceSats } from "@/lib/ohlc";
import { buyListing } from "@/lib/trade";
import { FeePicker, useFeeRates } from "@/components/FeePicker";

interface Listing {
  id: string;
  listingId: string;
  tokenId: string;
  amountAtoms: string;
  totalPriceSats: string;
  expiryHeight: string;
  status: string;
  sellerTokenScript: string;
  /** Joined from the token row; null if that row is missing. */
  ticker?: string | null;
}

function MarketContent() {
  const searchParams = useSearchParams();
  // Client-side design-preview path: no API calls, no writes.
  const demo = searchParams.get("demo") === "1";
  const { connected, script, publicKey, ordinalsScript, connect, signPsbt, signBip322, getUtxos } = useWallet();
  const [listings, setListings] = useState<Listing[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Refetch when a new block is indexed.
  const height = useIndexedHeight();
  const [buying, setBuying] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const { rates, selected: feeTier, setSelected: setFeeTier, satPerVb } = useFeeRates();

  useEffect(() => {
    if (demo) {
      setListings(
        DEMO_LISTINGS.map((l) => ({
          ...l,
          ticker: DEMO_TOKENS.find((t) => t.tokenId === l.tokenId)?.ticker ?? null,
        })),
      );
      setLoaded(true);
      return;
    }
    void fetch("/api/v3/market/listings")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setListings(j.data);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [height]);

  async function buy(listing: Listing) {
    if (!connected) return;
    setErr("");
    setBuying(listing.listingId);
    setMsg("");
    try {
      const fillId = await buyListing(
        listing,
        { script, publicKey, ordinalsScript, signPsbt, signBip322, getUtxos },
        satPerVb,
      );
      setMsg(`Buyer signed — waiting for seller (fill ${fillId.slice(0, 8)})…`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBuying(null);
    }
  }

  // Quote every listing in the unit the charts use, so a buyer can compare an
  // ask against that token's recent trades without doing arithmetic.
  //
  // Grouped by token, then cheapest first within each token. Sorting the whole
  // book by absolute price would rank a cheap token above an expensive one and
  // read as a bargain, when the two prices are not comparable at all.
  const rows = useMemo(
    () =>
      listings
        .map((l) => ({
          listing: l,
          unitPrice: unitPriceSats(l.amountAtoms, l.totalPriceSats),
          tokens: Number(BigInt(l.amountAtoms) / 100_000_000n),
          label: l.ticker ?? l.tokenId,
        }))
        .sort((a, b) => a.label.localeCompare(b.label) || a.unitPrice - b.unitPrice),
    [listings],
  );

  const { series, lastPrice } = useSparklines(
    listings.map((l) => ({
      tokenId: l.tokenId,
      ticker: l.ticker ?? l.tokenId.slice(0, 6),
      curveStage:
        DEMO_TOKENS.find((t) => t.tokenId === l.tokenId)?.curveStage ?? 10,
    })),
    demo,
  );

  const totalTokens = rows.reduce((a, r) => a + r.tokens, 0);
  const totalSats = listings.reduce((a, l) => a + BigInt(l.totalPriceSats), 0n);

  return (
    <div className="space-y-px">
      <section className="panel px-6 py-8 sm:px-10">
        {demo ? (
          <p className="mb-5 inline-block border border-pending/40 bg-pending/10 px-3 py-1.5 text-label uppercase tracking-label text-pending">
            Demo data &middot; not from the chain
          </p>
        ) : null}
        <p className="eyebrow">Market</p>
        <h1 className="mt-3 text-4xl text-bone">P2P asks</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-bone-dim">
          Every row is a real token UTXO offered at a fixed BTC price. Buyer and seller both sign
          SIGHASH_ALL and it settles atomically in one Bitcoin transaction. There are no bids and no
          synthetic liquidity &mdash; an empty book means an empty book.
        </p>

        <div className="mt-8 grid grid-cols-2 gap-px bg-rule sm:grid-cols-3">
          <Tile value={fmtInt(listings.length)} label="Open asks" />
          <Tile value={fmtInt(totalTokens)} label="Tokens offered" />
          <Tile value={totalSats > 0n ? fmtBtc(totalSats) : "\u2014"} label="Book value" />
        </div>
      </section>

      <section className="panel px-6 py-8 sm:px-10">
        {!loaded ? (
          <Empty message="Loading listings\u2026" />
        ) : rows.length === 0 ? (
          <Empty message="No active listings yet." />
        ) : (
          <div className="overflow-x-auto">
            <table className="ledger-table min-w-[64rem]">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Ask &middot; sats/1k</th>
                  <th>Last &middot; sats/1k</th>
                  <th>Trend</th>
                  <th>Lot</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Seller</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ listing: l, unitPrice }, i) => {
                  const last = lastPrice[l.tokenId] ?? null;
                  const firstOfToken = i === 0 || rows[i - 1]!.listing.tokenId !== l.tokenId;
                  // Below the last trade is the interesting case for a buyer.
                  const cheap = last !== null && unitPrice < last;
                  return (
                    <tr key={l.listingId} className="transition-colors hover:bg-ink-3">
                      <td>
                        {firstOfToken ? (
                          <Link href={`/token/${l.tokenId}`} className="text-bone hover:text-signal">
                            {l.ticker ?? `${l.tokenId.slice(0, 10)}\u2026`}
                          </Link>
                        ) : (
                          <span className="text-bone-dim">&#8226;</span>
                        )}
                      </td>
                      <td className={cheap ? "text-verified" : "text-bone"}>
                        {fmtInt(Math.round(unitPrice))}
                      </td>
                      <td className="text-bone-dim">
                        {firstOfToken && last !== null ? fmtInt(Math.round(last)) : ""}
                      </td>
                      <td>
                        {firstOfToken ? (
                          <Sparkline values={series[l.tokenId] ?? []} width={80} height={22} />
                        ) : null}
                      </td>
                      <td className="text-bone-2">{fmtTokens(BigInt(l.amountAtoms))}</td>
                      <td className="text-bone-2">{fmtBtc(BigInt(l.totalPriceSats))}</td>
                      <td>
                        <span className={statusChip(l.status)}>{l.status}</span>
                      </td>
                      <td className="hex">{l.sellerTokenScript.slice(0, 10)}&hellip;</td>
                      <td>
                        <button
                          onClick={() => void buy(l)}
                          disabled={!connected || buying === l.listingId || l.status !== "ACTIVE"}
                          className="btn px-3 py-1.5 text-label"
                        >
                          {buying === l.listingId ? "Reserving\u2026" : "Buy"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {!connected ? (
          <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-rule pt-6">
            <button onClick={() => void connect()} className="btn">
              Connect wallet
            </button>
            <p className="text-xs text-bone-dim">Required to fill an ask.</p>
          </div>
        ) : (
          <div className="mt-6 max-w-md border-t border-rule pt-6">
            <FeePicker
              rates={rates}
              selected={feeTier}
              onSelect={setFeeTier}
              vsizeHint={rates?.typicalVsize.TRANSFER}
            />
          </div>
        )}

        {msg ? <p className="mt-5 text-sm text-verified">{msg}</p> : null}
        {err ? <p className="mt-5 text-sm text-rejected">{err}</p> : null}
      </section>
    </div>
  );
}


/** Status is protocol state, so it gets the semantic chips, not grey text. */
function statusChip(status: string): string {
  if (status === "ACTIVE") return "chip chip-verified";
  if (status === "RESERVED" || status === "BROADCAST") return "chip chip-pending";
  return "chip chip-rejected";
}

function Empty({ message }: { message: string }) {
  return (
    <div className="border border-dashed border-rule px-6 py-16 text-center text-sm text-bone-dim">
      {message}
    </div>
  );
}

/**
 * useSearchParams opts this route into client-side rendering, which Next
 * requires to sit behind a Suspense boundary.
 */
export default function MarketPage() {
  return (
    <Suspense fallback={<div className="panel px-6 py-16 text-center text-sm text-bone-dim">Loading…</div>}>
      <MarketContent />
    </Suspense>
  );
}
