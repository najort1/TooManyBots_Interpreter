"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Swords,
  ExternalLink,
  Activity,
  Coins,
  ArrowRight,
} from "lucide-react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { RankingTable } from "@/components/ranking/RankingTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
      ) : (
        <div className="mx-auto flex max-w-5xl flex-col gap-5">
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
            <section className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      <Activity className="h-4 w-4" aria-hidden />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        Status Operacional
                      </h2>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        WhatsApp e vazão de saída
                      </p>
                    </div>
                  </div>
                  <div>
                    {botStatus?.socketReady ? (
                      <Badge tone="success" className="gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        Conectado
                      </Badge>
                    ) : (
                      <Badge tone="danger" className="gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                        Desconectado
                      </Badge>
                    )}
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-sm">
                  <Row
                    label="Uptime do bot"
                    value={
                      botStatus?.uptimeSeconds != null
                        ? formatUptime(botStatus.uptimeSeconds)
                        : "—"
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
                    label="Bloqueios guard (drops)"
                    value={formatNumber(data?.outbound?.dropped ?? 0)}
                  />
                  <Row
                    label="Evento em andamento"
                    value={
                      data?.event?.active
                        ? `${data.event.eventType} (${data.event.multiplier}x) · ${formatEndsIn(data.event.endsAt)}`
                        : "Nenhum ativo"
                    }
                  />
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
                  <Badge tone={data?.features.tarot ? "ink" : "neutral"}>
                    Tarot {data?.features.tarot ? "on" : "off"}
                  </Badge>
                  <Badge tone="neutral">
                    {data?.features.privateReplies ? "Cmd no PV" : "Cmd no grupo"}
                  </Badge>
                </div>
              </div>
            </section>

            {/* Card de Saúde da Economia */}
            <section className="flex flex-col justify-between rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div>
                <div className="flex items-center justify-between gap-2 border-b border-zinc-100 pb-3 dark:border-zinc-800">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      <Coins className="h-4 w-4" aria-hidden />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                        Saúde da Economia
                      </h2>
                      <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                        Concentração monetária e estabilidade
                      </p>
                    </div>
                  </div>
                  <div>
                    <Badge tone={getEconomyBadgeTone(economy?.healthStatus)}>
                      {economy?.healthLabel || "Estável"}
                    </Badge>
                  </div>
                </div>

                <div className="mt-3 space-y-1.5 text-sm">
                  <Row
                    label="Total em circulação"
                    value={formatCoins(economy?.circulatingCoins ?? 0)}
                  />
                  <Row
                    label="Âncora monetária (base)"
                    value={formatCoins(economy?.baselineCoins ?? 0)}
                  />
                  <Row
                    label="Índice Gini"
                    value={
                      economy?.gini != null ? Number(economy.gini).toFixed(3) : "0.000"
                    }
                  />

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

                  <Row
                    label="Jogadores no grupo"
                    value={`${formatNumber(data?.players ?? 0)} registrados`}
                  />
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
            </section>
          </div>

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-100 py-1.5 last:border-0 dark:border-zinc-800">
      <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="text-right font-medium text-zinc-900 dark:text-zinc-50">{value}</span>
    </div>
  );
}

function EmptyApi() {
  return (
    <div className="mx-auto max-w-lg rounded-lg border border-dashed border-zinc-200 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Sem grupo selecionado</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Suba o bot Fun e garanta a whitelist para visualizar o dashboard executivo.
      </p>
    </div>
  );
}

export default function OverviewPage() {
  return <OverviewBody />;
}
