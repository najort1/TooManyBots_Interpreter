"use client";

import { useEffect, useRef, useState } from "react";
import { SidebarContent, Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { useDashboardScope } from "@/components/layout/ScopeProvider";
import { trapTabKey } from "@/components/ui/focusTrap";
import { cn } from "@/lib/cn";

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
  /** container mais largo para páginas densas (ex.: logs) */
  wide?: boolean;
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
  wide = false,
}: Props) {
  const scopeState = useDashboardScope();
  const [menuOpen, setMenuOpen] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  // Escape fecha o drawer, Tab fica preso dentro dele (mesma técnica do Dialog)
  // e o scroll do fundo fica travado enquanto aberto
  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      const drawer = drawerRef.current;
      if (drawer) trapTabKey(event, drawer);
    };
    document.addEventListener("keydown", onKeyDown);
    const doc = document.documentElement;
    const body = document.body;
    doc.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      doc.style.overflow = "";
      body.style.overflow = "";
    };
  }, [menuOpen]);

  // foco entra no drawer ao abrir e volta ao hambúrguer ao fechar
  useEffect(() => {
    if (menuOpen) {
      drawerRef.current?.focus();
      wasOpenRef.current = true;
    } else if (wasOpenRef.current) {
      wasOpenRef.current = false;
      document
        .querySelector<HTMLElement>('button[aria-controls="sidebar-nav"]')
        ?.focus();
    }
  }, [menuOpen]);

  const currentScope = scopeOverride !== undefined ? scopeOverride : scopeState.scope;
  const handleScopeChange = onScopeOverrideChange !== undefined ? onScopeOverrideChange : scopeState.setScope;

  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-50">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-zinc-900 focus:px-3 focus:py-2 focus:text-sm focus:text-zinc-50"
      >
        Pular para o conteúdo
      </a>
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
          onMenuToggle={() => setMenuOpen((open) => !open)}
          menuOpen={menuOpen}
        />
        <main
          id="main-content"
          tabIndex={-1}
          className={cn(
            "mx-auto w-full flex-1 p-4 sm:p-6",
            wide ? "max-w-7xl" : "max-w-6xl"
          )}
        >
          {children}
        </main>
      </div>

      {/* Drawer mobile: sempre montado para manter a transição; invisível/inerte no desktop (md:hidden)
          e fora da tela quando fechado — só existe de fato em um breakpoint por vez. */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-zinc-950/50 transition-opacity duration-200 md:hidden",
          menuOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
      />
      <aside
        ref={drawerRef}
        id="sidebar-nav"
        tabIndex={-1}
        aria-label="Principal"
        inert={!menuOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900 md:hidden",
          menuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent onNavigate={() => setMenuOpen(false)} />
      </aside>
    </div>
  );
}

export { useDashboardScope } from "@/components/layout/ScopeProvider";
