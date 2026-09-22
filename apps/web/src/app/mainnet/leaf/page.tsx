import { OBSERVED_LEAF_TRANSFER } from "@crclaunch/protocol";

export const metadata = { title: "LEAF — read-only mainnet — CRC Launch" };

export default function MainnetLeafPage() {
  const t = OBSERVED_LEAF_TRANSFER;
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-xs font-semibold text-warning">
            LIVE MAINNET DATA
          </span>
          <span className="rounded-full bg-border px-2.5 py-0.5 text-xs font-semibold text-gray-300">
            READ ONLY
          </span>
        </div>
        <h1 className="mt-3 text-3xl font-bold text-white">$leaf — CRC-20</h1>
        <p className="mt-2 text-sm text-gray-400">
          What we can reliably derive from a confirmed mainnet CRC-20 transfer. Write operations
          are disabled.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-semibold text-white">Observed on-chain format</h2>
        <p className="mt-2 text-xs text-gray-500">
          A real, confirmed transfer. We show only facts derivable from the transaction itself.
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <Row k="txid" v={<code className="break-all text-gray-300">{t.txid}</code>} />
          <Row k="block" v={String(t.blockHeight)} />
          <Row k="OP_RETURN" v={<code className="text-gray-300">{JSON.stringify(t.payload)}</code>} />
          <Row k="amount (atoms, 8 decimals)" v={`${t.payload.amt} ≈ 100,000 LEAF`} />
          <Row k="recipient (vout 1)" v={t.recipientAddress} />
          <Row k="treasury fee (vout 2)" v={`${t.treasurySats} sats → ${t.treasuryAddress}`} />
        </dl>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-5">
        <h2 className="font-semibold text-white">Trust model</h2>
        <ul className="mt-3 space-y-2 text-sm text-gray-300">
          <li>CRC assets are recorded using Bitcoin transactions and interpreted by the canonical CRC indexer.</li>
          <li>Current CRC validation relies on canonical client/indexer rules rather than Bitcoin consensus enforcing token rules directly.</li>
          <li>Bitcoin confirms the underlying transactions; CRC determines their token meaning.</li>
          <li>The treasury output is a single-key Taproot output — no independent on-chain lock is verifiable.</li>
        </ul>
      </div>

      <p className="text-xs text-gray-500">
        Live canonical state is not currently queryable from this deployment (the crc.garden API is
        unavailable); the fields above are fixed fixtures from a confirmed transaction, not a live
        read.
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
      <dt className="w-44 shrink-0 text-gray-500">{k}</dt>
      <dd className="break-all text-gray-200">{v}</dd>
    </div>
  );
}
