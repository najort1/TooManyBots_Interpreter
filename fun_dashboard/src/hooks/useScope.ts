"use client";

import { useCallback, useEffect, useState } from "react";
import { funApi } from "@/lib/api";
import type { FunGroup } from "@/lib/types";

const STORAGE_KEY = "fun-dashboard-scope";

export function useScope() {
  const [groups, setGroups] = useState<FunGroup[]>([]);
  const [scope, setScopeState] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const setScope = useCallback((jid: string) => {
    setScopeState(jid);
    try {
      localStorage.setItem(STORAGE_KEY, jid);
    } catch {
      // ignore
    }
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await funApi.groups();
      const list = data.groups || [];
      setGroups(list);
      setScopeState((current) => {
        if (current && list.some((g) => g.jid === current)) return current;
        try {
          const saved = localStorage.getItem(STORAGE_KEY) || "";
          if (saved && list.some((g) => g.jid === saved)) return saved;
        } catch {
          // ignore
        }
        return list[0]?.jid || "";
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar grupos");
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const active = groups.find((g) => g.jid === scope) || null;

  return {
    groups,
    scope,
    setScope,
    active,
    loading,
    error,
    reload,
  };
}
