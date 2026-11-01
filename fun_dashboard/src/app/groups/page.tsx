"use client";

import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { GroupSettingsForm } from "@/components/groups/GroupSettingsForm";
import { formatNumber, groupLabel, groupSubLabel } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

function GroupsBody() {
  const { groups, scope, setScope, active } = useDashboardScope();

  return (
    <AppShell title="Grupos" subtitle="Whitelist e settings por scope">
      <div className="flex flex-col gap-5">
        {/* 1. Whitelist: grid de cards compactos (não vira coluna alta) */}
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Whitelist</h2>
          {!groups.length ? (
            <Card className="border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Nenhum grupo. Ajuste <code className="text-xs">config.user.json</code>.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((g) => {
                const selected = g.jid === scope;
                return (
                  <button
                    key={g.jid}
                    type="button"
                    onClick={() => setScope(g.jid)}
                    aria-pressed={selected}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded-xl border bg-white p-3 text-left transition-colors dark:bg-zinc-900",
                      selected
                        ? "border-transparent font-semibold ring-2 ring-zinc-900 dark:ring-zinc-100"
                        : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-800/60"
                    )}
                  >
                    <div className="min-w-0">
                      <div
                        className={cn(
                          "truncate text-sm text-zinc-900 dark:text-zinc-50",
                          selected ? "font-semibold" : "font-medium"
                        )}
                      >
                        {groupLabel(g.jid, g.name)}
                      </div>
                      <div className="truncate font-mono text-[11px] text-zinc-600 dark:text-zinc-500">
                        {groupSubLabel(g.jid)}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        <Badge>{formatNumber(g.players)} jogadores</Badge>
                        {g.eventType && g.eventType !== "none" ? (
                          <Badge tone="warn">{g.eventType}</Badge>
                        ) : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      pot {formatNumber(g.jackpot)}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* 2 + 3. Settings form e catálogo de comandos em largura total (empilhados) */}
        <section>
          {active ? (
            <GroupSettingsForm groupJid={active.jid} />
          ) : (
            <Card className="border-dashed border-zinc-200 px-4 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              Selecione um grupo.
            </Card>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export default function GroupsPage() {
  return <GroupsBody />;
}
