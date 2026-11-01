"use client";

import { useCallback, useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { funApi } from "@/lib/api";

type Config = { enabled: boolean; dryRun: boolean; intervalMs: number; evidenceRetentionDays: number; maxItemsPerRun: number; maxCallsPerRun: number };
type Entry = { id: number; domain: string; action: string; status: string; reason: string; mode: string; created_at: number };
type Run = { runId: string; domain: string; status: string; itemsAudited: number; applied: number; pendingReview: number; simulated: number };
type Summary = { totals: Record<string, number>; byDomain: Record<string, Record<string, number>>; evidence: { rows: number; retentionDays: number } };

export default function SelfHealingPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [domain, setDomain] = useState("memory_lore");
  const [scopeKey, setScopeKey] = useState("");
  const [runDry, setRunDry] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [cfg, runData, auditData, summaryData] = await Promise.all([funApi.selfHealConfig(), funApi.selfHealRuns(), funApi.selfHealAudit(), funApi.selfHealSummary()]);
      setConfig(cfg); setRuns(runData.runs); setEntries(auditData.entries); setSummary(summaryData);
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao carregar auto-aprimoramento"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function save(patch: Partial<Config>) {
    try { const result = await funApi.saveSelfHealConfig(patch); setConfig(result.config); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha ao salvar"); }
  }
  async function review(findingId: number, decision: "apply" | "reject") {
    try { await funApi.reviewSelfHeal(findingId, decision); await load(); }
    catch (err) { setError(err instanceof Error ? err.message : "Falha na revisão"); }
  }
  async function run() {
    setRunning(true); setError(null); setSuccess(null);
    try {
      const result = await funApi.runSelfHeal({ domain, ...(scopeKey.trim() ? { scopeKey: scopeKey.trim() } : {}), dryRun: runDry });
      setSuccess(`Varredura ${result.mode === "dry_run" ? "simulada" : "executada"}${result.runId ? `: ${result.runId}` : ""}.`);
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : "Falha ao executar varredura"); }
    finally { setRunning(false); }
  }

  const fatal = Boolean(error && !loading && !config);

  return <AppShell title="Auto-aprimoramento" subtitle="Auditoria guiada por LLM, com simulação e revisão humana" onRefresh={() => void load()} refreshing={loading} status={error}>
    {fatal ? (
      <ErrorCard message={error} onRetry={() => void load()} />
    ) : loading && !config ? <SelfHealSkeleton /> : <div className="grid gap-4">
      {!config?.enabled && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
          <div className="flex items-center gap-2 font-medium">
            <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Função completamente desativada</span>
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            O motor autônomo de auto-aprimoramento, as varreduras periódicas em segundo plano e a captura de novas evidências estão desativados.
          </p>
        </div>
      )}
      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Controles</h2><p className="text-xs text-zinc-600 dark:text-zinc-400">Mudanças são persistidas e aplicadas no próximo reload de configuração do bot.</p></div><div className="flex flex-wrap items-center gap-2"><Button size="sm" disabled={!config} onClick={() => void save({ enabled: !config?.enabled })}>{config?.enabled ? "Desligar" : "Ligar"}</Button><Badge tone={config?.dryRun ? "success" : "neutral"}>Dry-run {config?.dryRun ? "ligado" : "desligado"}</Badge></div></div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4"><Stat label="Intervalo" value={config ? `${Math.round(config.intervalMs / 60000)} min` : "—"}/><Stat label="Evidências" value={summary ? String(summary.evidence.rows) : "—"}/><Stat label="Retenção" value={config ? `${config.evidenceRetentionDays} dias` : "—"}/><Stat label="Itens/run" value={config ? String(config.maxItemsPerRun) : "—"}/></div>
      </Card>
      <Card className="p-4"><div><h2 className="text-sm font-semibold">Executar varredura</h2><p className="text-xs text-zinc-600 dark:text-zinc-400">Disponível apenas para administradores; sem scope, usa somente os grupos da whitelist.</p></div><div className="mt-3 grid gap-2 sm:grid-cols-4"><Select aria-label="Domínio" value={domain} onChange={(event) => setDomain(event.target.value)}><option value="memory_lore">Memória e lore</option><option value="conversation_memory">Memórias de conversa</option><option value="economy">Economia</option><option value="profile">Perfis</option></Select><Input aria-label="Scope opcional" value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} placeholder="Scope opcional"/><label className="flex items-center gap-2 text-sm"><Switch aria-label="Dry-run" checked={runDry} onCheckedChange={setRunDry}/> Dry-run</label><Button size="sm" disabled={running || !config?.enabled} onClick={() => void run()}>{running ? "Executando…" : "Executar"}</Button></div>{!config?.enabled && <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">Varreduras bloqueadas enquanto a função estiver desativada.</p>}{success && <p role="status" className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}</Card>
      <Card className="p-4"><h2 className="text-sm font-semibold">Resumo</h2>{summary ? <div className="mt-3 flex flex-wrap gap-2">{Object.entries(summary.totals).map(([key, value]) => <Badge key={key} tone="neutral">{key}: {value}</Badge>)}</div> : <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Ainda não há métricas.</p>}</Card>
      <Table title="Varreduras" empty="Nenhuma varredura registrada." rows={runs} render={(run) => <><td>{run.domain}</td><td>{run.itemsAudited}</td><td>{run.applied}</td><td>{run.pendingReview}</td><td><Badge tone={run.status === "error" ? "danger" : "success"}>{run.status}</Badge></td></>} headers={["Domínio", "Itens", "Aplicadas", "Revisão", "Status"]}/>
      <Card className="p-4"><h2 className="text-sm font-semibold">Trilha de auditoria</h2>{entries.length === 0 ? <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Nenhum achado registrado.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-zinc-600 dark:text-zinc-400"><tr><th>Domínio</th><th>Ação</th><th>Status</th><th>Motivo</th><th /></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className="border-t border-zinc-100 dark:border-zinc-800"><td>{entry.domain}</td><td>{entry.action}</td><td><Badge tone={entry.status === "pending_review" ? "ink" : entry.status === "rejected" ? "danger" : "neutral"}>{entry.status}</Badge></td><td className="max-w-xs truncate">{entry.reason}</td><td>{entry.status === "pending_review" && <span className="flex gap-1"><Button size="sm" onClick={() => void review(entry.id, "apply")}>Aplicar</Button><Button size="sm" variant="secondary" onClick={() => void review(entry.id, "reject")}>Rejeitar</Button></span>}</td></tr>)}</tbody></table></div>}</Card>
    </div>}
  </AppShell>;
}

function SelfHealSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true">
      <Skeleton className="h-16 w-full" />
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i} className="p-4">
          <Skeleton className="h-4 w-36" />
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-9 w-full" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded border border-zinc-100 p-2 dark:border-zinc-800"><p className="text-xs text-zinc-600 dark:text-zinc-400">{label}</p><p className="font-medium">{value}</p></div>; }
function Table<T>({ title, empty, rows, headers, render }: { title: string; empty: string; rows: T[]; headers: string[]; render: (row: T) => React.ReactNode }) { return <Card className="p-4"><h2 className="text-sm font-semibold">{title}</h2>{rows.length === 0 ? <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{empty}</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-zinc-600 dark:text-zinc-400"><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-zinc-100 dark:border-zinc-800">{render(row)}</tr>)}</tbody></table></div>}</Card>; }
