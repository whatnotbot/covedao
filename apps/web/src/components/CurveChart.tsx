"use client";

import { STAGE_PRICES_SATS_PER_MILLION, STAGE_COUNT } from "@crclaunch/curve";

export function CurveChart({ currentStage }: { currentStage: number }) {
  const w = 320;
  const h = 160;
  const maxPrice = STAGE_PRICES_SATS_PER_MILLION[STAGE_COUNT - 1]!;

  const points = STAGE_PRICES_SATS_PER_MILLION.map((price, i) => {
    const x = (i / (STAGE_COUNT - 1)) * w;
    const y = h - (Number(price) / Number(maxPrice)) * (h - 20);
    return { x, y, stage: i + 1, price };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  return (
    <div className="overflow-x-auto" role="img" aria-label="Progressive mint curve chart">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[280px]">
        <line x1="0" y1={h - 0.5} x2={w} y2={h - 0.5} stroke="#23232f" strokeWidth="1" />
        <line x1="0" y1="0" x2="0" y2={h} stroke="#23232f" strokeWidth="1" />
        <path d={path} fill="none" stroke="#7c5cff" strokeWidth="2" />
        {points.map((p) => (
          <g key={p.stage}>
            <circle cx={p.x} cy={p.y} r={p.stage === currentStage ? 4 : 2} fill={p.stage === currentStage ? "#22d3ee" : "#9d86ff"}>
              <title>{`Stage ${p.stage} — ${p.price} sats / 1M`}</title>
            </circle>
            {p.stage === currentStage && (
              <text x={Math.min(p.x, w - 70)} y={p.y - 10} fill="#22d3ee" fontSize="10">
                YOU ARE HERE
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-gray-500">
        <span>0%</span>
        <span>50% public supply</span>
        <span>100%</span>
      </div>
    </div>
  );
}
