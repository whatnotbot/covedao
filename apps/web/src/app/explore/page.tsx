"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useIndexedHeight } from "@/lib/use-indexed-height";
import { useSearchParams } from "next/navigation";
import type { V3TokenCardData } from "@/components/TokenCard";
import { DEMO_TOKENS } from "@/lib/demo-tokens";
import { fmtBtc, fmtInt, fmtTokens } from "@/lib/format";
import { Sparkline } from "@/components/Sparkline";
import { TokenImage } from "@/components/TokenImage";
import { Tile } from "@/components/Tile";
import { InfoTip } from "@/components/InfoTip";
import { useSparklines } from "@/lib/use-sparklines";

type SortKey = "progress" | "backing" | "holders" | "newest";
type Filter = "all" | "open" | "graduated" | "listed";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "progress", label: "Progress" },
  { key: "backing", label: "Backing" },
  { key: "holders", label: "Holders" },
  { key: "newest", label: "Newest" },
];

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "graduated", label: "Graduated" },
  { key: "listed", label: "Listed" },
];

function ExploreContent() {
  const params = useSearchParams();
  // Demo mode renders fixtures client-side so the design can be reviewed
  // against a populated page. It never calls the API and never writes.
  const demo = params.get("demo") === "1";

  const [tokens, setTokens] = useState<V3TokenCardData[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortKey>("progress");
  const [filter, setFilter] = useState<Filter>("all");

  // Refetch when a new block is indexed; only a new search shows the loading state.
  const height = useIndexedHeight();
  const shownSearch = useRef<string | null>(null);
  useEffect(() => {
    if (demo) {
      setTokens(DEMO_TOKENS);
      setLoaded(true);
      return;
    }
    if (shownSearch.current !== search) setLoaded(false);
    shownSearch.current = search;
    setFailed(false);
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    void fetch(`/api/v3/tokens${q}`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setTokens(j.data);
        else setFailed(true);
        setLoaded(true);
      })
      .catch(() => {
        setFailed(true);
        setLoaded(true);
      });
  }, [search, demo, height]);

  const rows = useMemo(() => {
    const pct = (t: V3TokenCardData) => {
      const cap = BigInt(t.publicCapAtoms);
      return cap > 0n ? Number((BigInt(t.issuedSupplyAtoms) * 10_000n) / cap) / 100 : 0;
    };
    // Prefer the server-derived flag so a row and its badge can never disagree;
    // fall back to the percentage only for fixtures that predate it.
    const isGraduated = (t: V3TokenCardData) => t.graduated ?? pct(t) >= 100;
    let out = tokens.filter((t) => {
      if (filter === "open") return !isGraduated(t);
      if (filter === "graduated") return isGraduated(t);
      if (filter === "listed") return t.bestAskSats !== null;
      return true;
    });
    if (demo && search) {
      const q = search.toLowerCase();
      out = out.filter(
        (t) =>
          t.ticker.toLowerCase().includes(q) ||
          t.displayName.toLowerCase().includes(q) ||
          t.tokenId.startsWith(q),
      );
    }
    return [...out].sort((a, b) => {
      if (sort === "progress") return pct(b) - pct(a);
      if (sort === "holders") return b.holderCount - a.holderCount;
      if (sort === "newest") return Number(b.deployHeight) - Number(a.deployHeight);
      return Number(BigInt(b.backingSats) - BigInt(a.backingSats));
    });
  }, [tokens, filter, sort, search, demo]);

  const totalBacking = rows.reduce((a, t) => a + BigInt(t.backingSats), 0n);
  const totalHolders = rows.reduce((a, t) => a + t.holderCount, 0);

  const graduatedRows = useMemo(
    () =>
      tokens.filter((t) => {
        const cap = BigInt(t.publicCapAtoms);
        return t.graduated ?? (cap > 0n && BigInt(t.issuedSupplyAtoms) >= cap);
      }),
    [tokens],
  );

  const { series } = useSparklines(
    rows.map((t) => ({ tokenId: t.tokenId, ticker: t.ticker, curveStage: t.curveStage })),
    demo,
  );

  return (
    <div className="space-y-px">
      <section className="panel px-6 py-8 sm:px-10">
        <p className="eyebrow">Explore</p>
        <h1 className="mt-4 text-3xl text-bone">Confirmed tokens</h1>
        <p className="mt-2 max-w-xl text-sm text-bone-dim">
          Every token below is derived from confirmed Bitcoin blocks by the open indexer. Search by
          tokenId, ticker or name.
        </p>

        {demo ? (
          <p className="mt-5 inline-block border border-pending/40 bg-pending/10 px-3 py-1.5 text-label uppercase tracking-label text-pending">
            Demo data · not from the chain
          </p>
        ) : null}

        {/* Aggregate row — the shape of the whole set before any single token. */}
        <div className="mt-6 grid grid-cols-3 gap-px bg-rule">
          <Tile value={String(rows.length)} label="Tokens" />
          <Tile
            value={fmtBtc(totalBacking)}
            label="Total backing"
            help="All the Bitcoin held across every token's vault. Each token has its own."
          />
          <Tile value={fmtInt(totalHolders)} label="Holders" />
        </div>
      </section>

      {/* Controls */}
      <section className="panel px-6 py-5 sm:px-10">
        <div className="flex flex-wrap items-center gap-4">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tokenId, ticker or name"
            aria-label="Search tokens"
            className="field max-w-sm flex-1"
          />

          <div className="flex items-center gap-2">
            <span className="eyebrow">Filter</span>
            <div className="flex">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={
                    filter === f.key
                      ? "border border-signal bg-signal px-3 py-1.5 text-label uppercase tracking-label text-ink"
                      : "border border-rule px-3 py-1.5 text-label uppercase tracking-label text-bone-dim transition-colors hover:text-bone"
                  }
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="eyebrow">Sort</span>
            <div className="flex">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setSort(s.key)}
                  className={
                    sort === s.key
                      ? "border border-rule-bright bg-ink-3 px-3 py-1.5 text-label uppercase tracking-label text-bone"
                      : "border border-rule px-3 py-1.5 text-label uppercase tracking-label text-bone-dim transition-colors hover:text-bone"
                  }
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Graduated board — the tokens that sold out their entire curve. */}
      {graduatedRows.length > 0 ? (
        <section className="panel px-6 py-8 sm:px-10">
          <div className="flex items-baseline justify-between">
            <p className="eyebrow">Graduated</p>
            <span className="text-label uppercase tracking-label text-bone-dim">
              Full 1B curve minted
            </span>
          </div>
          <div
            className={`mt-5 grid gap-px bg-rule ${
              graduatedRows.length === 1
                ? ""
                : graduatedRows.length === 2
                  ? "sm:grid-cols-2"
                  : "sm:grid-cols-2 lg:grid-cols-3"
            }`}
          >
            {graduatedRows.slice(0, 6).map((t) => (
              <Link
                key={t.tokenId}
                href={`/token/${t.tokenId}`}
                className="group bg-ink-3 px-5 py-4 transition-colors hover:bg-ink-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-bone transition-colors group-hover:text-signal">
                    {t.ticker}
                  </span>
                  <span className="chip chip-signal shrink-0">Graduated</span>
                </div>
                <div className="mt-1 truncate text-xs text-bone-dim">{t.displayName}</div>
                <div className="mt-3 flex justify-between text-xs tabular-nums">
                  <span className="text-bone-dim">Backing</span>
                  <span className="text-bone-2">{fmtBtc(BigInt(t.backingSats))}</span>
                </div>
                <div className="mt-1 flex justify-between text-xs tabular-nums">
                  <span className="text-bone-dim">Holders</span>
                  <span className="text-bone-2">{fmtInt(t.holderCount)}</span>
                </div>
              </Link>
            ))}
          </div>
          <p className="mt-5 max-w-xl text-xs leading-relaxed text-bone-dim">
            Minting is finished for these. The backing vault keeps buying and selling at the curve
            price exactly as before &mdash; graduation marks the milestone, it does not change how
            the token works.
          </p>
        </section>
      ) : null}

      {/* Results */}
      <section className="panel px-6 py-8 sm:px-10">
        {!loaded ? (
          <Skeleton />
        ) : failed ? (
          <Notice
            kind="rejected"
            title="Could not reach the indexer"
            body="The chain projection is unavailable. Nothing is wrong with your wallet — this page is read-only."
          />
        ) : rows.length === 0 ? (
          <Notice
            kind="pending"
            title={search ? "No match" : "No confirmed tokens yet"}
            body={
              search
                ? `Nothing matches “${search}”. Tokens appear here once their DEPLOY transaction confirms.`
                : "Tokens appear here once their DEPLOY transaction confirms on Bitcoin."
            }
            action={
              search ? (
                <button onClick={() => setSearch("")} className="btn-ghost mt-5">
                  Clear search
                </button>
              ) : (
                <Link href="/launch" className="btn mt-5">
                  Launch the first one
                </Link>
              )
            }
          />
        ) : (
          <TokenTable rows={rows} series={series} />
        )}
      </section>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<Skeleton />}>
      <ExploreContent />
    </Suspense>
  );
}

