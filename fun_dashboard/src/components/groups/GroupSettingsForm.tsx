"use client";

import { useEffect, useState } from "react";
import { funApi } from "@/lib/api";
import type { GroupSettings } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

type Props = {
  groupJid: string;
};

export function GroupSettingsForm({ groupJid }: Props) {
  const [form, setForm] = useState<GroupSettings>({
    enabled: true,
    xpMin: 15,
    xpMax: 25,
    cooldownMs: 60000,
    rankLimit: 10,
    dailyXp: 150,
    dailyCoins: 50,
    levelUpAnnounce: true,
    worldEventsEnabled: true,
    journalAutoEnabled: true,
    marketAutoEnabled: true,
    happyHourAutoEnabled: true,
    chaosAutoEnabled: true,
    weeklyRestockAutoEnabled: true,
  });
  const [source, setSource] = useState<"override" | "defaults">("defaults");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!groupJid) return;
    let cancelled = false;
    setLoading(true);
    setStatus("Carregando…");
    funApi
      .groupSettings(groupJid)
      .then((data) => {
        if (cancelled) return;
        const base = data.settings || data.defaults || {};
        setForm({
          enabled: base.enabled !== false,
          xpMin: Number(base.xpMin ?? 15),
          xpMax: Number(base.xpMax ?? 25),
          cooldownMs: Number(base.cooldownMs ?? 60000),
          rankLimit: Number(base.rankLimit ?? 10),
          dailyXp: Number(base.dailyXp ?? 150),
          dailyCoins: Number(base.dailyCoins ?? 50),
          levelUpAnnounce: base.levelUpAnnounce !== false,
          worldEventsEnabled: base.worldEventsEnabled !== false,
          journalAutoEnabled: base.journalAutoEnabled !== false,
          marketAutoEnabled: base.marketAutoEnabled !== false,
          happyHourAutoEnabled: base.happyHourAutoEnabled !== false,
          chaosAutoEnabled: base.chaosAutoEnabled !== false,
          weeklyRestockAutoEnabled: base.weeklyRestockAutoEnabled !== false,
        });
        setSource(data.settings ? "override" : "defaults");
        setStatus(data.settings ? "Override do grupo" : "Defaults (sem override)");
      })
      .catch((err) => {
        if (!cancelled) setStatus(err instanceof Error ? err.message : "Erro");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupJid]);

  async function save() {
    if (!groupJid) return;
    setStatus("Salvando…");
    try {
      await funApi.saveGroupSettings(groupJid, {
        ...form,
        levelUpAnnounce: form.levelUpAnnounce !== false,
        worldEventsEnabled: form.worldEventsEnabled !== false,
        journalAutoEnabled: form.journalAutoEnabled !== false,
        marketAutoEnabled: form.marketAutoEnabled !== false,
        happyHourAutoEnabled: form.happyHourAutoEnabled !== false,
        chaosAutoEnabled: form.chaosAutoEnabled !== false,
        weeklyRestockAutoEnabled: form.weeklyRestockAutoEnabled !== false,
      });
      setSource("override");
      setStatus("Salvo.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao salvar");
    }
  }

  function field<K extends keyof GroupSettings>(key: K, value: GroupSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Settings do grupo</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Sobrescreve XP, cooldown, daily e eventos do mundo neste grupo.
          </p>
        </div>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
          {source === "override" ? "override" : "defaults"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Ativo
          <Select
            className="mt-1"
            value={form.enabled === false ? "0" : "1"}
            onChange={(e) => field("enabled", e.target.value === "1")}
            disabled={loading}
          >
            <option value="1">Sim</option>
            <option value="0">Não</option>
          </Select>
        </label>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Eventos do mundo
          <Select
            className="mt-1"
            value={form.worldEventsEnabled === false ? "0" : "1"}
            onChange={(e) => field("worldEventsEnabled", e.target.value === "1")}
            disabled={loading}
          >
            <option value="1">Ligado</option>
            <option value="0">Desligado</option>
          </Select>
          <span className="mt-1 block text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
            Fallback global para eventos. Controle granular abaixo.
          </span>
        </label>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Rank limit
          <Input
            className="mt-1"
            type="number"
            value={form.rankLimit ?? 10}
            onChange={(e) => field("rankLimit", Number(e.target.value))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          XP min
          <Input
            className="mt-1"
            type="number"
            value={form.xpMin ?? 15}
            onChange={(e) => field("xpMin", Number(e.target.value))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          XP max
          <Input
            className="mt-1"
            type="number"
            value={form.xpMax ?? 25}
            onChange={(e) => field("xpMax", Number(e.target.value))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Cooldown (ms)
          <Input
            className="mt-1"
            type="number"
            value={form.cooldownMs ?? 60000}
            onChange={(e) => field("cooldownMs", Number(e.target.value))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Daily XP
          <Input
            className="mt-1"
            type="number"
            value={form.dailyXp ?? 150}
            onChange={(e) => field("dailyXp", Number(e.target.value))}
            disabled={loading}
          />
        </label>
        <label className="block text-xs text-zinc-500 dark:text-zinc-400">
          Daily coins
          <Input
            className="mt-1"
            type="number"
            value={form.dailyCoins ?? 50}
            onChange={(e) => field("dailyCoins", Number(e.target.value))}
            disabled={loading}
          />
        </label>
      </div>

      <hr className="my-4 border-zinc-100 dark:border-zinc-800" />

      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          Eventos autônomos
        </h3>
        <p className="mb-2 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
          Controle granular de cada tipo de evento automático do relógio do mundo.
        </p>

        <CheckboxField
          label="Jornal diário (~23:59)"
          checked={form.journalAutoEnabled !== false}
          disabled={loading}
          onChange={(v) => field("journalAutoEnabled", v)}
        />
        <CheckboxField
          label="Mercado de rua"
          checked={form.marketAutoEnabled !== false}
          disabled={loading}
          onChange={(v) => field("marketAutoEnabled", v)}
        />
        <CheckboxField
          label="Happy hour do cassino"
          checked={form.happyHourAutoEnabled !== false}
          disabled={loading}
          onChange={(v) => field("happyHourAutoEnabled", v)}
        />
        <CheckboxField
          label="PURGA / caos"
          checked={form.chaosAutoEnabled !== false}
          disabled={loading}
          onChange={(v) => field("chaosAutoEnabled", v)}
        />
        <CheckboxField
          label="Reposição semanal de estoque"
          checked={form.weeklyRestockAutoEnabled !== false}
          disabled={loading}
          onChange={(v) => field("weeklyRestockAutoEnabled", v)}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => void save()} disabled={loading || !groupJid}>
          Salvar
        </Button>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{status}</span>
      </div>
    </div>
  );
}

function CheckboxField({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded px-1 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-500"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="text-sm text-zinc-900 dark:text-zinc-50">{label}</span>
    </label>
  );
}
