import type { LucideIcon } from "lucide-react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

type EmptyStateProps = {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

/** Estado vazio padronizado — centro, tom muted, ação opcional. */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-6 py-12 text-center",
        className
      )}
    >
      {Icon ? (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </div>
      ) : null}
      <h3 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
        {title}
      </h3>
      {description ? (
        <p className="mt-1 max-w-sm text-xs text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

type ErrorCardProps = {
  message?: string | null;
  onRetry?: () => void;
  className?: string;
};

/** Estado de erro padronizado — cartão vermelho com retry (padrão da página de economia). */
export function ErrorCard({ message, onRetry, className }: ErrorCardProps) {
  return (
    <Card
      className={cn(
        "flex flex-col items-center justify-center border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/30",
        className
      )}
    >
      <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
      <h3 className="mt-2 text-sm font-semibold text-red-900 dark:text-red-200">
        Erro ao carregar dados
      </h3>
      {message ? (
        <p className="mt-1 max-w-md text-xs text-red-700 dark:text-red-300">{message}</p>
      ) : null}
      {onRetry ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onRetry}
          className="mt-4 gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Tentar novamente
        </Button>
      ) : null}
    </Card>
  );
}
