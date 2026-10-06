"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  Filter,
  RotateCw,
  Search,
  Terminal,
  Trash2,
  X,
  Cpu,
  Coins,
  Dices,
  Gamepad2,
  MessageSquare,
  Sparkles,
  Users,
} from "lucide-react";
import { AppShell, useDashboardScope } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { funApi } from "@/lib/api";
import { cn } from "@/lib/cn";
import { shortJid } from "@/lib/format";
import type { LogDomain, LogLevel, SystemLogEntry } from "@/lib/types";

type LevelFilter = "all" | LogLevel;
type DomainFilter = "all" | LogDomain;

const LEVEL_CONFIG: Record<
  LogLevel,
  { label: string; badgeClass: string; rowBorderClass: string; dotClass: string }
> = {
  error: {
    label: "ERROR",
    badgeClass: "bg-red-500/20 text-red-400 border border-red-500/40",
    rowBorderClass: "border-l-red-500",
    dotClass: "bg-red-400",
  },
  warn: {
    label: "WARN",
    badgeClass: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
    rowBorderClass: "border-l-amber-500",
    dotClass: "bg-amber-400",
  },
  info: {
    label: "INFO",
    badgeClass: "bg-sky-500/20 text-sky-300 border border-sky-500/40",
    rowBorderClass: "border-l-sky-500",
    dotClass: "bg-sky-400",
  },
  debug: {
    label: "DEBUG",
    badgeClass: "bg-purple-500/20 text-purple-300 border border-purple-500/40",
    rowBorderClass: "border-l-purple-500",
    dotClass: "bg-purple-400",
  },
};

const DOMAIN_CONFIG: Record<
  LogDomain,
  { label: string; icon: React.ComponentType<{ className?: string }>; tagClass: string }
> = {
  system: {
    label: "Sistema",
    icon: Cpu,
    tagClass: "text-zinc-400 border-zinc-700 bg-zinc-800/60",
  },
  economy: {
    label: "Economia",
    icon: Coins,
    tagClass: "text-emerald-300 border-emerald-800/60 bg-emerald-950/40",
  },
  casino: {
    label: "Cassino",
    icon: Dices,
    tagClass: "text-amber-300 border-amber-800/60 bg-amber-950/40",
  },
  games: {
    label: "Jogos",
    icon: Gamepad2,
    tagClass: "text-indigo-300 border-indigo-800/60 bg-indigo-950/40",
  },
  whatsapp: {
    label: "WhatsApp",
    icon: MessageSquare,
    tagClass: "text-teal-300 border-teal-800/60 bg-teal-950/40",
  },
  llm: {
    label: "LLM",
    icon: Sparkles,
    tagClass: "text-fuchsia-300 border-fuchsia-800/60 bg-fuchsia-950/40",
  },
  social: {
    label: "Social",
    icon: Users,
    tagClass: "text-cyan-300 border-cyan-800/60 bg-cyan-950/40",
  },
};

