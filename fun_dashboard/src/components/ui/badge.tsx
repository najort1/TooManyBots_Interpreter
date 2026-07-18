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
        tone === "neutral" &&
          "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
        tone === "success" &&
          "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400",
        tone === "warn" &&
          "bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300",
        tone === "danger" &&
          "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-400",
        tone === "ink" &&
          "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900",
        className
      )}
    >
      {children}
    </span>
  );
}
