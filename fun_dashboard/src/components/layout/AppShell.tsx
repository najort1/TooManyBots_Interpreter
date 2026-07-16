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
};

export function AppShell({
  title,
  subtitle,
  children,
  onRefresh,
  refreshing,
  status,
}: Props) {
  const scopeState = useDashboardScope();

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={title}
          subtitle={subtitle}
          groups={scopeState.groups}
          scope={scopeState.scope}
          onScopeChange={scopeState.setScope}
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
        />
        <main className="flex-1 p-5">{children}</main>
      </div>
    </div>
  );
}

export { useDashboardScope } from "@/components/layout/ScopeProvider";
