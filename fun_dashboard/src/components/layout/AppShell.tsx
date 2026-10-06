"use client";

import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useDashboardScope } from "@/components/layout/ScopeProvider";

type Props = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  status?: string | null;
  allowAllGroups?: boolean;
  scopeOverride?: string;
  onScopeOverrideChange?: (scope: string) => void;
};

export function AppShell({
  title,
  subtitle,
  children,
  onRefresh,
  refreshing,
  status,
  allowAllGroups,
  scopeOverride,
  onScopeOverrideChange,
}: Props) {
  const scopeState = useDashboardScope();

  const currentScope = scopeOverride !== undefined ? scopeOverride : scopeState.scope;
  const handleScopeChange = onScopeOverrideChange !== undefined ? onScopeOverrideChange : scopeState.setScope;

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          subtitle={subtitle}
          groups={scopeState.groups}
          scope={currentScope}
          onScopeChange={handleScopeChange}
          onRefresh={
            onRefresh
              ? () => {
                  void scopeState.reload();
                  onRefresh();
                }
              : () => {
                  void scopeState.reload();
                }
          }
          refreshing={Boolean(refreshing || scopeState.loading)}
          status={status ?? scopeState.error}
          allowAllGroups={allowAllGroups}
        />
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}

export { useDashboardScope } from "@/components/layout/ScopeProvider";
