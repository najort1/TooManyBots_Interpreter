"use client";

import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { GroupSettingsForm } from "@/components/groups/GroupSettingsForm";
import { formatNumber, shortJid } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

function GroupsBody() {
  const { groups, scope, setScope, active } = useDashboardScope();

  return (
    <AppShell title="Grupos" subtitle="Whitelist e settings por scope">
      <div className="mx-auto grid max-w-5xl gap-5 lg:grid-cols-5">
        <section className="lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Whitelist</h2>
          {!groups.length ? (
            <div className="rounded-lg border border-dashed border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Nenhum grupo. Ajuste <code className="text-xs">config.user.json</code>.
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
              {groups.map((g) => {
                const selected = g.jid === scope;
                return (
                  <li key={g.jid}>
                    <button
                      type="button"
                      onClick={() => setScope(g.jid)}
                      className={`flex w-full items-start justify-between gap-2 px-3 py-2.5 text-left transition-colors ${
                        selected ? "bg-zinc-100" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-50">
                          {g.name || shortJid(g.jid)}
                        </div>
                        <div className="truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-500">
                          {g.jid}
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
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="lg:col-span-3">
          {active ? (
            <GroupSettingsForm groupJid={active.jid} />
          ) : (
            <div className="rounded-lg border border-dashed border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900 px-4 py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Selecione um grupo.
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

export default function GroupsPage() {
  return <GroupsBody />;
}
