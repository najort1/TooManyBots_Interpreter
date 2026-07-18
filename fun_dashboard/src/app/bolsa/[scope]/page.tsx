"use client";

import { use } from "react";
import { BolsaTerminal } from "@/components/bolsa/BolsaTerminal";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { resolveBolsaScope } from "@/lib/format";

type Props = {
  params: Promise<{ scope: string }>;
};

/**
 * Corretora dedicada — mobile compacto · desktop terminal denso.
 */
export default function BolsaPublicPage({ params }: Props) {
  const { scope: raw } = use(params);
  const scope = resolveBolsaScope(raw);

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-[#0e0e10] dark:text-zinc-50">
      <header className="border-b border-zinc-200 bg-white/95 backdrop-blur dark:border-[#2d2d2d] dark:bg-[#18181b]/95">
        <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3.5 lg:px-8 lg:py-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400 dark:text-zinc-500 lg:text-[11px]">
              Corretora do Beco
            </div>
            <h1 className="mt-0.5 text-lg font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 lg:text-[28px] lg:leading-tight">
              Bolsa de valores
            </h1>
            <p className="mt-0.5 max-w-xl text-sm text-zinc-500 dark:text-zinc-400 lg:text-[15px]">
              Preços, máxima histórica e gráficos. Negócios só no WhatsApp.
            </p>
          </div>
          <ThemeToggle variant="secondary" />
        </div>
      </header>

      <main className="px-4 py-5 lg:px-8 lg:py-6">
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

      <footer className="border-t border-zinc-200 px-4 py-5 text-center text-[11px] text-zinc-400 dark:border-[#2d2d2d] dark:text-zinc-500 lg:px-8">
        Somente leitura · ordens com{" "}
        <code className="text-zinc-500 dark:text-zinc-400">/bolsa</code> e{" "}
        <code className="text-zinc-500 dark:text-zinc-400">/carteira</code> no
        WhatsApp
      </footer>
    </div>
  );
}
