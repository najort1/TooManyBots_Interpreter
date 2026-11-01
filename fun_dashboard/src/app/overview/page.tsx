"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Swords,
  ExternalLink,
  Activity,
  Coins,
  ArrowRight,
  Users,
} from "lucide-react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { RankingTable } from "@/components/ranking/RankingTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, ErrorCard } from "@/components/ui/states";
import { KeyValue } from "@/components/ui/kv";
import { Skeleton } from "@/components/ui/skeleton";
import { SpawnGameModal } from "@/components/games/SpawnGameModal";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { funApi } from "@/lib/api";
import {
  formatCoins,
  formatEndsIn,
  formatNumber,
  formatUptime,
} from "@/lib/format";
import { cn } from "@/lib/cn";
import type { ActiveGameResult, Overview } from "@/lib/types";

function getEconomyBadgeTone(
  status?: string
): "success" | "warn" | "danger" | "neutral" {
  switch (status) {
    case "stable":
      return "success";
    case "inflationary":
    case "deflationary":
      return "warn";
    case "high_inequality":
      return "danger";
    default:
      return "neutral";
  }
}

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

  const economy = data?.economy;
  const activity = data?.activity;
  const botStatus = data?.botStatus;
  const giniValue = economy?.gini != null ? Number(economy.gini) : 0;

  return (
    <AppShell
      title="Visão Geral"
      subtitle="Métricas executivas e operacionais do grupo"
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      {!scope ? (
        <EmptyApi />
      ) : error && !data ? (
        <ErrorCard message={error} onRetry={() => void load()} />
      ) : loading && !data ? (
        <OverviewSkeleton />
      ) : (
        <div className="flex flex-col gap-5">
          {/* Métricas Executivas no Topo */}
          <MetricStrip
            items={[
              {
                label: "Jogadores Registrados",
                value: data?.players ?? 0,
                hint: `${data?.groups ?? 0} grupos no sistema`,
              },
              {
                label: "Ativos (24h)",
                value: activity?.activePlayers24h ?? 0,
                hint: "Com atividade recente",
              },
              {
                label: "Moedas em Circulação",
                value: formatCoins(economy?.circulatingCoins ?? 0),
                hint: `Âncora: ${formatNumber(economy?.baselineCoins ?? 0)}c`,
              },
              {
                label: "Jackpot Cassino",
                value: formatCoins(data?.jackpot ?? 0),
                hint: `${data?.factions ?? 0} facções ativas`,
              },
            ]}
          />

          {/* Cards Dedicados: Status Operacional & Economia */}
          <div className="grid gap-4 md:grid-cols-2">
            {/* Card de Status Operacional do Bot */}
            <Card className="flex flex-col justify-between p-4">
              <div>
                <CardHeader
                  className="items-center border-b border-zinc-100 pb-3 dark:border-zinc-800"
                  title={
                    <span className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        <Activity className="h-4 w-4" aria-hidden />
                      </span>
                      Status Operacional
                    </span>
                  }
                  description="WhatsApp e vazão de saída"
                  action={
                    botStatus?.socketReady ? (
                      <Badge tone="success" className="gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Conectado
                      </Badge>
                    ) : (
                      <Badge tone="danger" className="gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        Desconectado
                      </Badge>
                    )
                  }
                />

                <div className="mt-3 space-y-1.5 text-sm">
                  <KeyValue
                    label="Uptime do bot"
                  >
                    {botStatus?.uptimeSeconds != null
                      ? formatUptime(botStatus.uptimeSeconds)
                      : "—"}
                  </KeyValue>
                  <KeyValue
                    label="Envios (1 min)"
                  >
                    {data?.outbound
                      ? `${data.outbound.globalLastMinute}/${data.outbound.maxPerMinute ?? "—"}`
                      : "—"}
                  </KeyValue>
                  <KeyValue
                    label="Envios (1 h)"
                  >
                    {data?.outbound
                      ? `${data.outbound.globalLastHour}/${data.outbound.maxPerHour ?? "—"}`
                      : "—"}
                  </KeyValue>
                  <KeyValue label="Bloqueios guard (drops)">
                    {formatNumber(data?.outbound?.dropped ?? 0)}
                  </KeyValue>
                  <KeyValue label="Evento em andamento">
                    {data?.event?.active
                      ? `${data.event.eventType} (${data.event.multiplier}x) · ${formatEndsIn(data.event.endsAt)}`
                      : "Nenhum ativo"}
                  </KeyValue>
                </div>
              </div>

              <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <div className="flex flex-wrap gap-1.5">
                  <Badge tone={data?.features.zen ? "success" : "neutral"}>
                    Zen {data?.features.zen ? "on" : "off"}
                  </Badge>
                  <Badge tone={data?.features.ollama ? "success" : "neutral"}>
                    Ollama {data?.features.ollama ? "on" : "off"}
                  </Badge>
                  <Badge tone={data?.features.tarot ? "success" : "neutral"}>
                    Tarot {data?.features.tarot ? "on" : "off"}
                  </Badge>
                  <Badge tone="neutral">
                    {data?.features.privateReplies ? "Cmd no PV" : "Cmd no grupo"}
                  </Badge>
                </div>
              </div>
            </Card>

            {/* Card de Saúde da Economia */}
            <Card className="flex flex-col justify-between p-4">
              <div>
                <CardHeader
                  className="items-center border-b border-zinc-100 pb-3 dark:border-zinc-800"
                  title={
                    <span className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        <Coins className="h-4 w-4" aria-hidden />
                      </span>
                      Saúde da Economia
                    </span>
                  }
                  description="Concentração monetária e estabilidade"
                  action={
                    <Badge tone={getEconomyBadgeTone(economy?.healthStatus)}>
                      {economy?.healthLabel || "Estável"}
                    </Badge>
                  }
                />

                <div className="mt-3 space-y-1.5 text-sm">
                  <KeyValue label="Total em circulação">
                    {formatCoins(economy?.circulatingCoins ?? 0)}
                  </KeyValue>
                  <KeyValue label="Âncora monetária (base)">
                    {formatCoins(economy?.baselineCoins ?? 0)}
                  </KeyValue>
                  <KeyValue label="Índice Gini">
                    {economy?.gini != null ? Number(economy.gini).toFixed(3) : "0.000"}
                  </KeyValue>

                  {/* Barra visual de Desigualdade Gini */}
                  <div className="pt-1">
                    <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>Distribuição (0 = igual, 1 = concentrado)</span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {giniValue > 0.55
                          ? "Alta Desigualdade"
                          : giniValue > 0.35
                          ? "Moderada"
                          : "Equilibrada"}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          giniValue > 0.55
                            ? "bg-red-500"
                            : giniValue > 0.35
                            ? "bg-amber-500"
                            : "bg-emerald-500"
                        )}
                        style={{
                          width: `${Math.min(100, Math.max(0, giniValue * 100))}%`,
                        }}
                      />
                    </div>
                  </div>

                  <KeyValue label="Jogadores no grupo">
                    {`${formatNumber(data?.players ?? 0)} registrados`}
                  </KeyValue>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 text-xs dark:border-zinc-800">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {activity?.activePlayers24h ?? 0} ativos nas últimas 24h
                </span>
                <Link
                  href="/economia"
                  className="inline-flex items-center gap-1 font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                >
                  Gestão Econômica
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </Card>
          </div>

          {/* Banner de Ação de Jogos de Panelinha */}
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
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
                <Button
                  variant="primary"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    window.open(activeGameData.gameLink ?? undefined, "_blank", "noopener,noreferrer")
                  }
                >
                  <span
                    aria-hidden
                    className="mr-2 inline-block size-2 animate-pulse rounded-full bg-emerald-500"
                  />
                  <ExternalLink className="h-3.5 w-3.5" />
                  Entrar na Sala Ativa
                </Button>
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
          </Card>

          {/* Tabelas de Ranking: Top XP e Top Coins */}
          <div className="grid gap-4 md:grid-cols-2">
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Top XP</h2>
                <Link
                  href="/ranking"
                  className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  Ver ranking completo →
                </Link>
              </div>
              <RankingTable entries={data?.topXp || []} kind="xp" empty="Sem XP ainda no grupo." />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Top Coins</h2>
                <Link
                  href="/ranking"
                  className="text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
                >
                  Ver ranking completo →
                </Link>
              </div>
              <RankingTable
                entries={data?.topCoins || []}
                kind="coins"
                empty="Sem moedas registradas ainda."
              />
            </section>
          </div>

          <ErrorBoundary>
            <SpawnGameModal
              open={spawnModalOpen}
              onClose={() => setSpawnModalOpen(false)}
              groups={groups}
              currentScope={scope}
              onSuccess={() => {
                void load();
              }}
            />
          </ErrorBoundary>
        </div>
      )}
    </AppShell>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-2.5 h-7 w-20" />
            <Skeleton className="mt-2.5 h-3 w-28" />
          </Card>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-4 w-40" />
            <div className="mt-4 space-y-2.5">
              {Array.from({ length: 5 }).map((_, j) => (
                <Skeleton key={j} className="h-4 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card className="p-4">
        <Skeleton className="h-10 w-full" />
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Card className="h-40" />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyApi() {
  return (
    <div className="mx-auto max-w-lg">
      <Card className="border-dashed">
        <EmptyState
          icon={Users}
          title="Sem grupo selecionado"
          description="Suba o bot Fun e garanta a whitelist para visualizar o dashboard executivo."
        />
      </Card>
    </div>
  );
}

export default function OverviewPage() {
  return <OverviewBody />;
}
