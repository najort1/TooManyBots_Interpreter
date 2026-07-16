"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { MetricStrip } from "@/components/metrics/MetricStrip";
import { RankingTable } from "@/components/ranking/RankingTable";
import { funApi } from "@/lib/api";
import { displayPlayer, formatNumber } from "@/lib/format";
import type { CasinoPayload, Faction } from "@/lib/types";

function CasinoBody() {
  const { scope } = useDashboardScope();
  const [casino, setCasino] = useState<CasinoPayload | null>(null);
  const [factions, setFactions] = useState<Faction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!scope) {
      setCasino(null);
      setFactions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [c, f] = await Promise.all([
        funApi.casino(scope, 20),
        funApi.factions(scope),
      ]);
      setCasino(c);
      setFactions(f.factions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  const t = casino?.tournament;

  return (
    <AppShell
      title="Cassino"
      subtitle="Jackpot, rank e facções"
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <MetricStrip
          items={[
            { label: "Jackpot", value: casino?.jackpot ?? 0 },
            {
              label: "Torneio pot",
              value: t?.pot ?? 0,
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
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">
              Rank cassino
            </h2>
            <RankingTable
              entries={casino?.board || []}
              kind="casino"
              empty="Ninguém jogou cassino neste grupo."
            />
          </section>

          <section className="lg:col-span-2">
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">Facções</h2>
            {!factions.length ? (
              <div className="rounded-lg border border-dashed border-zinc-200 bg-white px-4 py-10 text-center text-sm text-zinc-500">
                Nenhuma facção.
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                {factions.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-900">
                        {f.emoji} {f.name}
                      </div>
                      <div className="truncate text-xs text-zinc-500">
                        líder {f.leaderName || displayPlayer({ userJid: f.leaderJid })}
                      </div>
                    </div>
                    <div className="shrink-0 text-sm tabular-nums text-zinc-700">
                      {formatNumber(f.vaultCoins)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}

export default function CasinoPage() {
  return <CasinoBody />;
}
