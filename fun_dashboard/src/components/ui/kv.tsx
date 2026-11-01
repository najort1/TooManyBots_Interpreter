import { cn } from "@/lib/cn";

type KeyValueProps = {
  label: React.ReactNode;
  /** Valor exibido à direita da linha. */
  children?: React.ReactNode;
  /** Texto de apoio exibido sob o rótulo. */
  hint?: React.ReactNode;
  /** Valor em fonte monoespaçada, truncado (URLs, ids, modelos). */
  mono?: boolean;
  className?: string;
  valueClassName?: string;
};

/**
 * Linha rótulo → valor dos painéis ops (mescla o `Row` do overview e o `KV` do settings):
 * rótulo muted à esquerda, valor em destaque alinhado à direita, separados por borda inferior.
 */
export function KeyValue({
  label,
  children,
  hint,
  mono,
  className,
  valueClassName,
}: KeyValueProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 border-b border-zinc-100 py-1.5 last:border-0 dark:border-zinc-800",
        className
      )}
    >
      <span className="min-w-0 text-xs text-zinc-600 dark:text-zinc-400">
        {label}
        {hint ? (
          <span className="mt-0.5 block text-[11px] font-normal text-zinc-500 dark:text-zinc-400">
            {hint}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "text-right text-sm font-medium text-zinc-900 dark:text-zinc-50",
          mono && "max-w-[60%] truncate font-mono text-xs font-normal",
          valueClassName
        )}
      >
        {children}
      </span>
    </div>
  );
}
