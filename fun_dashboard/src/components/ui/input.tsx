import { cn } from "@/lib/cn";

type Props = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: Props) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900",
        "placeholder:text-zinc-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/15",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500",
        "dark:focus-visible:ring-zinc-100/20",
        "disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}
