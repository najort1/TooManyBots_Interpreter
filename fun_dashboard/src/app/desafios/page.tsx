"use client";

import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { funApi } from "@/lib/api";
import type {
  DailyChallengeLaunchResult,
  DailyChallengeType,
} from "@/lib/types";

const CHALLENGES: Array<{
  type: DailyChallengeType;
  title: string;
  description: string;
}> = [
  {
    type: "guess_game",
    title: "Adivinhe o jogo",
    description: "Três dicas para descobrir um jogo.",
  },
  {
    type: "riddle",
    title: "Enigma",
    description: "Um enigma curto para o grupo resolver.",
  },
  {
    type: "pokemon",
    title: "Quem é esse Pokémon?",
    description: "Imagem em silhueta para adivinhar o Pokémon.",
  },
];

export default function DesafiosPage() {
  const [groups, setGroups] = useState(0);
  const [whatsappReady, setWhatsappReady] = useState(false);
  const [type, setType] = useState<DailyChallengeType>("guess_game");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DailyChallengeLaunchResult | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await funApi.changelog(1);
      setGroups(data.groups?.length || 0);
      setWhatsappReady(Boolean(data.whatsappReady));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const launch = async () => {
    if (!window.confirm(`Lançar este desafio e substituir o desafio ativo em todos os ${groups} grupo(s) da whitelist?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await funApi.launchDailyChallengeForWhitelist(type));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao lançar desafio");
    } finally {
      setBusy(false);
    }
  };

  const disabled = busy || loading || !whatsappReady || groups === 0;

  return (
    <AppShell
      title="Desafios"
      subtitle="Lance um desafio diário único para toda a whitelist"
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-5">
        <section className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Novo desafio diário</h2>
            <Badge tone={whatsappReady ? "success" : "neutral"}>
              {whatsappReady ? "WhatsApp online" : "WhatsApp offline"}
            </Badge>
            <Badge tone="neutral">{groups} grupo(s)</Badge>
          </div>

          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-300">
            O lançamento encerra silenciosamente e substitui qualquer desafio ativo em <strong>todos</strong> os grupos <code>@g.us</code> da whitelist.
          </div>

          <fieldset className="space-y-2">
            <legend className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Tipo de desafio</legend>
            {CHALLENGES.map((challenge) => (
              <label
                key={challenge.type}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-zinc-200 p-3 has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-50 dark:border-zinc-800 dark:has-[:checked]:border-zinc-200 dark:has-[:checked]:bg-zinc-800/60"
              >
                <input
                  type="radio"
                  name="challenge-type"
                  className="mt-0.5"
                  checked={type === challenge.type}
                  onChange={() => setType(challenge.type)}
                />
                <span>
                  <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-50">{challenge.title}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{challenge.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <Button type="button" disabled={disabled} onClick={() => void launch()}>
            {busy ? "Lançando…" : `Lançar em ${groups} grupo(s)`}
          </Button>
          {!whatsappReady ? <p className="text-xs text-amber-700 dark:text-amber-400">Conecte o WhatsApp para lançar o desafio.</p> : null}
          {groups === 0 ? <p className="text-xs text-amber-700 dark:text-amber-400">Nenhum grupo @g.us está na whitelist.</p> : null}
        </section>

        <section className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 lg:col-span-2">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Resultado do último lançamento</h2>
          {!result ? (
            <p className="mt-3 text-xs text-zinc-500">Ainda não houve lançamento nesta sessão.</p>
          ) : (
            <div className="mt-3 space-y-3 text-xs text-zinc-600 dark:text-zinc-400">
              <p><strong className="text-zinc-900 dark:text-zinc-100">{result.okCount ?? 0} ok</strong> · {result.failCount ?? 0} falha · {result.targetCount ?? 0} alvo(s)</p>
              {(result.results || []).filter((row) => !row.ok).length > 0 ? (
                <ul className="space-y-2">
                  {(result.results || []).filter((row) => !row.ok).map((row) => (
                    <li key={row.jid} className="rounded-md border border-red-100 bg-red-50 p-2 text-red-800 dark:border-red-950 dark:bg-red-950/30 dark:text-red-300">
                      <div className="font-mono text-[10px]">{row.jid}</div>
                      <div>{row.reason || "Falha ao lançar"}</div>
                    </li>
                  ))}
                </ul>
              ) : <p>Todos os grupos receberam o desafio.</p>}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}
