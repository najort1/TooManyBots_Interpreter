import React from "react";
import { Crown, Users, Award, PieChart } from "lucide-react";
import { formatCoins, formatNumber } from "@/lib/format";
import type { WealthDistribution } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  distribution: WealthDistribution;
  totalCoins: number;
  economicPlayers?: number;
  passiveMembers?: number;
};

export function WealthDistributionView({
  distribution,
  totalCoins,
  economicPlayers,
  passiveMembers,
}: Props) {
  const { top1Percent, top10Percent, bottom50Percent, brackets } = distribution;

  // Cores por bracket
  const bracketColors: Record<string, { bar: string; badge: string; text: string }> = {
    "Top 1%": {
      bar: "bg-amber-500",
      badge: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
      text: "text-amber-600 dark:text-amber-400",
    },
    "Top 2-10%": {
      bar: "bg-purple-500",
      badge: "bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300",
      text: "text-purple-600 dark:text-purple-400",
    },
    "Intermediário (10-50%)": {
      bar: "bg-sky-500",
      badge: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
      text: "text-sky-600 dark:text-sky-400",
    },
    "Base 50%": {
      bar: "bg-emerald-500",
      badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
      text: "text-emerald-600 dark:text-emerald-400",
    },
  };

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            <PieChart className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Distribuição de Riqueza por Faixas
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Concentração patrimonial entre as camadas de jogadores da economia
              {typeof economicPlayers === "number"
                ? ` (${formatNumber(economicPlayers)} jogadores ativos com saldo`
                : ""}
              {typeof passiveMembers === "number" && passiveMembers > 0
                ? ` · ${formatNumber(passiveMembers)} membros passivos filtrados)`
                : typeof economicPlayers === "number"
                ? ")"
                : ""}
            </p>
          </div>
        </div>
      </div>

      {/* 3 Cartões de Destaque (Top 1%, Top 10%, Base 50%) */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Top 1% */}
        <div className="rounded-lg border border-amber-200/80 bg-amber-50/40 p-4 dark:border-amber-900/40 dark:bg-amber-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
              <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              Top 1% (Elite)
            </span>
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 tabular-nums">
              {top1Percent.toFixed(1)}% do total
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-amber-200/60 dark:bg-amber-900/50">
            <div
              className="h-full bg-amber-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, top1Percent))}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Concentrado nos maiores vencedores e magnatas do grupo.
          </div>
        </div>

        {/* Top 10% */}
        <div className="rounded-lg border border-purple-200/80 bg-purple-50/40 p-4 dark:border-purple-900/40 dark:bg-purple-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple-900 dark:text-purple-200 flex items-center gap-1.5">
              <Award className="h-4 w-4 text-purple-600 dark:text-purple-400" aria-hidden="true" />
              Top 10% (Mais Ricos)
            </span>
            <span className="text-xs font-bold text-purple-700 dark:text-purple-400 tabular-nums">
              {top10Percent.toFixed(1)}% do total
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-purple-200/60 dark:bg-purple-900/50">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, top10Percent))}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Jogadores ativos de alto volume e líderes de facção.
          </div>
        </div>

        {/* Base 50% */}
        <div className="rounded-lg border border-emerald-200/80 bg-emerald-50/40 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
              <Users className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Base 50% (Metade Inferior)
            </span>
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400 tabular-nums">
              {bottom50Percent.toFixed(1)}% do total
            </span>
          </div>
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-emerald-200/60 dark:bg-emerald-900/50">
            <div
              className="h-full bg-emerald-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, Math.max(0, bottom50Percent))}%` }}
            />
          </div>
          <div className="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
            Metade mais pobre <strong className="text-zinc-700 dark:text-zinc-300">dos jogadores ativos</strong> (saldo {">"} 0). Membros passivos não entram na conta.
          </div>
        </div>
      </div>

      {/* Barra Empilhada Proporcional */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
          <span>Distribuição Contínua do Total em Circulação</span>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {formatCoins(totalCoins)}
          </span>
        </div>
        <div className="h-4 w-full overflow-hidden rounded-full flex bg-zinc-100 dark:bg-zinc-800 p-0.5 gap-0.5">
          {brackets.map((b) => {
            const colors = bracketColors[b.bracket] || {
              bar: "bg-zinc-500",
              badge: "",
              text: "",
            };
            const safePct = Number.isFinite(b.percentage) ? Math.max(0, b.percentage) : 0;
            if (safePct <= 0) return null;
            return (
              <div
                key={b.bracket}
                className={cn("h-full rounded-sm transition-all duration-500", colors.bar)}
                style={{ width: `${Math.max(2, safePct)}%` }}
                title={`${b.bracket}: ${safePct.toFixed(1)}% (${formatCoins(b.totalCoins)})`}
              />
            );
          })}
        </div>
      </div>

      {/* Tabela Detalhada por Brackets */}
      <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800/60 dark:text-zinc-400 border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="px-4 py-2.5 font-medium">Camada / Faixa</th>
              <th className="px-4 py-2.5 font-medium text-right">Jogadores</th>
              <th className="px-4 py-2.5 font-medium text-right">Total Acumulado</th>
              <th className="px-4 py-2.5 font-medium text-right">% do Todo</th>
              <th className="px-4 py-2.5 font-medium text-center">Proporção Visual</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 bg-white dark:bg-zinc-900">
            {brackets.map((b) => {
              const colors = bracketColors[b.bracket] || {
                bar: "bg-zinc-500",
                badge: "bg-zinc-100 text-zinc-800",
                text: "text-zinc-600",
              };
              return (
                <tr key={b.bracket} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/40">
                  <td className="px-4 py-3 font-semibold text-zinc-900 dark:text-zinc-100">
                    <span className="flex items-center gap-2">
                      <span className={cn("h-2.5 w-2.5 rounded-full", colors.bar)} />
                      {b.bracket}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300 tabular-nums">
                    {formatNumber(b.players)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-900 dark:text-zinc-100 tabular-nums">
                    {formatCoins(b.totalCoins)}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-zinc-900 dark:text-zinc-50 tabular-nums">
                    {b.percentage.toFixed(1)}%
                  </td>
                  <td className="px-4 py-3">
                    <div className="mx-auto h-2 max-w-[140px] w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", colors.bar)}
                        style={{ width: `${Math.min(100, Math.max(0, b.percentage))}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
