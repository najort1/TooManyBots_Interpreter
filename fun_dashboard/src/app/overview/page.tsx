"use client";

import { useCallback, useEffect, useState } from "react";
import { Swords, ExternalLink } from "lucide-react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { RankingTable } from "@/components/ranking/RankingTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SpawnGameModal } from "@/components/games/SpawnGameModal";
import { funApi } from "@/lib/api";
import { formatEndsIn, formatNumber } from "@/lib/format";
import type { ActiveGameResult, Overview } from "@/lib/types";

function OverviewBody() {
  const { scope, groups } = useDashboardScope();
  const [data, setData] = useState<Overview | null>(null);
  const [activeGameData, setActiveGameData] = useState<ActiveGameResult | null>(null);
  const [spawnModalOpen, setSpawnModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!scope) {
      setData(null);
      setActiveGameData(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [overviewData, gameData] = await Promise.all([
        funApi.overview(scope),
        funApi.activeGame(scope).catch(() => null),
      ]);
      setData(overviewData);
      setActiveGameData(gameData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell
      title="Visão"
      subtitle="Métricas do grupo selecionado"
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      {!scope ? (
        <EmptyApi />
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
          <MetricStrip
            items={[
              { label: "Jogadores", value: data?.players ?? 0 },
              { label: "Grupos", value: data?.groups ?? 0 },
              { label: "Jackpot", value: data?.jackpot ?? 0 },
              { label: "Facções", value: data?.factions ?? 0 },
            ]}
          />

          {/* Banner de Ação de Jogos de Panelinha */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
                <Swords className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    Jogos de Panelinha contra Panelinha
                  </h2>
                  {activeGameData?.active && activeGameData.room ? (
                    <Badge tone="success" className="animate-pulse">
                      Partida Ativa
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Nenhuma partida ativa</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
                  {activeGameData?.active && activeGameData.room
                    ? `${activeGameData.room.emoji} ${activeGameData.room.title} · Status: ${
                        activeGameData.room.status === "waiting"
                          ? "Aguardando início"
                          : "Em andamento"
                      } · Prêmio: ${activeGameData.room.prize} coins`
                    : "Inicie manualmente uma partida multiplayer (Quiz Royale, Grande Golpe ou Rei das Colinas) no grupo."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {activeGameData?.active && activeGameData.gameLink ? (
                <a
                  href={activeGameData.gameLink}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-emerald-500 dark:bg-emerald-500 dark:hover:bg-emerald-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Entrar na Sala Ativa
                </a>
              ) : null}

              <Button
                variant={activeGameData?.active ? "secondary" : "primary"}
                size="sm"
                onClick={() => setSpawnModalOpen(true)}
                className="gap-1.5"
              >
                <Swords className="h-4 w-4" />
                {activeGameData?.active ? "Novo Jogo / Forçar" : "Spawnar Jogo de Panelinha"}
              </Button>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <section className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 lg:col-span-1">
              <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Status</h2>
              <div className="mt-3 space-y-2 text-sm">
                <Row
                  label="Evento"
                  value={
                    data?.event?.active
                      ? `${data.event.eventType} · ${formatEndsIn(data.event.endsAt)}`
                      : "nenhum ativo"
                  }
                />
                <Row
                  label="Envios (1 min)"
                  value={
                    data?.outbound
                      ? `${data.outbound.globalLastMinute}/${data.outbound.maxPerMinute ?? "—"}`
                      : "—"
                  }
                />
                <Row
                  label="Envios (1 h)"
                  value={
                    data?.outbound
                      ? `${data.outbound.globalLastHour}/${data.outbound.maxPerHour ?? "—"}`
                      : "—"
                  }
                />
                <Row
                  label="Drops guard"
                  value={formatNumber(data?.outbound?.dropped ?? 0)}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-1.5">
                <Badge tone={data?.features.zen ? "success" : "neutral"}>
                  Zen {data?.features.zen ? "on" : "off"}
                </Badge>
                <Badge tone={data?.features.ollama ? "success" : "neutral"}>
                  Ollama {data?.features.ollama ? "on" : "off"}
                </Badge>
                <Badge tone={data?.features.tarot ? "ink" : "neutral"}>
                  Tarot {data?.features.tarot ? "on" : "off"}
                </Badge>
                <Badge tone="neutral">
                  {data?.features.privateReplies ? "Cmd no PV" : "Cmd no grupo"}
                </Badge>
              </div>
            </section>

            <section className="lg:col-span-1">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Top XP</h2>
              <RankingTable entries={data?.topXp || []} kind="xp" empty="Sem XP ainda." />
            </section>

            <section className="lg:col-span-1">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Top coins</h2>
              <RankingTable
                entries={data?.topCoins || []}
                kind="coins"
                empty="Sem coins ainda."
              />
            </section>
          </div>

          <SpawnGameModal
            open={spawnModalOpen}
            onClose={() => setSpawnModalOpen(false)}
            groups={groups}
            currentScope={scope}
            onSuccess={() => {
              void load();
            }}
          />
        </div>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 dark:border-zinc-800 py-1.5 last:border-0">
      <span className="text-zinc-500">{label}</span>
      <span className="text-right font-medium text-zinc-900 dark:text-zinc-50">{value}</span>
    </div>
  );
}

function EmptyApi() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-6 py-12 text-center">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Sem grupo</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Suba o bot Fun e garanta a whitelist. API em{" "}
        <code className="text-xs">127.0.0.1:8790</code>.
      </p>
    </div>
  );
}

export default function OverviewPage() {
  return <OverviewBody />;
}
