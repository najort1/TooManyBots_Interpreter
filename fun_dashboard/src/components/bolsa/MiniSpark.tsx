"use client";

import { useId, useMemo } from "react";
import { cn } from "@/lib/cn";

type Props = {
  values: number[];
  className?: string;
  width?: number;
  height?: number;
};

/** Mini sparkline da watchlist (sessão / ticks). */
export function MiniSpark({
  values,
  className,
  width = 56,
  height = 20,
}: Props) {
  const id = useId().replace(/:/g, "");
  const geo = useMemo(() => {
    const pts = values.filter((n) => Number.isFinite(n));
    if (pts.length < 2) {
      return { path: "", up: true };
    }
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = max - min || 1;
    const pad = 1;
    const w = width;
    const h = height;
    const xs = pts.map((_, i) => pad + (i / (pts.length - 1)) * (w - pad * 2));
    const ys = pts.map((p) => pad + (1 - (p - min) / span) * (h - pad * 2));
    const path = xs
      .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`)
      .join(" ");
    return { path, up: pts[pts.length - 1] >= pts[0] };
  }, [values, width, height]);

  if (!geo.path) {
    return (
      <span
        className={cn("inline-block rounded bg-zinc-200/60 dark:bg-zinc-800", className)}
        style={{ width, height }}
        aria-hidden
      />
    );
  }

  const stroke = geo.up ? "#34d399" : "#f87171";

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0 overflow-visible", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.35" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path
        d={`${geo.path} L${width - 1},${height - 1} L1,${height - 1} Z`}
        fill={`url(#sp-${id})`}
      />
      <path
        d={geo.path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.4"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
