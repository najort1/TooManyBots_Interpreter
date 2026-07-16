"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { RankingTable } from "@/components/ranking/RankingTable";
import { Button } from "@/components/ui/button";
import { funApi } from "@/lib/api";
import type { RankEntry } from "@/lib/types";
import { cn } from "@/lib/cn";

type Kind = "xp" | "coins" | "messages";

function RankingBody() {
  const { scope } = useDashboardScope();
  const [kind, setKind] = useState<Kind>("xp");
  const [entries, setEntries] = useState<RankEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!scope) {
      setEntries([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await funApi.leaderboard(scope, kind, 25);
      setEntries(data.entries || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha");
    } finally {
      setLoading(false);
    }
  }, [scope, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <AppShell
      title="Ranking"
      subtitle={`${total} jogador(es) no grupo`}
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["xp", "XP"],
              ["coins", "Coins"],
              ["messages", "Msgs"],
            ] as const
          ).map(([k, label]) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? "primary" : "secondary"}
              className={cn(kind === k && "shadow-sm")}
              onClick={() => setKind(k)}
            >
              {label}
            </Button>
          ))}
        </div>
        <RankingTable entries={entries} kind={kind} />
      </div>
    </AppShell>
  );
}

export default function RankingPage() {
  return <RankingBody />;
}
