"use client";

import { Menu, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import type { FunGroup } from "@/lib/types";
import { groupLabel } from "@/lib/format";

type Props = {
  title: string;
  subtitle?: string;
  groups: FunGroup[];
  scope: string;
  onScopeChange: (jid: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  status?: string | null;
  allowAllGroups?: boolean;
  /** abre/fecha o drawer mobile (hambúrguer só aparece se informado) */
  onMenuToggle?: () => void;
  menuOpen?: boolean;
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
  allowAllGroups,
  onMenuToggle,
  menuOpen,
}: Props) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white/90 px-5 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
      <div className="flex min-w-0 items-center gap-2">
        {onMenuToggle ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onMenuToggle}
            className="md:hidden"
            aria-label={menuOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={Boolean(menuOpen)}
            aria-controls="sidebar-nav"
          >
            <Menu className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
            {title}
          </h1>
          {subtitle ? (
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
              {subtitle}
            </p>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status ? (
          <span className="max-w-[10rem] truncate text-xs text-zinc-500 sm:max-w-none sm:text-sm dark:text-zinc-400">
            {status}
          </span>
        ) : null}
        <ThemeToggle />
        <div className="min-w-0 flex-1 sm:w-56 sm:flex-none">
          <Select
            aria-label="Grupo"
            value={scope}
            onChange={(e) => onScopeChange(e.target.value)}
            disabled={!groups.length && !allowAllGroups}
          >
            {!groups.length ? (
              allowAllGroups ? (
                <option value="">Todos os grupos (Global)</option>
              ) : (
                <option value="">Nenhum grupo na whitelist</option>
              )
            ) : (
              <>
                {allowAllGroups && (
                  <option value="">Todos os grupos (Global)</option>
                )}
                {groups.map((g) => (
                  <option key={g.jid} value={g.jid}>
                    {groupLabel(g.jid, g.name)}
                  </option>
                ))}
              </>
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
            <span className="hidden sm:inline">Atualizar</span>
          </Button>
        ) : null}
      </div>
    </header>
  );
}
