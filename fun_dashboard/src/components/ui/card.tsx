import { cn } from "@/lib/cn";

type CardProps = React.HTMLAttributes<HTMLDivElement>;

/** Container padrão das páginas ops — fórmula canônica já usada nos painéis. */
export function Card({ className, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
        className
      )}
      {...props}
    />
  );
}

type CardHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
};

/** Cabeçalho em linha: título/descrição à esquerda, ações opcionalmente à direita. */
export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

type CardTitleProps = React.HTMLAttributes<HTMLHeadingElement>;

export function CardTitle({ className, ...props }: CardTitleProps) {
  return (
    <h3
      className={cn("text-sm font-semibold text-zinc-900 dark:text-zinc-50", className)}
      {...props}
    />
  );
}

type CardDescriptionProps = React.HTMLAttributes<HTMLParagraphElement>;

export function CardDescription({ className, ...props }: CardDescriptionProps) {
  return (
    <p
      className={cn("mt-0.5 text-xs text-zinc-500 dark:text-zinc-400", className)}
      {...props}
    />
  );
}

type CardBodyProps = React.HTMLAttributes<HTMLDivElement>;

/** Corpo com respiro padrão; passe p-5 via className quando precisar de mais espaço. */
export function CardBody({ className, ...props }: CardBodyProps) {
  return <div className={cn("p-4", className)} {...props} />;
}