function TokenTable({
  rows,
  series,
}: {
  rows: V3TokenCardData[];
  series: Record<string, number[]>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="ledger-table min-w-[72rem]">
        <thead>
          <tr>
            <th>Ticker</th>
            <th>Status</th>
            <th>Last · sats/1k</th>
            <th>Trend</th>
            <th>Issued / cap</th>
            <th>Progress</th>
            <th>
              <span className="inline-flex items-center gap-1.5">
                Backing
                <InfoTip label="backing">
                  Real Bitcoin held in a vault for this token — holders can always sell back into
                  it, no buyer needed.
                </InfoTip>
              </span>
            </th>
            <th>Stage</th>
            <th>Holders</th>
            <th>Best ask</th>
            <th>Height</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const cap = BigInt(t.publicCapAtoms);
            const issued = BigInt(t.issuedSupplyAtoms);
            const pct = cap > 0n ? Number((issued * 10_000n) / cap) / 100 : 0;
            return (
              <tr key={t.tokenId} className="transition-colors hover:bg-ink-3">
                <td>
                  <div className="flex items-center gap-3">
                    <TokenImage
                      tokenId={t.tokenId}
                      ticker={t.ticker}
                      imageUrl={t.imageUrl}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <Link href={`/token/${t.tokenId}`} className="text-bone hover:text-signal">
                        {t.ticker}
                      </Link>
                      <div className="truncate text-xs text-bone-dim">{t.displayName}</div>
                    </div>
                  </div>
                </td>
                <td>
                  {t.graduated ?? pct >= 100 ? (
                    <span className="chip chip-signal">Graduated</span>
                  ) : (
                    <span className="chip chip-verified">Open</span>
                  )}
                </td>
                <td className="text-bone">
                  {(series[t.tokenId]?.length ?? 0) > 0
                    ? fmtInt(Math.round(series[t.tokenId]![series[t.tokenId]!.length - 1]!))
                    : <span className="text-bone-dim">&mdash;</span>}
                </td>
                <td>
                  <Sparkline values={series[t.tokenId] ?? []} width={88} height={24} />
                </td>
                <td className="whitespace-nowrap text-bone-2">
                  {fmtTokens(issued)} / {fmtTokens(cap)}
                </td>
                <td className="w-40">
                  <div className="h-1 w-full bg-rule">
                    <div className="h-1 bg-signal" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                  <div className="mt-1 text-xs text-bone-dim">{pct.toFixed(1)}%</div>
                </td>
                <td className="whitespace-nowrap text-bone-2">{fmtBtc(BigInt(t.backingSats))}</td>
                <td className="whitespace-nowrap text-bone-dim">{t.curveStage} / 210</td>
                <td className="text-bone-2">{fmtInt(t.holderCount)}</td>
                <td className="whitespace-nowrap text-bone-2">
                  {t.bestAskSats ? (
                    fmtBtc(BigInt(t.bestAskSats))
                  ) : (
                    <span className="text-bone-dim">—</span>
                  )}
                </td>
                <td className="text-bone-dim">{fmtInt(Number(t.deployHeight))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Loading shows the SHAPE of the result, so the page does not jump when data lands. */
function Skeleton() {
  return (
    <div className="grid gap-px bg-rule sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="bg-ink-3 px-5 py-5">
          <div className="h-3 w-20 animate-pulse bg-rule-bright" />
          <div className="mt-2 h-2.5 w-28 animate-pulse bg-rule" />
          <div className="mt-5 h-1 w-full bg-rule" />
          <div className="mt-5 space-y-2">
            <div className="h-2.5 w-full animate-pulse bg-rule" />
            <div className="h-2.5 w-2/3 animate-pulse bg-rule" />
            <div className="h-2.5 w-1/2 animate-pulse bg-rule" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Notice({
  kind,
  title,
  body,
  action,
}: {
  kind: "pending" | "rejected";
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="border border-dashed border-rule px-6 py-16 text-center">
      <span className={kind === "rejected" ? "chip chip-rejected" : "chip chip-pending"}>
        {kind === "rejected" ? "Unavailable" : "Empty"}
      </span>
      <div className="mt-4 text-bone">{title}</div>
      <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-bone-dim">{body}</p>
      {action}
    </div>
  );
}
