"use client";

import { use } from "react";
import { BolsaTerminal } from "@/components/bolsa/BolsaTerminal";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { resolveBolsaScope } from "@/lib/format";

type Props = {
  params: Promise<{ scope: string }>;
};

/**
 * Corretora dedicada — mobile compacto · desktop terminal.
 * Desktop: rodapé vira barra de status fina.
 */
export default function BolsaPublicPage({ params }: Props) {
  const { scope: raw } = use(params);
  const scope = resolveBolsaScope(raw);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 text-zinc-900 dark:bg-[#0e0e10] dark:text-zinc-50">
      {/* Mobile header */}
      <header className="border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-[#2d2d2d] dark:bg-[#18181b]/95 lg:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500">
              Corretora do Beco
            </div>
            <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
              Bolsa de valores
            </h1>
            <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
              Preços e gráficos · negócios no WhatsApp
            </p>
          </div>
          <ThemeToggle variant="secondary" />
        </div>
      </header>

      {/* Desktop terminal chrome */}
      <header className="sticky top-0 z-20 hidden border-b border-[#2d2d2d]/80 bg-[#141416]/90 backdrop-blur-md lg:block">
        <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4 px-6 py-2.5">
          <div className="flex items-center gap-3">
            <span className="beco-mark text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              Corretora do Beco
            </span>
            <span className="hidden text-[12px] text-zinc-500 xl:inline">
              Terminal de mercado · somente leitura
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden font-mono text-[11px] text-zinc-500 sm:inline">
              /bolsa · /carteira
            </span>
            <ThemeToggle variant="secondary" size="sm" />
          </div>
        </div>
      </header>

      <main className="flex-1 px-4 py-5 lg:px-6 lg:py-4">
        {!scope ? (
          <div className="mx-auto max-w-lg rounded-xl border border-dashed border-zinc-200 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Link incompleto
            </h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Use o link enviado pelo bot no grupo.
            </p>
          </div>
        ) : (
          <BolsaTerminal scope={scope} />
        )}
      </main>

      {/* Mobile footer */}
      <footer className="border-t border-zinc-200 px-4 py-4 text-center text-[11px] text-zinc-400 dark:border-[#2d2d2d] dark:text-zinc-500 lg:hidden">
        Somente leitura ·{" "}
        <code className="text-zinc-500">/bolsa</code> no WhatsApp
      </footer>

      {/* Desktop status bar (substitui rodapé) */}
      <footer className="sticky bottom-0 z-20 hidden border-t border-[#2d2d2d]/80 bg-[#141416]/95 backdrop-blur-md lg:block">
        <div className="mx-auto flex w-full max-w-[1680px] items-center justify-between gap-4 px-6 py-1.5 text-[11px] text-zinc-500">
          <span className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/80" />
            API · polling 45s · read-only
          </span>
          <span className="font-mono text-zinc-600">
            cmds: /bolsa comprar · /bolsa vender · /carteira
          </span>
        </div>
      </footer>
    </div>
  );
}