const DOMAIN_OPTIONS: Array<{ value: DomainFilter; label: string }> = [
  { value: "all", label: "Todos os domínios" },
  { value: "system", label: "Sistema" },
  { value: "economy", label: "Economia" },
  { value: "casino", label: "Cassino" },
  { value: "games", label: "Jogos" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "llm", label: "LLM" },
  { value: "social", label: "Social" },
];

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export default function LogsPage() {
  const { scope, groups } = useDashboardScope();

  const [logs, setLogs] = useState<SystemLogEntry[]>([]);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isLive, setIsLive] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [expandedRowIds, setExpandedRowIds] = useState<Record<string, boolean>>({});
  const [bufferCapacity, setBufferCapacity] = useState(1000);
  const [droppedCount, setDroppedCount] = useState(0);
  const [totalServerLogs, setTotalServerLogs] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [lastPollTime, setLastPollTime] = useState<number>(Date.now());
  const [error, setError] = useState<string | null>(null);

  const lastTimestampRef = useRef<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);

  // Group JID map for fast name lookup
  const groupNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      if (g.jid) map.set(g.jid, g.name || shortJid(g.jid));
    }
    return map;
  }, [groups]);

  // Initial fetch when scope changes
  const fetchInitial = useCallback(async () => {
    setIsInitialLoading(true);
    setError(null);
    try {
      const res = await funApi.logs({
        limit: 200,
        scope: scope || undefined,
      });
      setLogs(res.logs || []);
      setBufferCapacity(res.bufferCapacity || 1000);
      setDroppedCount(res.dropped || 0);
      setTotalServerLogs(res.total || 0);
      lastTimestampRef.current = res.lastTimestamp || 0;
      setLastPollTime(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao conectar à API de logs");
    } finally {
      setIsInitialLoading(false);
    }
  }, [scope]);

  // Incremental polling with `since`
  const pollNewLogs = useCallback(async () => {
    if (isFetchingRef.current || !isLive) return;
    isFetchingRef.current = true;
    try {
      const res = await funApi.logs({
        since: lastTimestampRef.current,
        limit: 150,
        scope: scope || undefined,
      });

      setBufferCapacity(res.bufferCapacity || 1000);
      setDroppedCount(res.dropped || 0);
      setTotalServerLogs(res.total || 0);
      setLastPollTime(Date.now());

      if (res.logs && res.logs.length > 0) {
        setLogs((prev) => {
          const existingIds = new Set(prev.map((l) => l.id));
          const fresh = res.logs.filter((l) => !existingIds.has(l.id));
          if (!fresh.length) return prev;
          const merged = [...prev, ...fresh];
          // Bounded window to prevent memory leaks in long sessions
          return merged.slice(-1500);
        });
        const highestTs = Math.max(...res.logs.map((l) => l.timestamp));
        if (highestTs > lastTimestampRef.current) {
          lastTimestampRef.current = highestTs;
        }
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro no polling de logs");
    } finally {
      isFetchingRef.current = false;
    }
  }, [isLive, scope]);

  // Reset and load when scope changes
  useEffect(() => {
    lastTimestampRef.current = 0;
    void fetchInitial();
  }, [fetchInitial]);

  // 2.5s interval polling
  useEffect(() => {
    if (!isLive) return;
    const interval = setInterval(() => {
      void pollNewLogs();
    }, 2500);
    return () => clearInterval(interval);
  }, [pollNewLogs, isLive]);

  // Auto-scroll handler
  useEffect(() => {
    if (!autoScroll || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll]);

  // Pause auto-scroll when user manually scrolls up
  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    }
  };

  // Instant client-side filtering
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((log) => {
      if (levelFilter !== "all" && log.level !== levelFilter) return false;
      if (domainFilter !== "all" && log.domain !== domainFilter) return false;
      if (q) {
        const inMsg = log.message.toLowerCase().includes(q);
        const inDomain = log.domain.toLowerCase().includes(q);
        const inLevel = log.level.toLowerCase().includes(q);
        const inScope = log.scope?.toLowerCase().includes(q);
        const inDetails = log.details ? JSON.stringify(log.details).toLowerCase().includes(q) : false;
        if (!inMsg && !inDomain && !inLevel && !inScope && !inDetails) return false;
      }
      return true;
    });
  }, [logs, levelFilter, domainFilter, searchQuery]);

  // Counts for level badges
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = { all: logs.length, info: 0, warn: 0, error: 0, debug: 0 };
    for (const l of logs) {
      if (counts[l.level] !== undefined) counts[l.level]++;
    }
    return counts;
  }, [logs]);

  // Toggle row expansion for metadata details
  const toggleRow = (id: string) => {
    setExpandedRowIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Clear local logs view
  const handleClear = () => {
    setLogs([]);
    setExpandedRowIds({});
  };

  // Copy visible logs to clipboard
  const handleCopy = async () => {
    const text = filteredLogs
      .map((l) => {
        const dt = new Date(l.timestamp).toISOString();
        const detailsStr = l.details ? ` | details=${JSON.stringify(l.details)}` : "";
        const scopeStr = l.scope ? ` [${l.scope}]` : "";
        return `${dt} [${l.level.toUpperCase()}] [${l.domain}]${scopeStr} ${l.message}${detailsStr}`;
      })
      .join("\n");

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  // Export logs to file
  const handleExport = (format: "json" | "txt") => {
    let content = "";
    let mime = "text/plain";
    let ext = "txt";

    if (format === "json") {
      content = JSON.stringify(filteredLogs, null, 2);
      mime = "application/json";
      ext = "json";
    } else {
      content = filteredLogs
        .map((l) => {
          const dt = new Date(l.timestamp).toISOString();
          const detailsStr = l.details ? ` | ${JSON.stringify(l.details)}` : "";
          const scopeStr = l.scope ? ` [${l.scope}]` : "";
          return `${dt} [${l.level.toUpperCase()}] [${l.domain}]${scopeStr} ${l.message}${detailsStr}`;
        })
        .join("\n");
    }

    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `fun-dashboard-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      title="Logs Operacionais"
      subtitle="Terminal de observabilidade e telemetria em tempo real"
      allowAllGroups={true}
      onRefresh={() => void fetchInitial()}
      refreshing={isInitialLoading}
      status={error}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4">
        {/* Top Control Bar: Status, Stats, Live indicator, and Action Buttons */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3.5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Indicator Button */}
            <button
              type="button"
              onClick={() => setIsLive((v) => !v)}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all shadow-xs",
                isLive
                  ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-500/30 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-500/40"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
              )}
              title={isLive ? "Clique para pausar polling" : "Clique para retomar polling"}
            >
              {isLive ? (
                <>
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <span>AO VIVO</span>
                  <span className="hidden text-[10px] opacity-75 sm:inline">(2.5s)</span>
                </>
              ) : (
                <>
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  <span>PAUSADO</span>
                </>
              )}
            </button>

            {/* Scope Badge */}
            <Badge tone="neutral" className="gap-1.5 py-1 text-xs">
              <span className="font-semibold text-zinc-500 dark:text-zinc-400">Escopo:</span>
              <span>{scope ? groupNameMap.get(scope) || shortJid(scope) : "Global (Todos os grupos)"}</span>
            </Badge>

            {/* Buffer & Capacity Badges */}
            <div className="hidden items-center gap-1.5 text-xs text-zinc-500 md:flex dark:text-zinc-400">
              <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-medium dark:bg-zinc-800">
                Memória: {logs.length} / {bufferCapacity}
              </span>
              {totalServerLogs > 0 && (
                <span className="rounded-md bg-zinc-100 px-2 py-0.5 font-mono text-[11px] font-medium dark:bg-zinc-800">
                  Total servidor: {totalServerLogs}
                </span>
              )}
              {droppedCount > 0 && (
                <span className="rounded-md bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                  Descartados: {droppedCount}
                </span>
              )}
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-1.5">
            {/* Auto-scroll toggle */}
            <Button
              variant={autoScroll ? "primary" : "secondary"}
              size="sm"
              onClick={() => setAutoScroll((v) => !v)}
              className="gap-1.5 text-xs"
              title={autoScroll ? "Pausar auto-scroll (manter posição de leitura)" : "Ativar auto-scroll"}
            >
              <ArrowDownToLine className={cn("h-3.5 w-3.5", autoScroll && "animate-pulse")} />
              <span className="hidden sm:inline">Auto-scroll</span>
              <span className="font-bold">{autoScroll ? "ON" : "OFF"}</span>
            </Button>

            {/* Copy button */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleCopy()}
              className="gap-1.5 text-xs"
              title="Copiar logs visíveis"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{copied ? "Copiado!" : "Copiar"}</span>
            </Button>

            {/* Export TXT */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleExport("txt")}
              className="gap-1.5 text-xs"
              title="Baixar arquivo .log"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Exportar</span>
            </Button>

            {/* Clear console */}
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="gap-1.5 text-xs text-zinc-500 hover:text-red-600 dark:hover:text-red-400"
              title="Limpar visualização local de logs"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Limpar</span>
            </Button>
          </div>
        </div>

        {/* Filter Cards: Levels, Domains, and Instant Search */}
        <div className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-center">
            {/* Instant Search Bar */}
            <div className="relative lg:col-span-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar mensagem, escopo, detalhes..."
                className="pl-9 pr-8 text-xs sm:text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
                  aria-label="Limpar busca"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Level Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5 lg:col-span-4">
              <button
                type="button"
                onClick={() => setLevelFilter("all")}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                  levelFilter === "all"
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                )}
              >
                Todos <span className="opacity-60 text-[10px]">({levelCounts.all})</span>
              </button>

              {(["info", "warn", "error", "debug"] as LogLevel[]).map((lvl) => {
                const cfg = LEVEL_CONFIG[lvl];
                const active = levelFilter === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setLevelFilter(lvl)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? cn(cfg.badgeClass, "font-bold ring-1 ring-current")
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", cfg.dotClass)} />
                    {cfg.label}
                    <span className="text-[10px] opacity-70">({levelCounts[lvl] || 0})</span>
                  </button>
                );
              })}
            </div>

            {/* Domain Dropdown / Quick Select */}
            <div className="flex items-center gap-2 lg:col-span-4 lg:justify-end">
              <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400 flex items-center gap-1">
                <Filter className="h-3 w-3" /> Domínio:
              </span>
              <div className="flex flex-wrap items-center gap-1">
                <select
                  value={domainFilter}
                  onChange={(e) => setDomainFilter(e.target.value as DomainFilter)}
                  className="h-8 rounded-md border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900/20 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  {DOMAIN_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Quick Domain Filter Chips Bar */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-2.5 dark:border-zinc-800/80">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500 mr-1">
              Atalhos:
            </span>
            {DOMAIN_OPTIONS.map((opt) => {
              const active = domainFilter === opt.value;
              const domCfg = opt.value !== "all" ? DOMAIN_CONFIG[opt.value as LogDomain] : null;
              const Icon = domCfg?.icon || Activity;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setDomainFilter(opt.value)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium transition-all",
                    active
                      ? "bg-zinc-900 text-zinc-50 shadow-xs dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-800/50 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  )}
                >
                  <Icon className="h-3 w-3 opacity-70" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Modern Dark Terminal Console */}
        <div className="flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl">
          {/* Terminal Window Header */}
          <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/90 px-4 py-2.5 backdrop-blur">
            <div className="flex items-center gap-2">
              {/* Window dots */}
              <div className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-red-500/80 hover:bg-red-500" />
                <span className="h-3 w-3 rounded-full bg-amber-500/80 hover:bg-amber-500" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/80 hover:bg-emerald-500" />
              </div>
              <div className="ml-2 flex items-center gap-1.5 font-mono text-xs text-zinc-400">
                <Terminal className="h-3.5 w-3.5 text-zinc-400" />
                <span>fun_operational_logs.stream</span>
              </div>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-400">
              <span className="hidden sm:inline">
                Exibindo: <strong className="text-zinc-200">{filteredLogs.length}</strong> de{" "}
                <strong className="text-zinc-200">{logs.length}</strong> no buffer
              </span>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span className="hidden sm:inline text-zinc-500">
                {new Date(lastPollTime).toLocaleTimeString("pt-BR")}
              </span>
            </div>
          </div>

          {/* Terminal Body with Monospaced Log Lines */}
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="h-[580px] overflow-y-auto p-2 font-mono text-xs leading-relaxed text-zinc-300 selection:bg-zinc-800 selection:text-zinc-100"
          >
            {isInitialLoading && logs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-zinc-500">
                <RotateCw className="h-6 w-6 animate-spin text-zinc-400" />
                <p>Conectando ao buffer operacional...</p>
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-500">
                <Terminal className="h-8 w-8 text-zinc-700" />
                <p className="text-zinc-400">Nenhum evento registrado com os filtros ativos.</p>
                <p className="text-[11px] text-zinc-600">
                  {searchQuery ? `Termo pesquisado: "${searchQuery}"` : "Aguardando novos eventos do sistema..."}
                </p>
                {(levelFilter !== "all" || domainFilter !== "all" || searchQuery) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setLevelFilter("all");
                      setDomainFilter("all");
                      setSearchQuery("");
                    }}
                    className="mt-2 text-xs text-zinc-400 hover:text-zinc-200"
                  >
                    Redefinir filtros
                  </Button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-0.5">
                {filteredLogs.map((entry, idx) => {
                  const levelCfg = LEVEL_CONFIG[entry.level] || LEVEL_CONFIG.info;
                  const domainCfg = DOMAIN_CONFIG[entry.domain] || DOMAIN_CONFIG.system;
                  const DomainIcon = domainCfg.icon;
                  const hasDetails = Boolean(entry.details && Object.keys(entry.details).length > 0);
                  const isExpanded = Boolean(expandedRowIds[entry.id]);

                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        "group flex flex-col rounded px-2 py-1 transition-colors hover:bg-zinc-900/80 border-l-2",
                        levelCfg.rowBorderClass
                      )}
                    >
                      <div className="flex flex-wrap items-baseline gap-2">
                        {/* Index & Timestamp */}
                        <span className="w-9 shrink-0 text-[10px] text-zinc-600 group-hover:text-zinc-400 select-none">
                          #{idx + 1}
                        </span>
                        <span className="shrink-0 text-zinc-500 select-none">
                          {formatTime(entry.timestamp)}
                        </span>

                        {/* Level Badge */}
                        <span
                          className={cn(
                            "inline-block rounded px-1.5 py-0.2 text-[10px] font-bold tracking-wide select-none",
                            levelCfg.badgeClass
                          )}
                        >
                          {levelCfg.label}
                        </span>

                        {/* Domain Tag */}
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 rounded border px-1.5 py-0.2 text-[10px] select-none",
                            domainCfg.tagClass
                          )}
                        >
                          <DomainIcon className="h-2.5 w-2.5 opacity-80" />
                          {domainCfg.label}
                        </span>

                        {/* Scope Tag (if present) */}
                        {entry.scope && (
                          <span
                            className="inline-block rounded border border-zinc-800 bg-zinc-900 px-1 text-[10px] text-zinc-400"
                            title={`Grupo: ${entry.scope}`}
                          >
                            @{groupNameMap.get(entry.scope) || shortJid(entry.scope)}
                          </span>
                        )}

                        {/* Message Text */}
                        <span className="flex-1 break-words font-sans text-xs text-zinc-200 sm:font-mono sm:text-xs">
                          {entry.message}
                        </span>

                        {/* Details expander toggle */}
                        {hasDetails && (
                          <button
                            type="button"
                            onClick={() => toggleRow(entry.id)}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                            title="Expandir metadados JSON"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            <span>detalhes</span>
                          </button>
                        )}
                      </div>

                      {/* Expandable JSON details tree */}
                      {hasDetails && isExpanded && (
                        <div className="mt-1.5 ml-11 overflow-x-auto rounded border border-zinc-800/80 bg-zinc-900/90 p-2.5 text-[11px] text-emerald-400 shadow-inner">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                            Payload Contextual:
                          </div>
                          <pre className="font-mono leading-relaxed">
                            {JSON.stringify(entry.details, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Terminal Footer Bar */}
          <div className="flex flex-wrap items-center justify-between border-t border-zinc-800/80 bg-zinc-900/60 px-4 py-2 text-[11px] font-mono text-zinc-500">
            <div className="flex items-center gap-4">
              <span>Status: <span className="text-emerald-400">OPERACIONAL</span></span>
              <span>Modo: <span className="text-zinc-300">RingBuffer (Circular In-Memory)</span></span>
              <span className="hidden md:inline">
                Filtro: <span className="text-zinc-300">{levelFilter.toUpperCase()}</span> /{" "}
                <span className="text-zinc-300">{domainFilter}</span>
              </span>
            </div>

            <div className="flex items-center gap-2">
              {!autoScroll && (
                <button
                  type="button"
                  onClick={() => setAutoScroll(true)}
                  className="inline-flex items-center gap-1 rounded bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300 hover:bg-zinc-700"
                >
                  <ArrowDownToLine className="h-3 w-3" />
                  Rolar para o final
                </button>
              )}
              <span className="text-[10px] text-zinc-600">tmb-interpreter-v1</span>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
