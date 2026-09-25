/**
 * A price sparkline — a line, a soft fill under it, and a dot on the last point.
 *
 * Drawn as inline SVG rather than a chart instance because these appear tens of
 * times on a single list page; spinning up a canvas chart per row would cost
 * more than the whole rest of the page.
 *
 * The colour follows direction using the same verified/rejected pair as the
 * full chart, so a green line means the same thing in a table row as it does on
 * a token page.
 */

export function Sparkline({
  values,
  width = 104,
  height = 28,
  className = "",
  label,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  /** Screen-reader description. Without one this is decoration, and is hidden. */
  label?: string;
}) {
  // One point cannot show a trend, and zero points have nothing to show. Hold
  // the row height so the table does not jump as data arrives.
  if (values.length < 2) {
    return (
      <div
        className={`flex items-center ${className}`}
        style={{ width, height }}
        aria-hidden={!label}
        role={label ? "img" : undefined}
        aria-label={label}
      >
        <span className="h-px w-full bg-rule" />
      </div>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;

  // A flat series would divide by zero; draw it down the middle instead.
  const y = (v: number) => (span === 0 ? height / 2 : height - ((v - min) / span) * (height - 2) - 1);
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;

  const line = values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `${line} L${(width - 1).toFixed(2)},${height} L1,${height} Z`;

  const up = values[values.length - 1]! >= values[0]!;
  const stroke = up ? "#5E9E76" : "#C4553F";
  const gradientId = `spark-${up ? "up" : "down"}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={!label}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r="1.75" fill={stroke} />
    </svg>
  );
}
