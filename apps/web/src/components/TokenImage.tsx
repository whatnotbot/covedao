"use client";

import { useState } from "react";

/**
 * A token's picture, with a monogram behind it.
 *
 * The image URL is metadata a creator typed, not chain state: it can be wrong,
 * dead, or absent, and a launchpad full of broken-image icons looks abandoned.
 * The monogram is always rendered underneath, so a failed load degrades to
 * something deliberate instead of a grey box.
 *
 * The colour is derived from the tokenId, which means it is stable for the
 * life of the token and distinct between neighbours in a list — the same job a
 * favicon does in a row of browser tabs.
 */

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-11 w-11 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

/** Hue from the first bytes of the tokenId: stable, and spread across the wheel. */
function hueOf(tokenId: string): number {
  let h = 0;
  for (let i = 0; i < Math.min(tokenId.length, 8); i++) {
    h = (h * 31 + tokenId.charCodeAt(i)) % 360;
  }
  return h;
}

export function TokenImage({
  tokenId,
  ticker,
  imageUrl,
  size = "md",
}: {
  tokenId: string;
  ticker: string;
  imageUrl?: string | null;
  size?: keyof typeof SIZES;
}) {
  const [failed, setFailed] = useState(false);
  const hue = hueOf(tokenId);
  const show = imageUrl && !failed;

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-rule ${SIZES[size]}`}
      style={{ backgroundColor: `hsl(${hue} 30% 18%)`, color: `hsl(${hue} 60% 72%)` }}
      aria-hidden="true"
    >
      <span className="font-medium tracking-wide">{ticker.slice(0, 3).toUpperCase()}</span>
      {/* A plain <img>: the host is arbitrary creator-supplied metadata, which
          next/image cannot optimise without allow-listing every domain. */}
      {show ? (
        <img
          src={imageUrl}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : null}
    </span>
  );
}
