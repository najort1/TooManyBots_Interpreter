"use client";

import { useId, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { formatCoins, formatWhen } from "@/lib/format";
import type { BolsaHistoryPoint } from "@/lib/types";

type Props = {
  points: BolsaHistoryPoint[];
  ath?: number;
  className?: string;
  height?: number;
  /** linha | área (default área) */
  variant?: "line" | "area";
};

/**
 * Gráfico SVG com profundidade: grid, ATH, crosshair, tooltip, gradiente.
 */
export function PriceChart({
  points,
  ath = 0,
  className,
  height = 220,
  variant = "area",
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");

  const geo = useMemo(() => {
    const pts = points.length ? points : [];
    if (!pts.length) {
      return {
        path: "",
        area: "",
        min: 0,
        max: 1,
        w: 100,
        h: height,
        pad: 12,
        gridYs: [] as number[],
        gridLabels: [] as number[],
      };
    }
    const prices = pts.map((p) => p.price);
    let min = Math.min(...prices);
    let max = Math.max(...prices);
    if (ath > 0) {
      max = Math.max(max, ath);
      min = Math.min(min, ath);
    }
    const padY = Math.max(1, (max - min) * 0.06);
    min = Math.max(0, min - padY);
    max = max + padY;
    if (min === max) {
      min = Math.max(0, min - 1);
      max = max + 1;
    }
    const padL = 44;
    const padR = 12;
    const padT = 14;
    const padB = 12;
    const w = 960;
    const h = height;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const xs = pts.map((_, i) =>
      pts.length === 1 ? padL + innerW / 2 : padL + (i / (pts.length - 1)) * innerW
    );
    const ys = prices.map(
      (p) => padT + innerH - ((p - min) / (max - min)) * innerH
    );
    // smooth-ish polyline (catmull-rom lite via midpoints is overkill; keep line + soft area)
    const line = xs
      .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`)
      .join(" ");
    const area = `${line} L${xs[xs.length - 1].toFixed(1)},${(padT + innerH).toFixed(1)} L${xs[0].toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

    const gridN = 4;
    const gridYs: number[] = [];
    const gridLabels: number[] = [];
    for (let i = 0; i <= gridN; i++) {
      const t = i / gridN;
      gridYs.push(padT + innerH * (1 - t));
      gridLabels.push(Math.round(min + (max - min) * t));
    }

    const athY =
      ath > 0
        ? padT + innerH - ((ath - min) / (max - min)) * innerH
        : null;
    return {
      path: line,
      area,
      min,
      max,
      w,
      h,
      pad: padL,
      padT,
      padB,
      padL,
      padR,
      xs,
      ys,
      athY,
      pts,
      gridYs,
      gridLabels,
      innerH,
    };
  }, [points, ath, height]);

  if (!points.length) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-white text-sm text-zinc-500",
          "dark:border-zinc-700 dark:bg-zinc-900/80 dark:text-zinc-400",
          className
        )}
        style={{ height }}
      >
        Sem histórico neste período.
      </div>
    );
  }

  const hi = hover != null ? points[hover] : null;
  const up =
    points.length >= 2
      ? points[points.length - 1].price >= points[0].price
      : true;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.06)]",
        "dark:border-zinc-800 dark:bg-[#18181b] dark:shadow-[0_8px_30px_rgba(0,0,0,0.35)]",
        className
      )}
    >
      <svg
        viewBox={`0 0 ${geo.w} ${geo.h}`}
        className="h-auto w-full"
        role="img"
        aria-label="Histórico de preço"
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={`bolsaFill-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={up ? "var(--chart-line)" : "#71717a"}
              stopOpacity="0.22"
            />
            <stop offset="100%" stopColor="var(--chart-line)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* grid horizontal */}
        {geo.gridYs?.map((y, i) => (
          <g key={i}>
            <line
              x1={geo.padL}
              x2={geo.w - (geo.padR || 12)}
              y1={y}
              y2={y}
              stroke="var(--chart-grid)"
              strokeOpacity="0.45"
              strokeWidth="1"
            />
            <text
              x={(geo.padL || 44) - 8}
              y={y + 3}
              textAnchor="end"
              className="fill-zinc-400 dark:fill-zinc-500"
              style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}
            >
              {geo.gridLabels?.[i]}
            </text>
          </g>
        ))}

        {geo.athY != null ? (
          <g>
            <line
              x1={geo.padL}
              x2={geo.w - (geo.padR || 12)}
              y1={geo.athY}
              y2={geo.athY}
              stroke="var(--chart-ath)"
              strokeDasharray="5 4"
              strokeWidth="1.25"
            />
            <text
              x={(geo.w - (geo.padR || 12)) - 4}
              y={(geo.athY || 0) - 4}
              textAnchor="end"
              className="fill-zinc-400 dark:fill-zinc-500"
              style={{ fontSize: 10, fontFamily: "ui-sans-serif, system-ui" }}
            >
              ATH
            </text>
          </g>
        ) : null}

        {variant === "area" ? (
          <path d={geo.area} fill={`url(#bolsaFill-${gradId})`} />
        ) : null}
        <path
          d={geo.path}
          fill="none"
          stroke="var(--chart-line)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          className="transition-[d] duration-300 ease-out"
        />

        {geo.xs?.map((x, i) => (
          <rect
            key={i}
            x={i === 0 ? geo.padL : (geo.xs![i - 1] + x) / 2}
            y={geo.padT || 0}
            width={
              i === geo.xs!.length - 1
                ? geo.w - (geo.padR || 12) - (i === 0 ? geo.padL! : (geo.xs![i - 1] + x) / 2)
                : (geo.xs![i + 1] + x) / 2 -
                  (i === 0 ? geo.padL! : (geo.xs![i - 1] + x) / 2)
            }
            height={geo.innerH || geo.h}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {hover != null && geo.xs && geo.ys ? (
          <>
            <line
              x1={geo.xs[hover]}
              x2={geo.xs[hover]}
              y1={geo.padT}
              y2={(geo.padT || 0) + (geo.innerH || 0)}
              stroke="var(--chart-grid)"
              strokeWidth="1.25"
            />
            <line
              x1={geo.padL}
              x2={geo.w - (geo.padR || 12)}
              y1={geo.ys[hover]}
              y2={geo.ys[hover]}
              stroke="var(--chart-grid)"
              strokeWidth="1"
              strokeDasharray="3 3"
              strokeOpacity="0.7"
            />
            <circle
              cx={geo.xs[hover]}
              cy={geo.ys[hover]}
              r="5"
              fill="var(--chart-line)"
              className="drop-shadow-sm"
            />
            <circle
              cx={geo.xs[hover]}
              cy={geo.ys[hover]}
              r="9"
              fill="var(--chart-line)"
              fillOpacity="0.12"
            />
          </>
        ) : null}
      </svg>

      {/* tooltip */}
      {hi ? (
        <div className="pointer-events-none absolute left-4 top-3 rounded-lg border border-zinc-200/80 bg-white/95 px-3 py-1.5 text-xs shadow-md backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
          <div className="font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
            {formatCoins(hi.price)}
          </div>
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {formatWhen(hi.createdAt)}
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-2.5 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <span>
          {hi
            ? "cursor no ponto"
            : `mín ${formatCoins(geo.min)} · máx ${formatCoins(geo.max)}`}
        </span>
        {ath > 0 ? (
          <span className="tabular-nums">ATH {formatCoins(ath)}</span>
        ) : null}
      </div>
    </div>
  );
}
