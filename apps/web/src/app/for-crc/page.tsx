import Link from "next/link";

export const metadata = { title: "For the CRC team — CRC Launch" };

export default function ForCrcPage() {
  return (
    <div className="space-y-12">
      <section className="rounded-3xl border border-border bg-gradient-to-br from-surface to-brand/10 px-6 py-14 text-center sm:px-10">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          A permissionless launch experience for CRC.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-gray-300">
          CRC Launch is a complete non-custodial launchpad and marketplace for CRC-20 assets — built
          behind clean interfaces so it can connect to your canonical Oracle and indexer with
          minimal work.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/demo" className="rounded-xl bg-brand px-6 py-3 font-semibold text-white hover:bg-brand-bright">
            View the demo
          </Link>
          <Link href="/launch" className="rounded-xl border border-border bg-surface px-6 py-3 font-semibold text-gray-200 hover:border-brand/60">
            Try a launch
          </Link>
        </div>
      </section>

      <section>
        <h2 className="mb-5 text-xl font-semibold text-white">What is already built</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["Launch", "Two-step creator flow with standardized tokenomics and risk confirmation."],
            ["Progressive Mint", "20-stage deterministic curve, exact integer pricing, live quotes."],
            ["Discovery", "Trending, near-graduation and graduated views; activity feed."],
            ["Portfolio", "Connected-wallet balances, mints, trades and listings."],
            ["Graduation", "SOLD OUT → GRADUATING → GRADUATED with finality and reorg recovery."],
            ["Marketplace", "Non-custodial fixed-price listings: sell, buy, cancel — atomic by design."],
          ].map(([t, b]) => (
            <div key={t} className="rounded-2xl border border-border bg-surface p-5">
              <div className="font-semibold text-white">{t}</div>
              <p className="mt-2 text-sm text-gray-400">{b}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-border bg-surface p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-white">What we need from CRC</h2>
        <ul className="mt-4 space-y-3 text-gray-300">
          {[
            "Canonical deploy authorization",
            "Canonical mint validation",
            "Canonical state API",
            "Sandbox / test environment",
            "Marketplace rules",
          ].map((item) => (
            <li key={item} className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-gray-400">
          The demo application (launch, progressive mint, portfolio, graduation and the fixed-price
          marketplace) runs against a local mock chain. Real Bitcoin integration — wallet connection,
          PSBT signing, signature verification and a live Bitcoin provider — is not yet wired into the
          web app, and remains this project&apos;s work, not CRC&apos;s.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/mainnet/leaf" className="rounded-lg border border-border px-4 py-2 text-sm text-gray-200 hover:border-brand/60">
            Read-only LEAF view
          </Link>
        </div>
      </section>
    </div>
  );
}
