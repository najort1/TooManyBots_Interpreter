import { cn } from "@/lib/cn";

type Props = {
  children: React.ReactNode;
  tone?: "neutral" | "success" | "warn" | "danger" | "ink";
  className?: string;
};

export function Badge({ children, tone = "neutral", className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-zinc-100 text-zinc-600",
        tone === "success" && "bg-emerald-50 text-emerald-700",
        tone === "warn" && "bg-amber-50 text-amber-800",
        tone === "danger" && "bg-red-50 text-red-700",
        tone === "ink" && "bg-zinc-900 text-zinc-50",
        className
      )}
    >
      {children}
    </span>
  );
}
