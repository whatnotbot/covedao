import { notFound } from "next/navigation";
import { getServices } from "@/lib/server";
import { getTokenByDeployment, getTokenMetadataForToken, listHolders } from "@crclaunch/db";
import { tokenView } from "@/lib/token-view";
import { fmtBtc, fmtPricePerMillion, fmtProgressBps, fmtTokens } from "@/lib/format";
import { MintButton } from "@/components/MintButton";
import { MarketSection } from "@/components/MarketSection";
import { ActivityFeed } from "@/components/ActivityFeed";
import { CurveChart } from "@/components/CurveChart";

export const dynamic = "force-dynamic";

export default async function TokenPage({ params }: { params: Promise<{ deploymentId: string }> }) {
  const { db, config } = getServices();
  const { deploymentId } = await params;
  const token = await getTokenByDeployment(db, config.network, deploymentId);
  if (!token) notFound();
  const meta = await getTokenMetadataForToken(db, token.id);
  const view = tokenView(token, meta);
  const holders = await listHolders(db, config.network, deploymentId, 25, 0);

  const explorer = config.explorerUrl;

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="rounded-3xl border border-border bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="w-full sm:w-64">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-white">{view.ticker}</h1>
              <span className="text-lg text-gray-400">{view.name}</span>
              <StatusPill status={view.status} />
            </div>

            {/* Above-the-fold: progress + stage + price */}
            <div className="mt-4">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">{fmtProgressBps(view.progressBps)} minted</span>
                <span className="text-gray-400">Stage {view.currentStage} / 20</span>
              </div>
              <div className="mt-1.5 h-3 w-full overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, view.progressBps / 100)}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Price label="Current" value={fmtPricePerMillion(view.currentPriceSatsPerMillion)} />
                <Price
                  label="Next"
                  value={view.nextStagePriceSatsPerMillion ? fmtPricePerMillion(view.nextStagePriceSatsPerMillion) : "—"}
                />
              </div>
            </div>

            <div className="mt-2 space-y-1 text-xs text-gray-500">
              <p>
                Creator: <a className="text-gray-300" href={`${explorer}/address/${view.creatorAddress}`} target="_blank" rel="noreferrer">{shortAddr(view.creatorAddress)}</a>
              </p>
              <p>
                Deployment:{" "}
                <a className="text-gray-300" href={`${explorer}/tx/${view.deploymentTxid}`} target="_blank" rel="noreferrer">{shortAddr(view.deploymentTxid)}</a>
              </p>
              {!view.isVerified && <p className="text-warning">Unverified token</p>}
            </div>
          </div>
          <div className="w-full sm:w-64">
            {["LIVE", "SOLD_OUT"].includes(view.status) && (
              <MintButton deploymentId={view.deploymentTxid} ticker={view.ticker} status={view.status} />
            )}
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Overview */}
        <section className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Metric label="Confirmed mint" value={fmtProgressBps(view.progressBps)} />
            <Metric label="Minted supply" value={fmtTokens(view.confirmedMintedAtoms)} />
            <Metric label="Current price" value={fmtPricePerMillion(view.currentPriceSatsPerMillion)} />
            <Metric label="Stage" value={`${view.currentStage} / 20`} />
            <Metric label="Reserve" value={fmtBtc(view.reserveSats)} />
            <Metric label="Holders" value={String(holders.length)} />
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-semibold text-white">Progressive mint curve</h2>
            <CurveChart currentStage={view.currentStage} />
          </div>

          {view.status === "GRADUATED" && (
            <div className="rounded-2xl border border-border bg-surface p-5">
              <h2 className="mb-3 font-semibold text-white">Marketplace</h2>
              <MarketSection deploymentId={view.deploymentTxid} ticker={view.ticker} />
            </div>
          )}

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-semibold text-white">Activity</h2>
            <ActivityFeed deploymentId={view.deploymentTxid} />
          </div>
        </section>

        {/* Sidebar */}
        <section className="space-y-4">
          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-semibold text-white">About</h2>
            <p className="whitespace-pre-wrap text-sm text-gray-300">
              {view.description || "No description."}
            </p>
            {view.websiteUrl && (
              <a href={view.websiteUrl} target="_blank" rel="noreferrer" className="mt-3 block text-sm text-brand hover:underline">
                Website ↗
              </a>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-semibold text-white">Tokenomics</h2>
            <div className="space-y-1.5 text-sm">
              <Row label="Supply" value="1,000,000,000" />
              <Row label="Public mint" value="840,000,000 (84%)" />
              <Row label="Graduation reserve" value="160,000,000 (16%)" />
              <Row label="Creator premine" value="0" />
              <Row label="Platform fee" value="1%" />
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-surface p-5">
            <h2 className="mb-3 font-semibold text-white">Holders</h2>
            {holders.length === 0 ? (
              <p className="text-sm text-gray-500">No confirmed holders yet.</p>
            ) : (
              <div className="space-y-2">
                {holders.slice(0, 10).map((h) => (
                  <div key={h.walletAddress} className="flex items-center justify-between text-sm">
                    <span className="text-gray-400">{shortAddr(h.walletAddress)}</span>
                    <span className="font-mono-nums text-gray-200">{fmtTokens(h.balanceAtoms)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = status === "LIVE" ? "bg-success/15 text-success" : status === "GRADUATED" ? "bg-accent/15 text-accent" : "bg-warning/15 text-warning";
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${color}`}>{status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-mono-nums text-lg font-semibold text-white">{value}</div>
    </div>
  );
}

function Price({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-bg p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 font-mono-nums text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono-nums text-gray-200">{value}</span>
    </div>
  );
}

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
