import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

export type Metric = {
  label: string;
  value: number | string;
  hint?: string;
};

type Props = {
  items: Metric[];
  className?: string;
};

export function MetricStrip({ items, className }: Props) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 sm:grid-cols-4",
        className
      )}
    >
      {items.map((item) => (
        <div key={item.label} className="bg-white px-4 py-3">
          <div className="text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums">
            {typeof item.value === "number" ? formatNumber(item.value) : item.value}
          </div>
          <div className="mt-0.5 text-xs font-medium text-zinc-500">{item.label}</div>
          {item.hint ? (
            <div className="mt-1 text-[11px] text-zinc-400">{item.hint}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
