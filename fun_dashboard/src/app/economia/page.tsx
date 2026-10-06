"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, AlertCircle, RefreshCw } from "lucide-react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { MonetaryHealthBadge } from "@/components/economia/MonetaryHealthBadge";
import { GiniMeter } from "@/components/economia/GiniMeter";
import { WealthDistributionView } from "@/components/economia/WealthDistributionView";
import { RegulatorKnobsView } from "@/components/economia/RegulatorKnobsView";
import { InterventionPanel } from "@/components/economia/InterventionPanel";
import { Button } from "@/components/ui/button";
import { funApi } from "@/lib/api";
import type { EconomyMetrics } from "@/lib/types";

export default function EconomiaPage() {
  const { scope, groups } = useDashboardScope();
  const [data, setData] = useState<EconomyMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    if (!scope) {
      setData(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await funApi.economyMetrics(scope);
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Falha ao carregar métricas econômicas do grupo."
      );
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const currentGroupName = groups.find((g) => g.jid === scope)?.name || data?.groupName;

  return (
    <AppShell
      title="Gestão de Economia & Inflação"
      subtitle="Controle monetário, distribuição de riqueza e intervenção do Regulador Invisível"
      onRefresh={() => void loadMetrics()}
      refreshing={loading}
      status={error}
    >
      {!scope ? (
        <div className="mx-auto flex max-w-md flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-400 dark:bg-zinc-800 dark:text-zinc-500">
            <Coins className="h-6 w-6" aria-hidden="true" />
          </div>
          <h3 className="mt-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Nenhum grupo selecionado
          </h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Selecione um grupo no seletor acima para visualizar e gerenciar a economia local.
          </p>
        </div>
      ) : error && !data ? (
        <div className="mx-auto flex max-w-lg flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-950/30">
          <AlertCircle className="h-8 w-8 text-red-600 dark:text-red-400" aria-hidden="true" />
          <h3 className="mt-2 text-sm font-semibold text-red-900 dark:text-red-200">
            Erro ao carregar dados econômicos
          </h3>
          <p className="mt-1 text-xs text-red-700 dark:text-red-300">{error}</p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void loadMetrics()}
            className="mt-4 gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </Button>
        </div>
      ) : loading && !data ? (
        <div className="mx-auto flex max-w-6xl flex-col gap-6 animate-pulse">
          <div className="h-40 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-20 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-64 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
          </div>
          <div className="h-80 rounded-xl bg-zinc-200 dark:bg-zinc-800" />
        </div>
      ) : data ? (
        <div className="mx-auto flex max-w-6xl flex-col gap-6">
          {/* Indicador e Badge de Saúde Monetária + KPIs */}
          <MonetaryHealthBadge metrics={data} />

          {/* Grid de Desigualdade: Coeficiente de Gini + Distribuição de Riqueza */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <GiniMeter
              gini={data.gini}
              activePlayers={data.economicPlayers ?? data.activePlayers}
              totalMembers={data.totalMembers}
              passiveMembers={data.passiveMembers}
            />
            <WealthDistributionView
              distribution={data.wealthDistribution}
              totalCoins={data.circulatingCoins}
              economicPlayers={data.economicPlayers ?? data.activePlayers}
              passiveMembers={data.passiveMembers}
            />
          </div>

          {/* Visualizador de Knobs do Regulador Invisível */}
          <RegulatorKnobsView regulator={data.regulator} />

          {/* Painel de Intervenção Monetária */}
          <InterventionPanel
            scope={scope}
            groupName={currentGroupName}
            currentJackpot={data.jackpot}
            currentBaseline={data.baselineCoins}
            currentCirculating={data.circulatingCoins}
            currentKnobs={data.regulator}
            onSuccess={() => void loadMetrics()}
          />
        </div>
      ) : null}
    </AppShell>
  );
}
