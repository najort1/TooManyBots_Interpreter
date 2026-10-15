"use client";

import { useId, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Brain,
  ChevronDown,
  ChevronUp,
  Clock,
  Coins,
  Cpu,
  Database,
  DollarSign,
  Flame,
  HelpCircle,
  Layers,
  MessageSquare,
  RefreshCw,
  Search,
  Sparkles,
  Timer,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber, formatWhen } from "@/lib/format";
import type {
  LlmAnalyticsResponse,
  LlmCallLog,
  LlmDailyMetric,
  LlmTaskMetric,
} from "@/lib/types";

// Tradução e rotulação amigável de tarefas conhecidas do bot Fun
const TASK_LABELS: Record<string, { label: string; icon: typeof Bot; category: string }> = {
  invent: { label: "Criação de Itens (Invent)", icon: Sparkles, category: "Economia" },
  market: { label: "Mercado & Bolsa de Valores", icon: Sparkles, category: "Economia" },
  journalist: { label: "Jornal do Mercado", icon: MessageSquare, category: "Economia" },
  flavor: { label: "Comentários & Zuação (Flavor)", icon: MessageSquare, category: "Social" },
  chaos: { label: "Caos & Notícias (Group Times)", icon: Activity, category: "Social" },
  groupNews: { label: "Jornal do Grupo (Group Times)", icon: Activity, category: "Social" },
  group_times: { label: "Jornal do Grupo (Group Times)", icon: Activity, category: "Social" },
  assault: { label: "Roteiros de Assalto", icon: Layers, category: "Jogos" },
  tarot: { label: "Oráculo & Tarô", icon: Brain, category: "Cassino" },
  qmp: { label: "Quem Mais Provável", icon: Users, category: "Jogos" },
  profile: { label: "Perfil & Bio de Usuário", icon: Users, category: "Social" },
  memory: { label: "Extração de Memória de Grupo", icon: Database, category: "Memória" },
  socialHints: { label: "Pistas Sociais da Persona", icon: Users, category: "Memória" },
  chemistry: { label: "Química Social (Bonds)", icon: Users, category: "Social" },
  loreReconciliation: { label: "Reconciliação de Lore", icon: Database, category: "Memória" },
  news: { label: "Redação de Notícias", icon: MessageSquare, category: "Social" },
  roast: { label: "Roast Personalizado", icon: Flame, category: "Social" },
  persona: { label: "Persona Conversacional / Chat", icon: Bot, category: "Chat" },
  personaOpportunity: { label: "Oportunidade de Interação (Persona)", icon: Bot, category: "Chat" },
  selfHeal: { label: "Auto-Aprimoramento (Self-Heal)", icon: Cpu, category: "Sistema" },
  quizRoyale: { label: "Perguntas de Quiz Royale", icon: HelpCircle, category: "Jogos" },
  events: { label: "Extração de Eventos do Grupo", icon: Activity, category: "Social" },
  dailyChallenge: { label: "Desafios Diários & Enigmas", icon: HelpCircle, category: "Jogos" },
  levelUp: { label: "Mensagem de Level Up", icon: Sparkles, category: "Social" },
  openai: { label: "Outras Chamadas de IA", icon: Bot, category: "Geral" },
  unknown: { label: "Não categorizado", icon: Bot, category: "Geral" },
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

type Props = {
  data: LlmAnalyticsResponse | null;
  loading: boolean;
  days: number;
  onDaysChange: (d: number) => void;
  onRefresh: () => void;
  scope: string;
  onScopeChange?: (s: string) => void;
  groups?: Array<{ jid: string; name?: string }>;
};

export function LlmAnalyticsView({
  data,
  loading,
  days,
  onDaysChange,
  onRefresh,
  scope,
  onScopeChange,
  groups,
}: Props) {
  const [metricTab, setMetricTab] = useState<"calls" | "tokens">("calls");
  const [auditSearch, setAuditSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null);

  const summary = data?.summary;
  const daily = data?.daily || [];
  const byTask = data?.byTask || [];
  const byProvider = data?.byProvider || [];
  const byModel = data?.byModel || [];
  const byHour = data?.byHour || [];
  const byGroup = data?.byGroup || [];
  const recentCalls = data?.recentCalls || [];

  const rawRecent = data?.recentCalls;
  const filteredLogs = useMemo(() => {
    const list = rawRecent || [];
    return list.filter((c) => {
      const matchSearch =
        auditSearch.trim() === "" ||
        c.task.toLowerCase().includes(auditSearch.toLowerCase()) ||
        c.model.toLowerCase().includes(auditSearch.toLowerCase()) ||
        c.provider.toLowerCase().includes(auditSearch.toLowerCase()) ||
        (c.userName && c.userName.toLowerCase().includes(auditSearch.toLowerCase())) ||
        (c.groupName && c.groupName.toLowerCase().includes(auditSearch.toLowerCase())) ||
        c.promptPreview.toLowerCase().includes(auditSearch.toLowerCase()) ||
        c.responsePreview.toLowerCase().includes(auditSearch.toLowerCase());

      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "success" && c.status === "success") ||
        (statusFilter === "errors" && (c.status === "error" || c.status === "timeout")) ||
        (statusFilter === "fallback" && (c.status === "fallback" || c.provider.startsWith("template")));

      return matchSearch && matchStatus;
    });
  }, [rawRecent, auditSearch, statusFilter]);

  return (
    <div className="space-y-6">
      {/* Barra de Filtro de Período & Status */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Período:
          </span>
          {[
            { d: 1, label: "Hoje (24h)" },
            { d: 7, label: "7 Dias" },
            { d: 30, label: "30 Dias" },
            { d: 90, label: "90 Dias" },
            { d: 0, label: "Tudo" },
          ].map(({ d, label }) => (
            <button
              key={d}
              type="button"
              onClick={() => onDaysChange(d)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                days === d
                  ? "bg-zinc-900 text-zinc-50 shadow-sm dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-white text-zinc-600 hover:bg-zinc-100 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
              }`}
            >
              {label}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-0 sm:ml-2">
            <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
              Escopo:
            </span>
            <select
              aria-label="Filtrar por grupo"
              value={scope}
              onChange={(e) => onScopeChange?.(e.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
            >
              <option value="">🌐 Todos os grupos (Global)</option>
              {groups?.map((g) => (
                <option key={g.jid} value={g.jid}>
                  {g.name || g.jid}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {scope ? (
            <div className="flex items-center gap-1.5">
              <Badge tone="ink">Filtrando por grupo</Badge>
              <button
                type="button"
                onClick={() => onScopeChange?.("")}
                className="text-[11px] text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100 underline"
                title="Limpar filtro de grupo"
              >
                (Limpar)
              </button>
            </div>
          ) : (
            <Badge tone="neutral">Todos os grupos (Global)</Badge>
          )}

          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
            <span
              className={`h-2 w-2 rounded-full ${
                data?.zenHealth?.ok ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
              }`}
            />
            <span>{data?.summary?.activeModel || "bot-zap"}</span>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Atualizar métricas"
          >
            <RefreshCw
              className={`h-3 w-3 ${loading ? "animate-spin" : ""}`}
              aria-hidden
            />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Banner se filtro de grupo específico não possuir dados no período */}
      {scope && summary?.totalCalls === 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50/80 px-4 py-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          <div>
            <span className="font-semibold">Nenhuma chamada registrada para este grupo</span> no período selecionado.
          </div>
          <button
            type="button"
            onClick={() => onScopeChange?.("")}
            className="font-medium underline hover:no-underline text-amber-950 dark:text-amber-100 self-start sm:self-auto"
          >
            Alternar para Todos os Grupos (Visão Global) →
          </button>
        </div>
      )}

      {/* KPI Cards: Resumo Executivo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {/* Card 1: Chamadas Totais */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Chamadas de IA</span>
            <Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatNumber(summary?.totalCalls || 0)}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="font-semibold text-emerald-600 dark:text-emerald-400">
              {((summary?.successRate || 1) * 100).toFixed(1)}% sucesso
            </span>
            <span>·</span>
            <span>{summary?.errorCalls || 0} falhas</span>
          </div>
        </div>

        {/* Card 2: Tokens Consumidos */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Volume de Tokens</span>
            <Coins className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatTokens(summary?.totalTokens || 0)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            In: {formatTokens(summary?.promptTokens || 0)} · Out:{" "}
            {formatTokens(summary?.completionTokens || 0)} (méd.{" "}
            {summary?.avgTokensPerCall || 0}/req)
          </div>
        </div>

        {/* Card 3: Tempo de Execução (Latência) */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Tempo de Execução</span>
            <Timer className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            {formatDuration(summary?.avgDurationMs || 0)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            P95: {formatDuration(summary?.p95DurationMs || 0)} · Total:{" "}
            {(Math.max(0, summary?.totalDurationMs || 0) / 60_000).toFixed(1)} min
          </div>
        </div>

        {/* Card 4: Custo / Economia */}
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between text-zinc-500 dark:text-zinc-400">
            <span className="text-xs font-medium">Custo / Economia</span>
            <DollarSign className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
            ${(summary?.estimatedCostUsd || 0).toFixed(3)}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            Fallback: {summary?.fallbackCalls || 0} reqs sem custo
          </div>
        </div>
      </div>

      {/* Gráfico 1: Séries Temporais Diárias (Chamadas & Tokens) */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              Histórico Diário de Uso da IA
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Evolução diária de requisições e consumo de tokens pelo bot
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
            <button
              type="button"
              onClick={() => setMetricTab("calls")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                metricTab === "calls"
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              Chamadas / Dia
            </button>
            <button
              type="button"
              onClick={() => setMetricTab("tokens")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                metricTab === "tokens"
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-200"
              }`}
            >
              Tokens / Dia
            </button>
          </div>
        </div>

        <div className="mt-5">
          <DailyUsageChart
            daily={daily}
            metric={metricTab}
            height={220}
          />
        </div>
      </div>

      {/* Grid: 2 Colunas (Qual função mais chama IA + Horários de Pico) */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Coluna 1: Qual função mais chama IA */}
        <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                Funções que mais Chamam IA
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Detalhamento por funcionalidade, volume e latência média
              </p>
            </div>
            <Badge tone="neutral">{byTask.length} funções</Badge>
          </div>

          <div className="mt-4 flex-1 space-y-3">
            {byTask.length === 0 ? (
              <div className="flex h-44 items-center justify-center text-xs text-zinc-400">
                Nenhum registro de chamada de IA no período selecionado.
              </div>
            ) : (
              byTask.slice(0, 7).map((item) => (
                <TaskBarItem key={item.task} item={item} />
              ))
            )}
          </div>
        </div>

        {/* Coluna 2: Horários de Pico (0h às 23h) */}
        <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                Distribuição Horária & Horários de Pico
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Faixas do dia em que os grupos mais demandam o modelo (0h às 23h)
              </p>
            </div>
            <Clock className="h-4 w-4 text-zinc-400" />
          </div>

          <div className="mt-4 flex-1">
            <HourlyPeakChart hours={byHour} />
          </div>
        </div>
      </div>

      {/* Grid: Provedores & Modelos + Grupos WhatsApp */}
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Provedores & Modelos */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
            Provedores & Modelos Ativos
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Distribuição da carga entre OpenCode Zen, Ollama e Templates
          </p>

          <div className="mt-4 space-y-4">
            <div>
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Provedor
              </div>
              <div className="mt-2 space-y-2">
                {byProvider.map((p) => (
                  <div key={p.provider} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                        {p.provider}
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {p.calls} calls ({p.percentage}%) · {formatDuration(p.avgDurationMs)}
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${Math.min(100, p.percentage)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
              <div className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Modelo em Execução
              </div>
              <div className="mt-2 space-y-2">
                {byModel.map((m) => (
                  <div key={m.model} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
                        {m.model}
                      </span>
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {m.calls} calls ({m.percentage}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full bg-indigo-500"
                        style={{ width: `${Math.min(100, m.percentage)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Grupos de WhatsApp que mais usam IA */}
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
                Consumo por Grupo
              </h3>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                Grupos na whitelist com maior volume de interações com IA
              </p>
            </div>
            <Users className="h-4 w-4 text-zinc-400" />
          </div>

          <div className="mt-4 space-y-2.5">
            {byGroup.length === 0 ? (
              <div className="py-8 text-center text-xs text-zinc-400">
                Nenhum grupo com chamadas registradas no período.
              </div>
            ) : (
              byGroup.slice(0, 5).map((g) => (
                <div
                  key={g.scopeKey}
                  className="flex items-center justify-between rounded-lg border border-zinc-100 bg-zinc-50/70 p-2.5 text-xs dark:border-zinc-800/80 dark:bg-zinc-800/40"
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate font-medium text-zinc-900 dark:text-zinc-100">
                      {g.groupName || g.scopeKey}
                    </div>
                    <div className="truncate font-mono text-[10px] text-zinc-400">
                      {g.scopeKey}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-semibold text-zinc-900 dark:text-zinc-100 tabular-nums">
                      {g.calls} calls
                    </div>
                    <div className="text-[10px] text-zinc-500 dark:text-zinc-400">
                      {formatTokens(g.totalTokens)} tok · {formatDuration(g.avgDurationMs)}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Tabela de Auditoria das Últimas Chamadas (Audit Trail) */}
      <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-50">
              Auditoria de Chamadas Recentes
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Histórico detalhado com latência, tokens, prompt e resposta da IA
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-zinc-400" />
              <Input
                placeholder="Filtrar chamadas..."
                value={auditSearch}
                onChange={(e) => setAuditSearch(e.target.value)}
                className="h-8 pl-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-1 rounded-lg border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-800 dark:bg-zinc-950">
              {[
                { id: "all", label: "Todas" },
                { id: "success", label: "Sucesso" },
                { id: "fallback", label: "Fallback" },
                { id: "errors", label: "Falhas" },
              ].map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setStatusFilter(id)}
                  className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                    statusFilter === id
                      ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-800 dark:text-zinc-50"
                      : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-zinc-100 text-zinc-400 dark:border-zinc-800 dark:text-zinc-500">
                <th className="py-2.5 pr-3 font-medium">Horário</th>
                <th className="px-3 py-2.5 font-medium">Função</th>
                <th className="px-3 py-2.5 font-medium">Provedor / Modelo</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium text-right">Tokens</th>
                <th className="px-3 py-2.5 font-medium text-right">Latência</th>
                <th className="py-2.5 pl-3 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-zinc-400">
                    Nenhuma chamada encontrada com os filtros aplicados.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => {
                  const isExpanded = expandedLogId === log.id;
                  const taskMeta = TASK_LABELS[log.task] || {
                    label: log.task,
                    icon: Bot,
                    category: "Geral",
                  };
                  const isSuccess = log.status === "success";
                  const isFallback =
                    log.status === "fallback" || log.provider.startsWith("template");

                  return (
                    <tr
                      key={log.id}
                      className="group hover:bg-zinc-50/50 dark:hover:bg-zinc-800/30"
                    >
                      <td className="py-3 pr-3 text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
                        <div>{new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-500">
                          {formatWhen(log.createdAt)}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                          {taskMeta.label}
                        </div>
                        <div className="font-mono text-[10px] text-zinc-400">
                          {log.task}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <div className="font-mono text-zinc-800 dark:text-zinc-200">
                          {log.model}
                        </div>
                        <div className="text-[10px] text-zinc-400">
                          via {log.provider}
                        </div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">
                        <Badge
                          tone={
                            isSuccess
                              ? "success"
                              : isFallback
                                ? "warn"
                                : "danger"
                          }
                        >
                          {log.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                          {log.totalTokens}
                        </span>
                        <div className="text-[10px] text-zinc-400">
                          {log.promptTokens} in / {log.completionTokens} out
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums whitespace-nowrap">
                        <span
                          className={`font-mono font-medium ${
                            log.durationMs < 1000
                              ? "text-emerald-600 dark:text-emerald-400"
                              : log.durationMs < 3000
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {formatDuration(log.durationMs)}
                        </span>
                      </td>
                      <td className="py-3 pl-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpandedLogId(isExpanded ? null : log.id)}
                          className="rounded-md border border-zinc-200 bg-white p-1 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                          aria-label="Ver detalhes da chamada"
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Modal / Gaveta de Detalhe Expandido de Chamada */}
        {expandedLogId !== null && (
          <ExpandedCallDetail
            log={recentCalls.find((c) => c.id === expandedLogId) || null}
            onClose={() => setExpandedLogId(null)}
          />
        )}
      </div>
    </div>
  );
}

function TaskBarItem({ item }: { item: LlmTaskMetric }) {
  const meta = TASK_LABELS[item.task] || {
    label: item.task,
    icon: Bot,
    category: "Geral",
  };
  const Icon = meta.icon;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1.5 min-w-0 pr-2">
          <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            <Icon className="h-3 w-3" />
          </div>
          <span className="truncate font-medium text-zinc-900 dark:text-zinc-100">
            {meta.label}
          </span>
          <span className="hidden sm:inline text-[10px] text-zinc-400">
            ({meta.category})
          </span>
        </div>

        <div className="shrink-0 text-right font-mono text-zinc-600 dark:text-zinc-400">
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            {item.calls}
          </span>{" "}
          <span className="text-[11px]">({item.percentage}%)</span> ·{" "}
          <span className="text-[11px]">{formatTokens(item.totalTokens)} tok</span> ·{" "}
          <span className="text-[11px] text-zinc-500">{formatDuration(item.avgDurationMs)}</span>
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
          style={{ width: `${Math.max(2, Math.min(100, item.percentage))}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Gráfico SVG de séries temporais diárias para Chamadas ou Tokens.
 */
function DailyUsageChart({
  daily,
  metric,
  height = 200,
}: {
  daily: LlmDailyMetric[];
  metric: "calls" | "tokens";
  height?: number;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const gradId = useId().replace(/:/g, "");

  const pts = daily.length > 0 ? daily : [];
  const values = pts.map((p) => (metric === "calls" ? p.calls : p.totalTokens));
  const maxVal = Math.max(10, ...values);

  const padLeft = 40;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 26;
  const width = 800;

  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  if (pts.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-zinc-400"
        style={{ height }}
      >
        Sem dados para os dias selecionados.
      </div>
    );
  }

  const xs = pts.map((_, i) =>
    pts.length === 1 ? padLeft + innerW / 2 : padLeft + (i / (pts.length - 1)) * innerW
  );
  const ys = values.map((v) => padTop + innerH - (v / maxVal) * innerH);

  const isSinglePoint = pts.length === 1;

  let pathD = `M ${xs[0]} ${ys[0]}`;
  if (!isSinglePoint) {
    for (let i = 1; i < xs.length; i++) {
      const prevX = xs[i - 1];
      const prevY = ys[i - 1];
      const currX = xs[i];
      const currY = ys[i];
      const cp1x = prevX + (currX - prevX) / 2;
      const cp2x = cp1x;
      pathD += ` C ${cp1x} ${prevY}, ${cp2x} ${currY}, ${currX} ${currY}`;
    }
  }

  const areaD = isSinglePoint
    ? ''
    : `${pathD} L ${xs[xs.length - 1]} ${height - padBottom} L ${xs[0]} ${height - padBottom} Z`;

  const hoveredPoint = hoverIndex !== null ? pts[hoverIndex] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full select-none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={`grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Linhas de Grade */}
        {[0, 0.5, 1].map((pct) => {
          const y = padTop + innerH * (1 - pct);
          const valLabel = Math.round(maxVal * pct);
          return (
            <g key={pct}>
              <line
                x1={padLeft}
                y1={y}
                x2={width - padRight}
                y2={y}
                stroke="currentColor"
                className="text-zinc-100 dark:text-zinc-800/80"
                strokeDasharray="4 4"
              />
              <text
                x={padLeft - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-zinc-400 text-[10px] tabular-nums"
              >
                {metric === "tokens" ? formatTokens(valLabel) : valLabel}
              </text>
            </g>
          );
        })}

        {/* Caso único dia: renderiza barra centralizada */}
        {isSinglePoint ? (
          <rect
            x={xs[0] - 28}
            y={ys[0]}
            width={56}
            height={Math.max(4, height - padBottom - ys[0])}
            rx={6}
            fill={`url(#grad-${gradId})`}
            stroke="#10b981"
            strokeWidth="2"
            className="cursor-pointer"
            onMouseEnter={() => setHoverIndex(0)}
          />
        ) : (
          <>
            {/* Área preenchida com gradiente */}
            <path d={areaD} fill={`url(#grad-${gradId})`} />

            {/* Linha principal */}
            <path
              d={pathD}
              fill="none"
              stroke="#10b981"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* Pontos e Rótulos no eixo X */}
        {pts.map((p, idx) => {
          const x = xs[idx];
          const y = ys[idx];
          const showLabel = pts.length <= 10 || idx % Math.ceil(pts.length / 7) === 0;

          return (
            <g key={p.date}>
              {showLabel && (
                <text
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  className="fill-zinc-400 text-[10px] tabular-nums"
                >
                  {p.date.slice(5)}
                </text>
              )}
              {/* Círculo do ponto */}
              <circle
                cx={x}
                cy={y}
                r={hoverIndex === idx ? 5 : 3.5}
                className={`cursor-pointer transition-all ${
                  hoverIndex === idx
                    ? "fill-white stroke-emerald-600 stroke-[3px] dark:fill-zinc-900"
                    : "fill-emerald-500"
                }`}
                onMouseEnter={() => setHoverIndex(idx)}
              />
            </g>
          );
        })}
      </svg>

      {/* Tooltip Dinâmico */}
      {hoveredPoint && (
        <div
          className="pointer-events-none absolute top-2 rounded-lg border border-zinc-200 bg-white/95 px-3 py-2 text-xs shadow-md backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95"
          style={{
            left: `${(xs[hoverIndex!] / width) * 100}%`,
            transform: "translateX(-50%)",
          }}
        >
          <div className="font-semibold text-zinc-900 dark:text-zinc-100">
            {hoveredPoint.date}
          </div>
          <div className="mt-1 space-y-0.5 text-zinc-600 dark:text-zinc-400">
            <div>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {hoveredPoint.calls} chamadas
              </span>{" "}
              ({hoveredPoint.success} ok / {hoveredPoint.errors} err)
            </div>
            <div>
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {formatTokens(hoveredPoint.totalTokens)} tokens
              </span>{" "}
              ({formatTokens(hoveredPoint.promptTokens)} in /{" "}
              {formatTokens(hoveredPoint.completionTokens)} out)
            </div>
            <div>Média de tempo: {formatDuration(hoveredPoint.avgDurationMs)}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Histograma das 24 Horas do Dia para detecção de horários de pico.
 */
function HourlyPeakChart({
  hours,
}: {
  hours: Array<{ hour: number; calls: number; avgDurationMs: number }>;
}) {
  const hasCalls = hours.some((h) => h.calls > 0);
  const maxCalls = Math.max(1, ...hours.map((h) => h.calls));

  if (!hasCalls) {
    return (
      <div className="flex h-36 items-center justify-center text-xs text-zinc-400">
        Nenhuma chamada registrada nas 24h do período selecionado.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex h-36 items-end gap-1 pt-4">
        {hours.map((h) => {
          const heightPct = (h.calls / maxCalls) * 100;
          const isPeak = h.calls === maxCalls && h.calls > 0;

          return (
            <div
              key={h.hour}
              className="group relative flex flex-1 flex-col items-center h-full justify-end"
            >
              {/* Barra */}
              <div
                className={`w-full rounded-t transition-all ${
                  isPeak
                    ? "bg-amber-500 dark:bg-amber-400"
                    : h.calls > 0
                      ? "bg-emerald-500 hover:bg-emerald-400 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      : "bg-zinc-100 dark:bg-zinc-800"
                }`}
                style={{ height: `${Math.max(4, heightPct)}%` }}
              />

              {/* Tooltip no hover da barra */}
              <div className="pointer-events-none absolute -top-8 z-10 hidden whitespace-nowrap rounded bg-zinc-900 px-2 py-1 text-[10px] text-white shadow group-hover:block dark:bg-zinc-100 dark:text-zinc-900">
                {h.hour}h: {h.calls} calls ({formatDuration(h.avgDurationMs)})
              </div>

              {/* Rótulo da hora a cada 3h */}
              {h.hour % 3 === 0 && (
                <span className="mt-1.5 text-[9px] text-zinc-400 tabular-nums">
                  {h.hour}h
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400">
        <span>Madrugada (0h-6h)</span>
        <span>Manhã (6h-12h)</span>
        <span>Tarde (12h-18h)</span>
        <span>Noite (18h-23h)</span>
      </div>
    </div>
  );
}

/**
 * Modal / Card detalhado com Prompt e Resposta da Chamada para auditoria.
 */
function ExpandedCallDetail({
  log,
  onClose,
}: {
  log: LlmCallLog | null;
  onClose: () => void;
}) {
  if (!log) return null;

  return (
    <div className="mt-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-200/80 pb-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <Badge tone="ink">ID #{log.id}</Badge>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">
            Detalhes da Chamada ({log.task})
          </span>
          <span className="text-xs text-zinc-500">
            {new Date(log.createdAt).toLocaleString()}
          </span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Fechar
        </Button>
      </div>

      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        {/* Prompt */}
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Prompt / Entrada
          </span>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-800 whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            {log.promptPreview || "(Entrada vazia ou não informada)"}
          </div>
        </div>

        {/* Resposta da IA */}
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
            Resposta Gerada pela IA
          </span>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-800 whitespace-pre-wrap dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
            {log.responsePreview || log.errorMessage || "(Sem resposta de saída)"}
          </div>
        </div>
      </div>

      {/* Metadados adicionais */}
      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500 dark:text-zinc-400">
        <div>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Grupo: </span>
          {log.groupName || log.scopeKey || "Global"}
        </div>
        {log.userJid && (
          <div>
            <span className="font-medium text-zinc-700 dark:text-zinc-300">Usuário: </span>
            {log.userName || log.userJid}
          </div>
        )}
        <div>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Modelo: </span>
          {log.model} ({log.provider})
        </div>
        <div>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Custo Estimado: </span>
          ${log.costEstimated.toFixed(4)}
        </div>
      </div>
    </div>
  );
}
