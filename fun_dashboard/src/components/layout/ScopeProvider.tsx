"use client";

import { createContext, useContext } from "react";
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

export function ScopeProvider({ children }: { children: React.ReactNode }) {
  const value = useScope();
  return <ScopeContext.Provider value={value}>{children}</ScopeContext.Provider>;
}
