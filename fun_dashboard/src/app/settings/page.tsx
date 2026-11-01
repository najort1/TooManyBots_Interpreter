"use client";

import { useState } from "react";
import Link from "next/link";
import { Sparkles, Cpu, Zap, ZapOff } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ErrorCard } from "@/components/ui/states";
import { KeyValue } from "@/components/ui/kv";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useApiQuery } from "@/hooks/useApiQuery";
import { funApi } from "@/lib/api";
import { formatMs, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

function SettingsBody() {
  const {
    data,
    loading,
    refreshing,
    error,
    reload,
  } = useApiQuery(
    () =>
      Promise.all([funApi.config(), funApi.outbound()]).then(([c, o]) => ({
        cfg: c,
        outbound: o,
      })),
    []
  );

  const cfg = data?.cfg ?? null;
  const outbound = data?.outbound ?? null;
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const toggleQmpAutoTrigger = async (enabled: boolean) => {
    if (!cfg) return;
    setSaving("qmp");
    setSaveError(null);
    try {
      await funApi.config(); // ensure we have latest
      await funApi.updateConfig({
        qmpAutoTriggerChance: enabled ? 0.02 : 0,
      });
      void reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSaving(null);
    }
  };

  return (
    <AppShell
      title="Config"
      subtitle="Leitura da config do bot (edição fina continua no JSON / wizard)"
      onRefresh={() => void reload()}
      refreshing={refreshing}
      status={error?.message ?? saveError}
    >
      {error && !cfg ? (
        <ErrorCard message={error.message} onRetry={() => void reload()} />
      ) : loading && !cfg ? (
        <SettingsSkeleton />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Section title="Economia & XP">
            <KeyValue label="Prefix">{cfg?.prefix || "/"}</KeyValue>
            <KeyValue label="XP">{`${cfg?.xpMin ?? "—"}–${cfg?.xpMax ?? "—"}`}</KeyValue>
            <KeyValue label="Cooldown">{formatMs(cfg?.cooldownMs)}</KeyValue>
            <KeyValue label="Daily">{`${cfg?.dailyXp ?? "—"} XP · ${cfg?.dailyCoins ?? "—"} coins`}</KeyValue>
            <KeyValue label="Rank limit">{String(cfg?.rankLimit ?? "—")}</KeyValue>
          </Section>

          <Section title="Canais">
            <KeyValue label="DM">{cfg?.allowDm ? "liberado" : "bloqueado"}</KeyValue>
            <KeyValue label="Cmd privado">
              {cfg?.replyCommandsInPrivate ? "sim (com exceções)" : "não"}
            </KeyValue>
            <KeyValue label="Marcar usuários (@)">
              {cfg?.mentionUsers === false ? "desligado" : "ligado"}
            </KeyValue>
            <KeyValue label="Citar mensagem (reply)">
              {cfg?.replyQuoted === false ? "desligado" : "ligado"}
            </KeyValue>
            <KeyValue label="Whitelist">
              {`${cfg?.groupWhitelistJids?.length ?? 0} grupo(s)`}
            </KeyValue>
            <div className="mt-2 flex flex-wrap gap-1">
              <Badge tone={cfg?.zenEnabled ? "success" : "neutral"}>Zen</Badge>
              <Badge tone={cfg?.ollamaEnabled ? "success" : "neutral"}>Ollama</Badge>
              <Badge tone={cfg?.tarotEnabled ? "success" : "neutral"}>Tarot</Badge>
            </div>
          </Section>

          <Section title="LLM">
            <KeyValue label="Zen URL" mono>
              {cfg?.zenBaseUrl || "—"}
            </KeyValue>
            <KeyValue label="Zen model" mono>
              {cfg?.zenModel || "—"}
            </KeyValue>
            <KeyValue label="Ollama model" mono>
              {cfg?.ollamaModel || "—"}
            </KeyValue>
            <KeyValue label="Tarot CD">{formatMs(cfg?.tarotCooldownMs)}</KeyValue>
            <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
              <Link
                href="/llm"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Abrir Painel de Controle de IA & LLM →
              </Link>
              <Link
                href="/modelos"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              >
                <Cpu className="h-3.5 w-3.5" />
                Configurar Modelos por Função →
              </Link>
            </div>
          </Section>

          <Section title="Cassino / Bingo">
            <KeyValue label="Cassino">{`${cfg?.casinoMin ?? "—"}–${cfg?.casinoMax ?? "—"}`}</KeyValue>
            <KeyValue label="Bingo">{`${cfg?.bingoMin ?? "—"}–${cfg?.bingoMax ?? "—"}`}</KeyValue>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Bingo clássico removido (flood). Só modo rápido.
            </p>
          </Section>

          <Section title="QMP (Quem é Mais Provável)">
            <KeyValue label="Habilitado">{cfg?.qmpEnabled ? "sim" : "não"}</KeyValue>
            <KeyValue label="QMP Surpresa (auto-trigger)">
              {cfg?.qmpAutoTriggerChance !== undefined && cfg?.qmpAutoTriggerChance > 0
                ? `${Math.round((cfg.qmpAutoTriggerChance ?? 0) * 100)}% por mensagem`
                : "desligado"}
            </KeyValue>
            <KeyValue label="Cooldown auto-trigger">
              {formatMs(cfg?.qmpAutoTriggerCooldownMs)}
            </KeyValue>
            <KeyValue label="Duração da rodada">{formatMs(cfg?.qmpRoundDurationMs)}</KeyValue>
            <KeyValue label="Cooldown por usuário">{formatMs(cfg?.qmpCooldownMs)}</KeyValue>
            <KeyValue label="Modo pesado">
              {cfg?.qmpHeavyEnabled ? `a cada ${cfg?.qmpHeavyEvery ?? 5} rodadas` : "desligado"}
            </KeyValue>
            <div className="mt-3 pt-2 border-t border-zinc-100 dark:border-zinc-800">
              <div className="flex items-center gap-2">
                <Switch
                  aria-label="QMP Surpresa (auto-trigger) — dispara perguntas automaticamente"
                  checked={
                    cfg?.qmpAutoTriggerChance !== undefined && cfg?.qmpAutoTriggerChance > 0
                  }
                  onCheckedChange={(checked) => void toggleQmpAutoTrigger(checked)}
                  disabled={saving === "qmp" || !cfg}
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
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Quando ativo, o bot dispara perguntas &ldquo;Quem &eacute; Mais
                Prov&aacute;vel?&rdquo; automaticamente com baixa chance (~2%) a cada mensagem do
                grupo. Desative para evitar surpresas.
              </p>
            </div>
          </Section>

          <Section title="Outbound guard" className="lg:col-span-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <KeyValue label="Último min">
                {`${outbound?.globalLastMinute ?? 0} / ${String(outbound?.config?.maxPerMinute ?? "—")}`}
              </KeyValue>
              <KeyValue label="Última hora">
                {`${outbound?.globalLastHour ?? 0} / ${String(outbound?.config?.maxPerHour ?? "—")}`}
              </KeyValue>
              <KeyValue label="Drops">{formatNumber(outbound?.dropped ?? 0)}</KeyValue>
            </div>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              Env: <code className="text-[11px]">TMB_OUTBOUND_*</code> no processo do bot.
            </p>
          </Section>
        </div>
      )}
    </AppShell>
  );
}

function SettingsSkeleton() {
  return (
    <div
      className="grid gap-4 lg:grid-cols-2"
      aria-busy="true"
    >
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className={cn("p-4", i === 5 && "lg:col-span-2")}>
          <Skeleton className="h-4 w-32" />
          <div className="mt-3 space-y-2">
            {Array.from({ length: 4 }).map((_, j) => (
              <Skeleton key={j} className="h-4 w-full" />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("p-4", className)}>
      <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
      <div className="space-y-1.5">{children}</div>
    </Card>
  );
}

export default function SettingsPage() {
  return <SettingsBody />;
}
