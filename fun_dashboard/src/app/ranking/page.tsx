"use client";

import { useState } from "react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { RankingTable } from "@/components/ranking/RankingTable";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsPanel, type TabItem } from "@/components/ui/tabs";
import { useApiQuery } from "@/hooks/useApiQuery";
import { funApi } from "@/lib/api";
import type { RankEntry } from "@/lib/types";

type Kind = "xp" | "coins" | "messages";

const KIND_TABS: TabItem[] = [
  { id: "xp", label: "XP" },
  { id: "coins", label: "Coins" },
  { id: "messages", label: "Msgs" },
];

function RankingBody() {
  const { scope } = useDashboardScope();
  const [kind, setKind] = useState<Kind>("xp");

  const { data, loading, refreshing, error, reload } = useApiQuery(
    () => (scope ? funApi.leaderboard(scope, kind, 25) : Promise.resolve(null)),
    [scope, kind]
  );

  const entries: RankEntry[] = data?.entries || [];
  const total = data?.total || 0;

  // Painel da aba ativa (Erro/Loading/Tabela) — envolvido em TabsPanel para que
  // os ids `panel-<id>` referenciados por aria-controls existam de fato.
  const section =
    error && !data ? (
      <ErrorCard message={error.message} onRetry={() => void reload()} />
    ) : loading && !data ? (
      <RankingSkeleton />
    ) : (
      <RankingTable entries={entries} kind={kind} />
    );

  return (
    <AppShell
      title="Ranking"
      subtitle={`${total} jogador(es) no grupo`}
      onRefresh={() => void reload()}
      refreshing={refreshing}
      status={error?.message ?? null}
    >
      <div className="space-y-4">
        <Tabs tabs={KIND_TABS} active={kind} onChange={(id) => setKind(id as Kind)} />
        {KIND_TABS.map(({ id }) => (
          <TabsPanel key={id} id={id} active={kind}>
            {id === kind ? section : null}
          </TabsPanel>
        ))}
      </div>
    </AppShell>
  );
}

function RankingSkeleton() {
  return (
    <Card className="p-4" aria-busy="true">
      <div className="space-y-2.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    </Card>
  );
}

export default function RankingPage() {
  return <RankingBody />;
}
