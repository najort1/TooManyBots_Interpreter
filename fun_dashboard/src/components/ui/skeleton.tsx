import { cn } from "@/lib/cn";

type Props = React.HTMLAttributes<HTMLDivElement>;

/** Placeholder de carregamento — combine com width/height via className. */
export function Skeleton({ className, ...props }: Props) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-zinc-200/80 dark:bg-zinc-800/80", className)}
      {...props}
    />
  );
}
