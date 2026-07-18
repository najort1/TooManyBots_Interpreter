import { ThemeToggle } from "@/components/theme/ThemeToggle";

/**
 * /bolsa sem id — não lista grupos (privacidade).
 * O link real vem do bot: /bolsa/<id-do-grupo>
 */
export default function BolsaEntryPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="absolute right-4 top-4">
        <ThemeToggle variant="secondary" />
      </div>
      <div className="max-w-sm rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          Corretora do Beco
        </div>
        <h1 className="mt-2 text-lg font-semibold tracking-tight">
          Link incompleto
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          Abra o link da bolsa enviado pelo bot no WhatsApp do seu grupo. Cada
          grupo tem a sua própria corretora.
        </p>
        <p className="mt-4 text-xs text-zinc-400 dark:text-zinc-500">
          Compra e venda só com{" "}
          <code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            /bolsa
          </code>{" "}
          no zap.
        </p>
      </div>
    </div>
  );
}
