"use client";

import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { RankingTable } from "@/components/ranking/RankingTable";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useApiQuery } from "@/hooks/useApiQuery";
import { funApi } from "@/lib/api";
import { displayPlayer, formatCoins, formatNumber } from "@/lib/format";
import type { CasinoPayload, Faction } from "@/lib/types";

function CasinoBody() {
  const { scope } = useDashboardScope();

  const { data, loading, refreshing, error, reload } = useApiQuery(
    () =>
      scope
        ? Promise.all([funApi.casino(scope, 20), funApi.factions(scope)]).then(
            ([c, f]) => ({ casino: c, factions: f.factions || [] })
          )
        : Promise.resolve(null),
    [scope]
  );

  const casino: CasinoPayload | null = data?.casino ?? null;
  const factions: Faction[] = data?.factions ?? [];
  const t = casino?.tournament;

  return (
    <AppShell
      title="Cassino"
      subtitle="Jackpot, rank e facções"
      onRefresh={() => void reload()}
      refreshing={refreshing}
      status={error?.message ?? null}
    >
      {error && !data ? (
        <ErrorCard message={error.message} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <CasinoSkeleton />
      ) : (
        <div className="flex flex-col gap-5">
          <MetricStrip
            items={[
              { label: "Jackpot", value: formatCoins(casino?.jackpot ?? 0) },
              {
                label: "Torneio pot",
                value: formatCoins(t?.pot ?? 0),
                hint: t ? `${t.players?.length || 0} na fila` : "fechado",
              },
              { label: "Facções", value: factions.length },
              {
                label: "No board",
                value: casino?.board?.length ?? 0,
              },
            ]}
          />

          <div className="grid gap-5 lg:grid-cols-5">
            <section className="lg:col-span-3">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Rank cassino
              </h2>
              <RankingTable
                entries={casino?.board || []}
                kind="casino"
                empty="Ninguém jogou cassino neste grupo."
              />
            </section>

            <section className="lg:col-span-2">
              <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Facções</h2>
              {!factions.length ? (
                <Card className="border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
                  Nenhuma facção.
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-zinc-100">
                    {factions.map((f) => (
                      <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                            {f.emoji} {f.name}
                          </div>
                          <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                            líder {f.leaderName || displayPlayer({ userJid: f.leaderJid })}
                          </div>
                        </div>
                        <div className="shrink-0 text-sm tabular-nums text-zinc-700 dark:text-zinc-200">
                          {formatNumber(f.vaultCoins)}
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function CasinoSkeleton() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2.5 h-7 w-24" />
          </Card>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="h-64 lg:col-span-3" />
        <Card className="h-64 lg:col-span-2" />
      </div>
    </div>
  );
}

export default function CasinoPage() {
  return <CasinoBody />;
}
