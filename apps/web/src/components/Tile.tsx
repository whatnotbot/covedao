"use client";

import { InfoTip } from "./InfoTip";

/**
 * One number and its label.
 *
 * Four pages had their own copy of this, which is how the same component ends
 * up gaining a feature in one place and not the others. It lives here now, and
 * carries an optional plain-language explanation: most of these labels are
 * protocol vocabulary, and a reader who does not already know what "backing"
 * means has nowhere else to find out.
 */
export function Tile({
  value,
  label,
  help,
  size = "lg",
}: {
  value: string;
  label: string;
  /** Plain-language explanation, reached from a marker beside the label. */
  help?: React.ReactNode;
  /** "lg" for a page's headline stats, "md" inside a denser row. */
  size?: "lg" | "md";
}) {
  return (
    <div className="tile">
      <div className={size === "lg" ? "tile-value" : "text-lg tabular-nums text-bone"}>{value}</div>
      <div className="tile-label flex items-center gap-1.5">
        <span>{label}</span>
        {help ? <InfoTip label={label}>{help}</InfoTip> : null}
      </div>
    </div>
  );
}
