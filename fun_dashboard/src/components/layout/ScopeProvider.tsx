"use client";

import { createContext, useContext } from "react";
import { usePathname } from "next/navigation";
import { useScope } from "@/hooks/useScope";
import type { FunGroup } from "@/lib/types";

type ScopeCtx = {
  groups: FunGroup[];
  scope: string;
  setScope: (jid: string) => void;
  active: FunGroup | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const ScopeContext = createContext<ScopeCtx | null>(null);

export function useDashboardScope() {
  const ctx = useContext(ScopeContext);
  if (!ctx) throw new Error("useDashboardScope fora do ScopeProvider");
  return ctx;
}

/** Rotas públicas: sem lista de grupos / API admin. */
function isPublicSurface(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === "/bolsa" || pathname.startsWith("/bolsa/")) return true;
  if (pathname.startsWith("/job/")) return true;
  return false;
}

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicSurface = isPublicSurface(pathname);
  const value = useScope({ enabled: !publicSurface });
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
