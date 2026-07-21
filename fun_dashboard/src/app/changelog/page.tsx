"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { ChangelogEditor } from "@/components/changelog/ChangelogEditor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { funApi } from "@/lib/api";
import type {
  ChangelogBroadcastResult,
  ChangelogGroup,
  ChangelogHistoryItem,
} from "@/lib/types";

function ChangelogBody() {
  const [groups, setGroups] = useState<ChangelogGroup[]>([]);
  const [history, setHistory] = useState<ChangelogHistoryItem[]>([]);
  const [whatsappReady, setWhatsappReady] = useState(false);
  const [title, setTitle] = useState("Novidades do bot");
  const [version, setVersion] = useState("");
  const [body, setBody] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<ChangelogBroadcastResult | null>(
    null
  );
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await funApi.changelog(25);
      setGroups(data.groups || []);
      setHistory(data.history || []);
      setWhatsappReady(Boolean(data.whatsappReady));
      setSelected((prev) => {
        if (prev.size > 0) return prev;
        return new Set((data.groups || []).map((g) => g.jid));
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const allSelected = groups.length > 0 && selected.size === groups.length;

  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(groups.map((g) => g.jid)));
  };

  const toggleOne = (jid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(jid)) next.delete(jid);
      else next.add(jid);
      return next;
    });
  };

  const selectedList = useMemo(() => [...selected], [selected]);

  const runPublish = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    setLastResult(null);
    setPreview(null);
    try {
      const result = await funApi.publishChangelog({
        title: title.trim() || undefined,
        version: version.trim() || undefined,
        body: body.trim(),
        groupJids: selectedList.length ? selectedList : undefined,
        dryRun,
      });
      setLastResult(result);
      if (result.text) setPreview(result.text);
      if (!dryRun) await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      title="Changelog"
      subtitle="Avisa todos os grupos da whitelist sobre novidades e ajustes"
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-5">
        <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Nova mensagem
            </h2>
            <Badge tone={whatsappReady ? "success" : "neutral"}>
              {whatsappReady ? "WhatsApp online" : "WhatsApp offline"}
            </Badge>
            <Badge tone="neutral">{groups.length} grupo(s)</Badge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs text-zinc-500 dark:text-zinc-400">
              Título
              <Input
                className="mt-1"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Novidades do bot"
                maxLength={80}
              />
            </label>
            <label className="block text-xs text-zinc-500 dark:text-zinc-400">
              Versão (opcional)
              <Input
                className="mt-1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.4.0"
                maxLength={32}
              />
            </label>
          </div>

          <div className="block text-xs text-zinc-500 dark:text-zinc-400">
            <span className="mb-1.5 block">Corpo da mensagem</span>
            <ChangelogEditor value={body} onChange={setBody} maxLength={3500} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Grupos alvo
              </h3>
              <Button type="button" size="sm" variant="ghost" onClick={toggleAll}>
                {allSelected ? "Limpar" : "Todos"}
              </Button>
            </div>
            <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-zinc-100 p-2 dark:border-zinc-800">
              {groups.length === 0 ? (
                <li className="px-1 py-2 text-xs text-zinc-500">
                  Nenhum grupo na whitelist.
                </li>
              ) : (
                groups.map((g) => (
                  <li key={g.jid}>
                    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-zinc-300"
                        checked={selected.has(g.jid)}
                        onChange={() => toggleOne(g.jid)}
                      />
                      <span className="min-w-0 flex-1 truncate text-zinc-800 dark:text-zinc-100">
                        {g.name || "Grupo"}
                      </span>
                      <span className="truncate font-mono text-[10px] text-zinc-400">
                        {g.jid.replace("@g.us", "")}
                      </span>
                    </label>
                  </li>
                ))
              )}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || !body.trim() || selected.size === 0}
              onClick={() => void runPublish(true)}
            >
              Pré-visualizar
            </Button>
            <Button
              type="button"
              disabled={
                busy || !body.trim() || selected.size === 0 || !whatsappReady
              }
              onClick={() => {
                if (
                  !window.confirm(
                    `Enviar changelog para ${selected.size} grupo(s)?`
                  )
                ) {
                  return;
                }
                void runPublish(false);
              }}
            >
              {busy ? "Enviando…" : `Lançar em ${selected.size} grupo(s)`}
            </Button>
          </div>

          {!whatsappReady && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Sessão WhatsApp offline — dá pra pré-visualizar, mas o envio real
              só com o bot conectado.
            </p>
          )}
        </section>

        <section className="space-y-4 lg:col-span-2">
          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Prévia
            </h2>
            {preview ? (
              <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-800 dark:bg-zinc-950 dark:text-zinc-200">
                {preview}
              </pre>
            ) : (
              <p className="mt-3 text-xs text-zinc-500">
                Use Pré-visualizar para ver o texto final do zap.
              </p>
            )}
            {lastResult && (
              <div className="mt-3 space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                <div>
                  Resultado:{" "}
                  <strong className="text-zinc-900 dark:text-zinc-100">
                    {lastResult.okCount ?? 0} ok
                  </strong>
                  {" · "}
                  {lastResult.failCount ?? 0} falha
                  {lastResult.dryRun ? " · dry-run" : ""}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              Histórico
            </h2>
            <ul className="mt-3 max-h-[420px] space-y-3 overflow-y-auto">
              {history.length === 0 ? (
                <li className="text-xs text-zinc-500">Nenhum envio ainda.</li>
              ) : (
                history.map((h) => (
                  <li
                    key={h.id}
                    className="rounded-md border border-zinc-100 p-2.5 dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                        {h.title || "Changelog"}
                      </span>
                      {h.version ? (
                        <Badge tone="ink">v{h.version}</Badge>
                      ) : null}
                      {h.dryRun ? <Badge tone="neutral">preview</Badge> : null}
                    </div>
                    <div className="mt-1 text-[11px] text-zinc-500">
                      {new Date(h.createdAt).toLocaleString("pt-BR")} ·{" "}
                      {h.okCount}/{h.targetCount} ok
                    </div>
                    <p className="mt-1.5 line-clamp-3 text-xs text-zinc-600 dark:text-zinc-400">
                      {h.body}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </section>
      </div>
    </AppShell>
  );
}

export default function ChangelogPage() {
  return <ChangelogBody />;
}
