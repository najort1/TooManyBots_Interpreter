"use client";

import { useEffect, useMemo, useState } from "react";
import { funApi } from "@/lib/api";
import type { CommandCategory, CommandItem, GroupSettings } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
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
    personaEnabled: true,
    worldEventsEnabled: true,
    journalAutoEnabled: true,
    marketAutoEnabled: true,
    happyHourAutoEnabled: true,
    chaosAutoEnabled: true,
    weeklyRestockAutoEnabled: true,
    disabledCommands: [],
    permitirNsfw: false,
  });

  const [categories, setCategories] = useState<CommandCategory[]>([]);
  const [commands, setCommands] = useState<CommandItem[]>([]);
  const [defaultDisabled, setDefaultDisabled] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({});

  const [source, setSource] = useState<"override" | "defaults">("defaults");
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!groupJid) return;
    let cancelled = false;
    setLoading(true);
    setStatus("Carregando…");

    Promise.all([
      funApi.groupSettings(groupJid),
      funApi.commandCatalog().catch(() => ({
        categories: [],
        commands: [],
        defaultDisabled: [],
      })),
    ])
      .then(([data, catData]) => {
        if (cancelled) return;

        setCategories(catData.categories || []);
        setCommands(catData.commands || []);
        setDefaultDisabled(catData.defaultDisabled || []);

        const base = data.settings || data.defaults || {};
        const resolvedDisabled = Array.isArray(base.disabledCommands)
          ? base.disabledCommands
          : (catData.defaultDisabled || []);

        setForm({
          enabled: base.enabled !== false,
          xpMin: Number(base.xpMin ?? 15),
          xpMax: Number(base.xpMax ?? 25),
          cooldownMs: Number(base.cooldownMs ?? 60000),
          rankLimit: Number(base.rankLimit ?? 10),
          dailyXp: Number(base.dailyXp ?? 150),
          dailyCoins: Number(base.dailyCoins ?? 50),
          levelUpAnnounce: base.levelUpAnnounce !== false,
          personaEnabled: base.personaEnabled !== false,
          worldEventsEnabled: base.worldEventsEnabled !== false,
          journalAutoEnabled: base.journalAutoEnabled !== false,
          marketAutoEnabled: base.marketAutoEnabled !== false,
          happyHourAutoEnabled: base.happyHourAutoEnabled !== false,
          chaosAutoEnabled: base.chaosAutoEnabled !== false,
          weeklyRestockAutoEnabled: base.weeklyRestockAutoEnabled !== false,
          disabledCommands: resolvedDisabled,
          permitirNsfw: base.permitirNsfw === true,
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
        personaEnabled: form.personaEnabled !== false,
        worldEventsEnabled: form.worldEventsEnabled !== false,
        journalAutoEnabled: form.journalAutoEnabled !== false,
        marketAutoEnabled: form.marketAutoEnabled !== false,
        happyHourAutoEnabled: form.happyHourAutoEnabled !== false,
        chaosAutoEnabled: form.chaosAutoEnabled !== false,
        weeklyRestockAutoEnabled: form.weeklyRestockAutoEnabled !== false,
        disabledCommands: form.disabledCommands || [],
        permitirNsfw: form.permitirNsfw === true,
      });
      setSource("override");
      setStatus("Salvo com sucesso.");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Falha ao salvar");
    }
  }

  function field<K extends keyof GroupSettings>(key: K, value: GroupSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const disabledSet = useMemo(() => {
    return new Set(form.disabledCommands || []);
  }, [form.disabledCommands]);

  function isCommandEnabled(cmdId: string) {
    return !disabledSet.has(cmdId);
  }

  function toggleCommand(cmdId: string, enable: boolean) {
    setForm((prev) => {
      const current = new Set(prev.disabledCommands || []);
      if (enable) {
        current.delete(cmdId);
      } else {
        current.add(cmdId);
      }
      return {
        ...prev,
        disabledCommands: Array.from(current),
      };
    });
  }

  function enableAllCommands() {
    setForm((prev) => ({
      ...prev,
      disabledCommands: [],
    }));
  }

  function disableAllCommands() {
    setForm((prev) => ({
      ...prev,
      disabledCommands: commands.map((c) => c.id),
    }));
  }

  function resetToDefaults() {
    setForm((prev) => ({
      ...prev,
      disabledCommands: [...defaultDisabled],
      permitirNsfw: false,
    }));
  }

  function toggleCategory(catId: string, enable: boolean) {
    const catCmds = commands.filter((c) => c.category === catId).map((c) => c.id);
    setForm((prev) => {
      const current = new Set(prev.disabledCommands || []);
      for (const id of catCmds) {
        if (enable) {
          current.delete(id);
        } else {
          current.add(id);
        }
      }
      return {
        ...prev,
        disabledCommands: Array.from(current),
      };
    });
  }

  function toggleCategoryCollapse(catId: string) {
    setCollapsedCategories((prev) => ({
      ...prev,
      [catId]: !prev[catId],
    }));
  }

  const filteredCommands = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return commands.filter((cmd) => {
      if (selectedCategory !== "all" && cmd.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      const matchName = cmd.name.toLowerCase().includes(q);
      const matchDesc = cmd.description.toLowerCase().includes(q);
      const matchId = cmd.id.toLowerCase().includes(q);
      const matchExamples = cmd.examples.some((ex) => ex.toLowerCase().includes(q));
      return matchName || matchDesc || matchId || matchExamples;
    });
  }, [commands, searchQuery, selectedCategory]);

  const totalCommandsCount = commands.length;
  const enabledCommandsCount = commands.filter((c) => !disabledSet.has(c.id)).length;
  const disabledCommandsCount = totalCommandsCount - enabledCommandsCount;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 p-4">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Settings do grupo</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Sobrescreve XP, cooldown, daily, comandos habilitados e eventos do mundo neste grupo.
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
          Persona (membro vivo)
          <Select
            className="mt-1"
            value={form.personaEnabled === false ? "0" : "1"}
            onChange={(e) => field("personaEnabled", e.target.value === "1")}
            disabled={loading}
          >
            <option value="1">Ligado</option>
            <option value="0">Desligado</option>
          </Select>
          <span className="mt-1 block text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
            Faz o bot responder como membro quando citado por &quot;bot&quot; ou @.
          </span>
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

      {/* Seção de Controle Granular de Comandos */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                Controle de Comandos & Funções do Bot
              </h3>
              <Badge tone={disabledCommandsCount === 0 ? "success" : enabledCommandsCount === 0 ? "danger" : "warn"}>
                {enabledCommandsCount}/{totalCommandsCount} ativos
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              Controle tudo o que pode ou não ser usado neste grupo. Ao desativar, o bot responde com a mensagem genérica.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={enableAllCommands}
              disabled={loading}
              title="Habilita todos os comandos do bot neste grupo"
            >
              Ativar Todos
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={disableAllCommands}
              disabled={loading}
              title="Desativa todos os comandos do bot neste grupo"
            >
              Desativar Todos
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={resetToDefaults}
              disabled={loading}
              title="Restaura a configuração padrão (tudo liberado exceto NSFW)"
            >
              Padrão
            </Button>
          </div>
        </div>

        {/* Card Informativo com a mensagem genérica exibida no WhatsApp */}
        <div className="rounded-md border border-zinc-200 bg-zinc-50/70 p-3 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
          <div className="flex items-start gap-2.5">
            <span className="text-base">💬</span>
            <div className="space-y-1">
              <p className="font-medium text-zinc-800 dark:text-zinc-200">
                Mensagem de resposta quando desabilitado:
              </p>
              <div className="rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-[11px] text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">
                &quot;este comando não foi habilitado para este grupo&quot;
              </div>
            </div>
          </div>
        </div>

        {/* Card Informativo sobre NSFW */}
        <div className="rounded-md border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300">
          <div className="flex items-start gap-2.5">
            <span className="text-base">🔞</span>
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-amber-950 dark:text-amber-200">
                  Regra de Proteção Adulta (NSFW)
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-medium">
                    Status no grupo: {form.permitirNsfw ? "Liberado" : "Bloqueado"}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.permitirNsfw ? "secondary" : "primary"}
                    onClick={() => field("permitirNsfw", !form.permitirNsfw)}
                    disabled={loading}
                    className="h-6 px-2 text-[11px]"
                  >
                    {form.permitirNsfw ? "Bloquear NSFW" : "Forçar Liberação"}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed opacity-90">
                Por padrão, todo conteúdo NSFW vem <strong>desabilitado</strong>. Para utilizá-lo no WhatsApp,
                os usuários precisam enviar o comando <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-amber-950 dark:bg-amber-900/60 dark:text-amber-200">/force_nsfw</code> no grupo
                (ou você pode forçar a liberação pelo botão acima). Se qualquer comando NSFW estiver desativado na lista abaixo, ele será bloqueado com a mensagem de não habilitado.
              </p>
            </div>
          </div>
        </div>

        {/* Barra de Busca e Filtro por Categoria */}
        <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Input
              type="search"
              placeholder="Buscar comando... (ex: /roleta, xp, daily, kiss)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={loading}
              className="h-8 text-xs"
            />
          </div>
          <div className="sm:w-56">
            <Select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              disabled={loading}
              className="h-8 text-xs"
            >
              <option value="all">Todas as categorias ({commands.length})</option>
              {categories.map((cat) => {
                const count = commands.filter((c) => c.category === cat.id).length;
                return (
                  <option key={cat.id} value={cat.id}>
                    {cat.emoji} {cat.name} ({count})
                  </option>
                );
              })}
            </Select>
          </div>
        </div>

        {/* Lista de Categorias e Comandos */}
        <div className="space-y-3 pt-2">
          {categories
            .filter((cat) => {
              if (selectedCategory !== "all" && cat.id !== selectedCategory) return false;
              const catCmds = filteredCommands.filter((c) => c.category === cat.id);
              return catCmds.length > 0;
            })
            .map((cat) => {
              const catCmds = filteredCommands.filter((c) => c.category === cat.id);
              const isCollapsed = Boolean(collapsedCategories[cat.id]);
              const catEnabledCount = catCmds.filter((c) => !disabledSet.has(c.id)).length;
              const allCategoryEnabled = catEnabledCount === catCmds.length;

              return (
                <div
                  key={cat.id}
                  className="rounded-lg border border-zinc-200 bg-zinc-50/40 dark:border-zinc-800 dark:bg-zinc-900/40 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                    <button
                      type="button"
                      onClick={() => toggleCategoryCollapse(cat.id)}
                      className="flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
                    >
                      <span className="text-base">{cat.emoji}</span>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-50">
                            {cat.name}
                          </span>
                          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                            {isCollapsed ? "▸ expandir" : "▾ recolher"}
                          </span>
                        </div>
                        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                          {cat.description}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-2">
                      <Badge
                        tone={
                          catEnabledCount === catCmds.length
                            ? "success"
                            : catEnabledCount === 0
                              ? "danger"
                              : "warn"
                        }
                      >
                        {catEnabledCount}/{catCmds.length} ativos
                      </Badge>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => toggleCategory(cat.id, !allCategoryEnabled)}
                        disabled={loading}
                        className="h-7 text-[11px] px-2"
                      >
                        {allCategoryEnabled ? "Desativar Todos" : "Ativar Todos"}
                      </Button>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {catCmds.map((cmd) => {
                        const enabled = isCommandEnabled(cmd.id);
                        return (
                          <div
                            key={cmd.id}
                            className={`flex flex-col justify-between rounded-md border p-2.5 transition-colors ${
                              enabled
                                ? "border-emerald-200 bg-white dark:border-emerald-900/40 dark:bg-zinc-900"
                                : "border-zinc-200 bg-zinc-100/60 opacity-75 dark:border-zinc-800 dark:bg-zinc-900/20"
                            }`}
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                                      {cmd.name}
                                    </span>
                                    {cmd.isNsfw && (
                                      <Badge tone="danger" className="text-[9px] px-1 py-0">
                                        NSFW
                                      </Badge>
                                    )}
                                  </div>
                                  <div className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
                                    {cmd.examples.join(", ")}
                                  </div>
                                </div>

                                <label className="relative inline-flex items-center cursor-pointer">
                                  <input
                                    type="checkbox"
                                    className="sr-only peer"
                                    checked={enabled}
                                    disabled={loading}
                                    onChange={(e) => toggleCommand(cmd.id, e.target.checked)}
                                  />
                                  <div className="w-9 h-5 bg-zinc-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:bg-zinc-700 dark:after:border-zinc-600 peer-checked:bg-emerald-600" />
                                </label>
                              </div>

                              <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                                {cmd.description}
                              </p>
                            </div>

                            <div className="mt-2 pt-1.5 border-t border-zinc-100 dark:border-zinc-800/60 flex items-center justify-between text-[10px]">
                              <span
                                className={
                                  enabled
                                    ? "text-emerald-600 dark:text-emerald-400 font-medium"
                                    : "text-zinc-400 dark:text-zinc-500"
                                }
                              >
                                {enabled ? "● Habilitado" : "○ Desabilitado"}
                              </span>
                              {!enabled && (
                                <span className="text-zinc-400 italic">
                                  Bloqueado no grupo
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>

      <hr className="my-4 border-zinc-100 dark:border-zinc-800" />

      {/* Eventos Autônomos */}
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

      <hr className="my-4 border-zinc-100 dark:border-zinc-800" />

      {/* Ações Manuais */}
      <div className="space-y-1.5">
        <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          Ações Manuais
        </h3>
        <p className="mb-3 text-[11px] leading-snug text-zinc-400 dark:text-zinc-500">
          Forçar disparo de eventos (bloqueia o disparo automático no resto do dia).
        </p>

        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              if (
                !confirm(
                  "Tem certeza que deseja iniciar a PURGA neste grupo agora? Isso ignorará o horário configurado."
                )
              )
                return;
              try {
                setStatus("Disparando PURGA...");
                const res = await funApi.triggerChaosEvent(groupJid);
                if (res.ok) {
                  setStatus("PURGA disparada com sucesso!");
                } else {
                  setStatus("Falha ao disparar PURGA.");
                }
              } catch (err) {
                setStatus(err instanceof Error ? err.message : "Erro ao disparar");
              }
            }}
            disabled={loading || !groupJid}
          >
            Disparar PURGA Manualmente
          </Button>
        </div>
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
