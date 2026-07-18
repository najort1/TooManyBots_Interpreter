import { cn } from "@/lib/cn";

type Props = React.SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...props }: Props) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-zinc-200 bg-white px-2.5 text-sm text-zinc-900",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
        "dark:focus-visible:ring-zinc-100/20",
        "disabled:opacity-50",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}
