import Link from "next/link";
import { getServices } from "@/lib/server";
import { listTokens, listMetadataByDeploymentTxids } from "@crclaunch/db";
import { tokenView } from "@/lib/token-view";
import { TokenCard } from "@/components/TokenCard";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { db, config } = getServices();
  const all = await listTokens(db, { network: config.network, limit: 100 });
  const metas = await listMetadataByDeploymentTxids(db, all.map((t) => t.deploymentTxid));
  const metaMap = new Map(metas.map((m) => [m.deploymentTxid, m]));
  const views = all.map((t) => tokenView(t, metaMap.get(t.deploymentTxid)));

  const live = views.filter((t) => ["LIVE", "SOLD_OUT", "GRADUATING"].includes(t.status));
  const graduated = views.filter((t) => t.status === "GRADUATED");

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="rounded-3xl border border-border bg-gradient-to-br from-surface via-surface to-brand/10 px-6 py-14 text-center sm:px-10">
        <h1 className="text-3xl font-bold tracking-tight text-white sm:text-5xl">
          Launch on Bitcoin.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-gray-300">
          Create a CRC-20 token. Start cheap. Mint progressively. Graduate. Trade — all without
          ever handing over your keys.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link
            href="/launch"
            className="rounded-xl bg-brand px-6 py-3 font-semibold text-white transition hover:bg-brand-bright"
          >
            Launch Token
          </Link>
          <a
            href="#live"
            className="rounded-xl border border-border bg-surface px-6 py-3 font-semibold text-gray-200 transition hover:border-brand/60"
          >
            Explore
          </a>
        </div>
      </section>

      {/* Live launches */}
      <section id="live">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Live launches</h2>
          <span className="text-sm text-gray-500">Progressive mint curve</span>
        </div>
        {live.length === 0 ? (
          <EmptyState message="No live launches yet. Be the first to launch a token." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {live.map((t) => (
              <TokenCard key={t.deploymentTxid} token={t} />
            ))}
          </div>
        )}
      </section>

      {/* Recently graduated */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold text-white">Recently graduated</h2>
        </div>
        {graduated.length === 0 ? (
          <EmptyState message="No graduated tokens yet." />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {graduated.map((t) => (
              <TokenCard key={t.deploymentTxid} token={t} />
            ))}
          </div>
        )}
      </section>

      {/* Trust model */}
      <section className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">How CRC works</h2>
        <div className="mt-4 space-y-3 text-sm text-gray-300">
          <p>CRC assets are recorded using Bitcoin transactions and interpreted by the canonical CRC indexer.</p>
          <p>
            Current CRC validation relies on canonical client/indexer rules rather than Bitcoin
            consensus enforcing token rules directly.
          </p>
          <p>Bitcoin confirms the underlying transactions; CRC determines their token meaning.</p>
        </div>
      </section>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface/40 px-6 py-12 text-center text-gray-400">
      {message}
    </div>
  );
}
