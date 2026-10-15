"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, Zap, ZapOff } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { funApi } from "@/lib/api";
import { formatMs, formatNumber } from "@/lib/format";
import type { FunConfig } from "@/lib/types";

function SettingsBody() {
  const [cfg, setCfg] = useState<FunConfig | null>(null);
  const [outbound, setOutbound] = useState<{
    globalLastMinute: number;
    globalLastHour: number;
    dropped: number;
    config?: Record<string, unknown>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [c, o] = await Promise.all([funApi.config(), funApi.outbound()]);
      setCfg(c);
      setOutbound(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleQmpAutoTrigger = async (enabled: boolean) => {
    if (!cfg) return;
    setSaving("qmp");
    try {
      await funApi.config(); // ensure we have latest
      const res = await fetch("/api/fun/config", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qmpAutoTriggerChance: enabled ? 0.02 : 0,
        }),
      });
      if (!res.ok) throw new Error("Falha ao atualizar");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(null);
    }
  };

  return (
    <AppShell
      title="Config"
      subtitle="Leitura da config do bot (edição fina continua no JSON / wizard)"
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-2">
        <Section title="Economia & XP">
          <KV k="Prefix" v={cfg?.prefix || "/"} />
          <KV k="XP" v={`${cfg?.xpMin ?? "—"}–${cfg?.xpMax ?? "—"}`} />
          <KV k="Cooldown" v={formatMs(cfg?.cooldownMs)} />
          <KV k="Daily" v={`${cfg?.dailyXp ?? "—"} XP · ${cfg?.dailyCoins ?? "—"} coins`} />
          <KV k="Rank limit" v={String(cfg?.rankLimit ?? "—")} />
        </Section>

        <Section title="Canais">
          <KV k="DM" v={cfg?.allowDm ? "liberado" : "bloqueado"} />
          <KV
            k="Cmd privado"
            v={cfg?.replyCommandsInPrivate ? "sim (com exceções)" : "não"}
          />
          <KV
            k="Marcar usuários (@)"
            v={cfg?.mentionUsers === false ? "desligado" : "ligado"}
          />
          <KV
            k="Citar mensagem (reply)"
            v={cfg?.replyQuoted === false ? "desligado" : "ligado"}
          />
          <KV k="Whitelist" v={`${cfg?.groupWhitelistJids?.length ?? 0} grupo(s)`} />
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge tone={cfg?.zenEnabled ? "success" : "neutral"}>Zen</Badge>
            <Badge tone={cfg?.ollamaEnabled ? "success" : "neutral"}>Ollama</Badge>
            <Badge tone={cfg?.tarotEnabled ? "ink" : "neutral"}>Tarot</Badge>
          </div>
        </Section>

        <Section title="LLM">
          <KV k="Zen URL" v={cfg?.zenBaseUrl || "—"} mono />
          <KV k="Zen model" v={cfg?.zenModel || "—"} mono />
          <KV k="Ollama model" v={cfg?.ollamaModel || "—"} mono />
          <KV k="Tarot CD" v={formatMs(cfg?.tarotCooldownMs)} />
          <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <Link
              href="/llm"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Abrir Painel de Controle de IA & LLM →
            </Link>
          </div>
        </Section>

        <Section title="Cassino / Bingo">
          <KV k="Cassino" v={`${cfg?.casinoMin ?? "—"}–${cfg?.casinoMax ?? "—"}`} />
          <KV k="Bingo" v={`${cfg?.bingoMin ?? "—"}–${cfg?.bingoMax ?? "—"}`} />
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Bingo clássico removido (flood). Só modo rápido.
          </p>
        </Section>

        <Section title="QMP (Quem é Mais Provável)">
          <KV
            k="Habilitado"
            v={cfg?.qmpEnabled ? "sim" : "não"}
          />
          <KV
            k="QMP Surpresa (auto-trigger)"
            v={
              cfg?.qmpAutoTriggerChance !== undefined && cfg?.qmpAutoTriggerChance > 0
                ? `${Math.round((cfg.qmpAutoTriggerChance ?? 0) * 100)}% por mensagem`
                : "desligado"
            }
          />
          <KV
            k="Cooldown auto-trigger"
            v={formatMs(cfg?.qmpAutoTriggerCooldownMs)}
          />
          <KV k="Duração da rodada" v={formatMs(cfg?.qmpRoundDurationMs)} />
          <KV k="Cooldown por usuário" v={formatMs(cfg?.qmpCooldownMs)} />
          <KV
            k="Modo pesado"
            v={cfg?.qmpHeavyEnabled ? `a cada ${cfg?.qmpHeavyEvery ?? 5} rodadas` : "desligado"}
          />
          <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg?.qmpAutoTriggerChance !== undefined && cfg?.qmpAutoTriggerChance > 0}
                onChange={(e) => toggleQmpAutoTrigger(e.target.checked)}
                disabled={saving === "qmp"}
                className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span className="text-sm text-zinc-900 dark:text-zinc-50">
                {cfg?.qmpAutoTriggerChance && cfg?.qmpAutoTriggerChance > 0 ? (
                  <>
                    <Zap className="h-4 w-4 text-emerald-600" />
                    QMP Surpresa ativo &mdash; desativar
                  </>
                ) : (
                  <>
                    <ZapOff className="h-4 w-4 text-zinc-500" />
                    QMP Surpresa desativado &mdash; ativar (2% padr&atilde;o)
                  </>
                )}
              </span>
            </label>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Quando ativo, o bot dispara perguntas &ldquo;Quem &eacute; Mais Prov&aacute;vel?&rdquo; automaticamente
              com baixa chance (~2%) a cada mensagem do grupo. Desative para evitar surpresas.
            </p>
          </div>
        </Section>

        <Section title="Outbound guard" className="lg:col-span-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <KV
              k="Último min"
              v={`${outbound?.globalLastMinute ?? 0} / ${String(outbound?.config?.maxPerMinute ?? "—")}`}
            />
            <KV
              k="Última hora"
              v={`${outbound?.globalLastHour ?? 0} / ${String(outbound?.config?.maxPerHour ?? "—")}`}
            />
            <KV k="Drops" v={formatNumber(outbound?.dropped ?? 0)} />
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            Env: <code className="text-[11px]">TMB_OUTBOUND_*</code> no processo do bot.
          </p>
        </Section>
      </div>
    </AppShell>
  );
}

function Section({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4 ${className}`}
    >
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function KV({
  k,
  v,
  mono,
}: {
  k: string;
  v: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-zinc-50 dark:border-zinc-800 py-1.5 last:border-0">
      <span className="text-xs text-zinc-500">{k}</span>
      <span
        className={`max-w-[60%] text-right text-sm text-zinc-900 dark:text-zinc-50 ${
          mono ? "truncate font-mono text-xs" : "font-medium"
        }`}
      >
        {v}
      </span>
    </div>
  );
}

export default function SettingsPage() {
  return <SettingsBody />;
}
