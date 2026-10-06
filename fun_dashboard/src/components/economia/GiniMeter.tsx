import React from "react";
import { Scale, Info, Sparkles, UserCheck } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

type Props = {
  gini: number;
  activePlayers: number;
  totalMembers?: number;
  passiveMembers?: number;
};

export function GiniMeter({ gini, activePlayers, totalMembers, passiveMembers }: Props) {
  const clampedGini = Math.max(0, Math.min(1, Number(gini) || 0));
  const percentage = (clampedGini * 100).toFixed(1);

  // Classificação do Gini
  const getClassification = (val: number) => {
    if (val < 0.3) {
      return {
        label: "Igualitário",
        tone: "success" as const,
        color: "text-emerald-600 dark:text-emerald-400",
        badgeColor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
        interpretation:
          "Riqueza distribuída de maneira uniforme. Pouca disparidade entre os maiores apostadores e a base de novos jogadores.",
        regulatorAction: "Regulador em repouso quanto a desigualdade.",
      };
    }
    if (val <= 0.45) {
      return {
        label: "Equilíbrio Saudável",
        tone: "success" as const,
        color: "text-sky-600 dark:text-sky-400",
        badgeColor: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
        interpretation:
          "Faixa ideal para o ecossistema do bot. Há incentivo meritocrático para jogar e apostar sem asfixiar a economia da base.",
        regulatorAction: "Parâmetros normais de recompensas e assaltos.",
      };
    }
    if (val <= 0.58) {
      return {
        label: "Concentração Moderada",
        tone: "warn" as const,
        color: "text-amber-600 dark:text-amber-400",
        badgeColor: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
        interpretation:
          "Veteranos e magnatas do cassino concentram uma fatia expressiva das moedas. Jogadores novos podem sentir mais lentidão na progressão.",
        regulatorAction: "O regulador prepara sementes de incentivo à liquidez.",
      };
    }
    if (val <= 0.7) {
      return {
        label: "Alta Concentração",
        tone: "warn" as const,
        color: "text-orange-600 dark:text-orange-400",
        badgeColor: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
        interpretation:
          "Desigualdade acentuada. Mais de 70% das moedas podem estar nas mãos do Top 10%. A classe média do bot está empobrecida.",
        regulatorAction:
          "Regulador ativo: ativando semente 'blitz_luxury' para drenar moedas do topo e amplificando bônus da base.",
      };
    }
    return {
      label: "Desigualdade Extrema",
      tone: "danger" as const,
      color: "text-red-600 dark:text-red-400",
      badgeColor: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
      interpretation:
        "Oligopólio financeiro: quase todas as moedas pertencem a 1 ou 2 jogadores/facções. Risco alto de desengajamento da maioria dos membros.",
      regulatorAction:
        "Intervenção de emergência: eventos de caos, assaltos facilitados e queima de estoques de luxo recomendados.",
    };
  };

  const status = getClassification(clampedGini);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm flex flex-col gap-5">
      {/* Header do Card */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            <Scale className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Coeficiente de Gini
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Métrica de concentração de riqueza (0.000 a 1.000) calculada sobre{" "}
              <strong className="text-zinc-700 dark:text-zinc-300">
                {formatNumber(activePlayers)} jogadores ativos na economia
              </strong>
              {typeof passiveMembers === "number" && passiveMembers > 0
                ? ` (ignorando ${formatNumber(passiveMembers)} membros passivos com saldo 0)`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <span className="text-2xl font-black tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {clampedGini.toFixed(3)}
          </span>
          <span
            className={cn(
              "rounded-md px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider",
              status.badgeColor
            )}
          >
            {status.label}
          </span>
        </div>
      </div>

      {/* Régua Visual do Gini */}
      <div className="flex flex-col gap-2 pt-2">
        <div className="relative">
          {/* Marcador / Ponteiro do Valor Atual */}
          <div
            className="absolute -top-7 -translate-x-1/2 flex flex-col items-center transition-all duration-500 z-10"
            style={{ left: `${percentage}%` }}
          >
            <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-bold text-zinc-50 shadow-md dark:bg-zinc-100 dark:text-zinc-900 tabular-nums">
              {clampedGini.toFixed(3)}
            </span>
            <div className="h-1.5 w-1.5 rotate-45 bg-zinc-900 dark:bg-zinc-100 -mt-0.5" />
          </div>

          {/* Barra Graduada em Faixas */}
          <div className="h-3.5 w-full overflow-hidden rounded-full flex shadow-inner bg-zinc-100 dark:bg-zinc-800 p-0.5">
            {/* 0.0 - 0.3 Igualitário */}
            <div
              className="h-full bg-emerald-500 rounded-l-full"
              style={{ width: "30%" }}
              title="0.0 a 0.3 - Igualitário"
            />
            {/* 0.3 - 0.45 Saudável */}
            <div
              className="h-full bg-sky-500"
              style={{ width: "15%" }}
              title="0.30 a 0.45 - Equilíbrio Saudável"
            />
            {/* 0.45 - 0.58 Moderado */}
            <div
              className="h-full bg-amber-500"
              style={{ width: "13%" }}
              title="0.45 a 0.58 - Concentração Moderada"
            />
            {/* 0.58 - 0.70 Alta Desigualdade */}
            <div
              className="h-full bg-orange-500"
              style={{ width: "12%" }}
              title="0.58 a 0.70 - Alta Concentração"
            />
            {/* 0.70 - 1.00 Extrema */}
            <div
              className="h-full bg-red-600 rounded-r-full"
              style={{ width: "30%" }}
              title="0.70 a 1.00 - Desigualdade Extrema"
            />
          </div>
        </div>

        {/* Legenda de Escala da Régua */}
        <div className="flex justify-between text-[11px] text-zinc-400 dark:text-zinc-500 px-0.5 pt-1">
          <span>0.0 (Igualdade)</span>
          <span className="hidden sm:inline">0.3 (Saudável)</span>
          <span className="font-semibold text-amber-500">0.58 (Ação do Regulador)</span>
          <span className="hidden sm:inline">0.7 (Crítico)</span>
          <span>1.0 (Monopólio)</span>
        </div>
      </div>

      {/* Caixa Explicativa Amigável */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/50 flex flex-col gap-2.5">
        <div className="flex items-start gap-2.5">
          <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Escopo do cálculo:{" "}
            </span>
            O índice considera apenas os{" "}
            <strong className="text-zinc-900 dark:text-zinc-100">
              {formatNumber(activePlayers)} jogadores com saldo positivo
            </strong>{" "}
            na economia do grupo
            {typeof totalMembers === "number" && totalMembers > activePlayers
              ? `, de um total de ${formatNumber(totalMembers)} membros. Os ${formatNumber(
                  totalMembers - activePlayers
                )} membros que só conversam (saldo 0) são filtrados para não inflar artificialmente o Gini.`
              : ". Todos os membros com conta participam da economia."}
          </div>
        </div>

        <div className="flex items-start gap-2.5">
          <Info className="h-4 w-4 text-zinc-500 dark:text-zinc-400 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Diagnóstico Atual:{" "}
            </span>
            {status.interpretation}
          </div>
        </div>

        <div className="flex items-start gap-2.5 border-t border-zinc-200/60 pt-2.5 dark:border-zinc-800/60">
          <Sparkles className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" aria-hidden="true" />
          <div className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">
              Ação do Regulador Invisível:{" "}
            </span>
            {status.regulatorAction}
          </div>
        </div>
      </div>
    </div>
  );
}
