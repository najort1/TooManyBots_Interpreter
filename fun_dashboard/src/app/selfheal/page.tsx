"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

  return <AppShell title="Auto-aprimoramento" subtitle="Auditoria guiada por LLM, com simulação e revisão humana" onRefresh={() => void load()} refreshing={loading} status={error}>
    {loading && !config ? <p className="text-sm text-zinc-500">Carregando controles e auditoria…</p> : <div className="mx-auto grid max-w-6xl gap-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Controles</h2><p className="text-xs text-zinc-500">Mudanças são persistidas e aplicadas no próximo reload de configuração do bot.</p></div><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={!config} onClick={() => void save({ enabled: !config?.enabled })}>{config?.enabled ? "Desligar" : "Ligar"}</Button><Button size="sm" disabled={!config} onClick={() => void save({ dryRun: !config?.dryRun })}>{config?.dryRun ? "Dry-run ligado" : "Dry-run desligado"}</Button></div></div>
        <div className="mt-3 grid gap-2 text-sm sm:grid-cols-4"><Stat label="Intervalo" value={config ? `${Math.round(config.intervalMs / 60000)} min` : "—"}/><Stat label="Evidências" value={summary ? String(summary.evidence.rows) : "—"}/><Stat label="Retenção" value={config ? `${config.evidenceRetentionDays} dias` : "—"}/><Stat label="Itens/run" value={config ? String(config.maxItemsPerRun) : "—"}/></div>
      </section>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><div><h2 className="text-sm font-semibold">Executar varredura</h2><p className="text-xs text-zinc-500">Disponível apenas para administradores; sem scope, usa somente os grupos da whitelist.</p></div><div className="mt-3 grid gap-2 sm:grid-cols-4"><select aria-label="Domínio" value={domain} onChange={(event) => setDomain(event.target.value)} className="rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"><option value="memory_lore">Memória e lore</option><option value="conversation_memory">Memórias de conversa</option><option value="economy">Economia</option><option value="profile">Perfis</option></select><input aria-label="Scope opcional" value={scopeKey} onChange={(event) => setScopeKey(event.target.value)} placeholder="Scope opcional" className="rounded border border-zinc-200 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"/><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={runDry} onChange={(event) => setRunDry(event.target.checked)}/> Dry-run</label><Button size="sm" disabled={running} onClick={() => void run()}>{running ? "Executando…" : "Executar"}</Button></div>{success && <p role="status" className="mt-2 text-sm text-emerald-600 dark:text-emerald-400">{success}</p>}</section>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><h2 className="text-sm font-semibold">Resumo</h2>{summary ? <div className="mt-3 flex flex-wrap gap-2">{Object.entries(summary.totals).map(([key, value]) => <Badge key={key} tone="neutral">{key}: {value}</Badge>)}</div> : <p className="mt-2 text-sm text-zinc-500">Ainda não há métricas.</p>}</section>
      <Table title="Varreduras" empty="Nenhuma varredura registrada." rows={runs} render={(run) => <><td>{run.domain}</td><td>{run.itemsAudited}</td><td>{run.applied}</td><td>{run.pendingReview}</td><td><Badge tone={run.status === "error" ? "danger" : "success"}>{run.status}</Badge></td></>} headers={["Domínio", "Itens", "Aplicadas", "Revisão", "Status"]}/>
      <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><h2 className="text-sm font-semibold">Trilha de auditoria</h2>{entries.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Nenhum achado registrado.</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-zinc-500"><tr><th>Domínio</th><th>Ação</th><th>Status</th><th>Motivo</th><th /></tr></thead><tbody>{entries.map(entry => <tr key={entry.id} className="border-t border-zinc-100 dark:border-zinc-800"><td>{entry.domain}</td><td>{entry.action}</td><td><Badge tone={entry.status === "pending_review" ? "ink" : entry.status === "rejected" ? "danger" : "neutral"}>{entry.status}</Badge></td><td className="max-w-xs truncate">{entry.reason}</td><td>{entry.status === "pending_review" && <span className="flex gap-1"><Button size="sm" onClick={() => void review(entry.id, "apply")}>Aplicar</Button><Button size="sm" variant="secondary" onClick={() => void review(entry.id, "reject")}>Rejeitar</Button></span>}</td></tr>)}</tbody></table></div>}</section>
    </div>}
  </AppShell>;
}
function Stat({ label, value }: { label: string; value: string }) { return <div className="rounded border border-zinc-100 p-2 dark:border-zinc-800"><p className="text-xs text-zinc-500">{label}</p><p className="font-medium">{value}</p></div>; }
function Table<T>({ title, empty, rows, headers, render }: { title: string; empty: string; rows: T[]; headers: string[]; render: (row: T) => React.ReactNode }) { return <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"><h2 className="text-sm font-semibold">{title}</h2>{rows.length === 0 ? <p className="mt-2 text-sm text-zinc-500">{empty}</p> : <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead className="text-xs text-zinc-500"><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index} className="border-t border-zinc-100 dark:border-zinc-800">{render(row)}</tr>)}</tbody></table></div>}</section>; }
