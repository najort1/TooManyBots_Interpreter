"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import type { FunGroup } from "@/lib/types";
import { shortJid } from "@/lib/format";

type Props = {
  title: string;
  subtitle?: string;
  groups: FunGroup[];
  scope: string;
  onScopeChange: (jid: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  status?: string | null;
};

export function TopBar({
  title,
  subtitle,
  groups,
  scope,
  onScopeChange,
  onRefresh,
  refreshing,
  status,
}: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white/90 px-5 py-3 backdrop-blur">
      <div className="min-w-0">
        <h1 className="truncate text-base font-semibold text-zinc-900">{title}</h1>
        {subtitle ? (
          <p className="truncate text-xs text-zinc-500">{subtitle}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <span className="hidden text-xs text-zinc-500 sm:inline">{status}</span>
        ) : null}
        <div className="w-56">
          <Select
            aria-label="Grupo"
            value={scope}
            onChange={(e) => onScopeChange(e.target.value)}
            disabled={!groups.length}
          >
            {!groups.length ? (
              <option value="">Nenhum grupo na whitelist</option>
            ) : (
              groups.map((g) => (
                <option key={g.jid} value={g.jid}>
                  {g.name || shortJid(g.jid)}
                </option>
              ))
            )}
          </Select>
        </div>
        {onRefresh ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Atualizar"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`}
              aria-hidden
            />
            Atualizar
          </Button>
        ) : null}
      </div>
    </header>
  );
}
