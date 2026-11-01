import React from "react";
import {
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Flame,
  Scale,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
  CircleDollarSign,
  PiggyBank,
  Users,
  UserCheck,
  Info,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatCoins, formatNumber, formatPctGrouped } from "@/lib/format";
import type { EconomyMetrics } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  metrics: EconomyMetrics;
};

export function MonetaryHealthBadge({ metrics }: Props) {
  const {
    inflationState,
    inflationLabel,
    circulatingCoins,
    baselineCoins,
    mintSink24h,
    jackpot,
    factionsVaultTotal,
    factionsCount,
    investedValue,
    activePlayers,
    totalMembers,
    economicPlayers,
    passiveMembers,
    participationRate,
  } = metrics;

  // Fallback para payloads antigos sem os novos campos de participação
  const economicCount = economicPlayers ?? activePlayers;
  const total = totalMembers ?? economicCount;
  const passive = passiveMembers ?? Math.max(0, total - economicCount);
  const rate = participationRate ?? (total > 0 ? economicCount / total : 1);
  // Payload antigo (sem totalMembers) não permite distinguir passivos:
  // o banner informa apenas os jogadores econômicos, sem taxa enganosa.
  const hasParticipationData = totalMembers !== undefined;

  // Cálculo da variação em relação ao baseline
  const baselineDiffPct = baselineCoins > 0
    ? ((circulatingCoins - baselineCoins) / baselineCoins) * 100
    : 0;

  // Configuração visual por estado de inflação
  const stateConfig = {
    stable: {
      tone: "success" as const,
      border: "border-emerald-500/30 dark:border-emerald-500/20",
      bg: "bg-emerald-50/50 dark:bg-emerald-950/20",
      glow: "text-emerald-600 dark:text-emerald-400",
      icon: CheckCircle2,
      title: "Economia Estável",
      description:
        "A base monetária está em equilíbrio saudável com o baseline do grupo. O fluxo de moedas emitidas e recolhidas está sustentável.",
    },
    inflationary: {
      tone: "warn" as const,
      border: "border-amber-500/40 dark:border-amber-500/30",
      bg: "bg-amber-50/50 dark:bg-amber-950/20",
      glow: "text-amber-600 dark:text-amber-400",
      icon: TrendingUp,
      title: "Pressão Inflacionária",
      description:
        "Crescimento acelerado da moeda em circulação (+25% acima do baseline ou emissão líquida excessiva). O Regulador está comprimindo recompensas.",
    },
    deflationary: {
      tone: "neutral" as const,
      border: "border-sky-500/40 dark:border-sky-500/30",
      bg: "bg-sky-50/50 dark:bg-sky-950/20",
      glow: "text-sky-600 dark:text-sky-400",
      icon: TrendingDown,
      title: "Deflação / Escassez",
      description:
        "Redução severa de moedas em circulação (-25% abaixo do baseline). Risco de estagnação de apostas e trocas no grupo.",
    },
    high_inequality: {
      tone: "warn" as const,
      border: "border-purple-500/40 dark:border-purple-500/30",
      bg: "bg-purple-50/50 dark:bg-purple-950/20",
      glow: "text-purple-600 dark:text-purple-400",
      icon: Scale,
      title: "Alta Desigualdade",
      description:
        "O índice de Gini ultrapassou 0.58. Grande concentração de moedas nas mãos de poucos jogadores. O regulador ativará eventos compensatórios.",
    },
    hyperinflation: {
      tone: "danger" as const,
      border: "border-red-500/50 dark:border-red-500/30",
      bg: "bg-red-50/60 dark:bg-red-950/30",
      glow: "text-red-600 dark:text-red-400",
      icon: Flame,
      title: "Hiperinflação Crítica",
      description:
        "A moeda em circulação ultrapassou o dobro do baseline. Recomenda-se queima de moedas pelo Jackpot ou elevação emergencial de sinks!",
    },
  }[inflationState] || {
    tone: "neutral" as const,
    border: "border-zinc-200 dark:border-zinc-800",
    bg: "bg-white dark:bg-zinc-900",
    glow: "text-zinc-600 dark:text-zinc-400",
    icon: CircleDollarSign,
    title: inflationLabel,
    description: "Status monetário do grupo.",
  };

  const StateIcon = stateConfig.icon;

  return (
    <div className="flex flex-col gap-4">
      {/* Banner Principal de Saúde */}
      <div
        className={cn(
          "rounded-xl border p-5 transition-colors shadow-sm",
          stateConfig.border,
          stateConfig.bg
        )}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:ring-zinc-100/10",
                stateConfig.glow
              )}
            >
              <StateIcon className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-50">
                  {stateConfig.title}
                </h2>
                <Badge tone={stateConfig.tone} className="text-xs font-semibold uppercase tracking-wider">
                  {inflationLabel}
                </Badge>
                <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                  Baseline: {formatCoins(baselineCoins)}
                </span>
              </div>
              <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300 max-w-3xl">
                {stateConfig.description}
              </p>
              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400 border-l-2 border-zinc-300 dark:border-zinc-700 pl-2">
                <Info className="mr-1 inline h-3 w-3 align-[-2px]" aria-hidden="true" />
                Índices calculados apenas sobre os <strong className="text-zinc-700 dark:text-zinc-300">
                {formatNumber(economicCount)} jogadores ativos na economia</strong> (saldo {">"} 0).
                Membros passivos com saldo zero são filtrados para não distorcer o diagnóstico.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2 sm:flex-col sm:items-end">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">Desvio do Baseline</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-semibold tabular-nums",
                baselineDiffPct > 20
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                  : baselineDiffPct < -20
                  ? "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              )}
            >
              {baselineDiffPct >= 0 ? (
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ArrowDownRight className="h-4 w-4" aria-hidden="true" />
              )}
              {formatPctGrouped(baselineDiffPct)}
            </span>
          </div>
        </div>
      </div>

      {/* Banner de Participação Econômica */}
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
              !hasParticipationData
                ? "bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500"
                : rate >= 0.5
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400"
                : rate >= 0.2
                ? "bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400"
                : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
            )}
          >
            <UserCheck className="h-[18px] w-[18px]" aria-hidden="true" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Participação Econômica
            </div>
            {hasParticipationData ? (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                <strong className="text-zinc-900 dark:text-zinc-100">
                  {formatNumber(economicCount)} jogadores no RPG
                </strong>{" "}
                ({(rate * 100).toFixed(1)}% dos {formatNumber(total)} membros do grupo) ·{" "}
                {formatNumber(passive)} membros apenas no chat (saldo 0)
              </p>
            ) : (
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                <strong className="text-zinc-900 dark:text-zinc-100">
                  {formatNumber(economicCount)} jogadores ativos na economia
                </strong>{" "}
                (saldo {">"} 0). Dados de participação total indisponíveis — atualize o backend
                para ver a taxa de membros passivos.
              </p>
            )}
          </div>
        </div>

        {/* Barra visual da taxa de participação */}
        {hasParticipationData ? (
          <div className="flex items-center gap-2.5 min-w-[160px]">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  rate >= 0.5
                    ? "bg-emerald-500"
                    : rate >= 0.2
                    ? "bg-amber-500"
                    : "bg-zinc-400 dark:bg-zinc-500"
                )}
                style={{ width: `${Math.min(100, Math.max(0, rate * 100))}%` }}
              />
            </div>
            <span className="text-xs font-bold text-zinc-900 tabular-nums dark:text-zinc-50">
              {(rate * 100).toFixed(1)}%
            </span>
          </div>
        ) : null}
      </div>

      {/* Grid de Métricas Monetárias Chave */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {/* Circulação */}
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Coins className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            <span>Circulação Total</span>
          </div>
          <div className="mt-1.5 text-xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatCoins(circulatingCoins)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
            {formatNumber(activePlayers)} players com saldo
          </div>
        </div>

        {/* Emissão Líquida 24h */}
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <CircleDollarSign className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            <span>Fluxo Líquido (24h)</span>
          </div>
          <div
            className={cn(
              "mt-1.5 text-xl font-bold tracking-tight tabular-nums",
              mintSink24h.net > 0
                ? "text-amber-600 dark:text-amber-400"
                : mintSink24h.net < 0
                ? "text-sky-600 dark:text-sky-400"
                : "text-zinc-900 dark:text-zinc-50"
            )}
          >
            {mintSink24h.net > 0 ? `+${formatCoins(mintSink24h.net)}` : formatCoins(mintSink24h.net)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
            +{formatCoins(mintSink24h.minted)} / -{formatCoins(mintSink24h.sunk)}
          </div>
        </div>

        {/* Jackpot Cassino */}
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <PiggyBank className="h-3.5 w-3.5 text-indigo-500" aria-hidden="true" />
            <span>Jackpot do Cassino</span>
          </div>
          <div className="mt-1.5 text-xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatCoins(jackpot)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
            Pote acumulado
          </div>
        </div>

        {/* Cofres de Facções */}
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Users className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
            <span>Cofres de Facções</span>
          </div>
          <div className="mt-1.5 text-xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatCoins(factionsVaultTotal)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
            {factionsCount} {factionsCount === 1 ? "facção" : "facções"} ativas
          </div>
        </div>

        {/* Volume de Mercado */}
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <TrendingUp className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
            <span>Valor Investido</span>
          </div>
          <div className="mt-1.5 text-xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatCoins(investedValue)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
            Itens & inventários
          </div>
        </div>

        {/* Membros do Grupo */}
        <div className="rounded-lg border border-zinc-200 bg-white p-3.5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Users className="h-3.5 w-3.5 text-teal-500" aria-hidden="true" />
            <span>Membros do Grupo</span>
          </div>
          <div className="mt-1.5 text-xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatNumber(total)}
          </div>
          <div className="mt-0.5 text-[11px] text-zinc-600 dark:text-zinc-500">
            {formatNumber(passive)} apenas no chat
          </div>
        </div>
      </div>
    </div>
  );
}
