"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Bot,
  Brain,
  Gamepad2,
  Users,
  Settings2,
  CheckCircle2,
  RotateCw,
  Search,
  ZapOff,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { funApi } from "@/lib/api";
import type { LlmConfigResponse, LlmFeatureItem } from "@/lib/types";

export default function LlmPage() {
  const [config, setConfig] = useState<LlmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await funApi.llmConfig();
      setConfig(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar configurações de LLM");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateConfig = async (patch: { zenEnabled?: boolean; llmFeatures?: Record<string, boolean> }) => {
    if (!config) return;
    const prev = config;

    // Atualização otimista local
    const nextMaster = patch.zenEnabled !== undefined ? patch.zenEnabled : config.zenEnabled;
    const nextFeatures = {
      ...config.llmFeatures,
      ...(patch.llmFeatures || {}),
    };
    const nextItems = config.items.map((item) => {
      const isEnabled = nextFeatures[item.id] !== undefined ? nextFeatures[item.id] : item.enabled;
      return {
        ...item,
        enabled: isEnabled,
        active: nextMaster && isEnabled,
      };
    });

    setConfig({
      ...config,
      zenEnabled: nextMaster,
      masterEnabled: nextMaster,
      llmFeatures: nextFeatures,
      items: nextItems,
    });

    setSaving(true);
    setSaveSuccess(false);
    setError(null);

    try {
      const res = await funApi.updateLlmConfig(patch);
      setConfig(res);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      // Rollback se falhar
      setConfig(prev);
      setError(err instanceof Error ? err.message : "Falha ao persistir alteração");
    } finally {
      setSaving(false);
    }
  };

  const handleMasterToggle = (checked: boolean) => {
    void updateConfig({ zenEnabled: checked });
  };

  const handleFeatureToggle = (featureId: string, checked: boolean) => {
    void updateConfig({
      llmFeatures: {
        [featureId]: checked,
      },
    });
  };

  const handleToggleAll = (targetState: boolean) => {
    if (!config) return;
    const nextFeatures: Record<string, boolean> = {};
    for (const item of config.items) {
      nextFeatures[item.id] = targetState;
    }
    void updateConfig({ llmFeatures: nextFeatures });
  };

  const categories = useMemo(() => {
    if (!config?.items) return [];
    const set = new Set<string>();
    for (const item of config.items) {
      set.add(item.category);
    }
    return Array.from(set);
  }, [config?.items]);

  const filteredItems = useMemo(() => {
    if (!config?.items) return [];
    return config.items.filter((item) => {
      const matchesSearch =
        search.trim() === "" ||
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.description.toLowerCase().includes(search.toLowerCase()) ||
        item.fallback.toLowerCase().includes(search.toLowerCase());
      const matchesCategory =
        selectedCategory === "all" || item.category === selectedCategory;
      return matchesSearch && matchesCategory;
    });
  }, [config?.items, search, selectedCategory]);

  const masterOn = config?.zenEnabled !== false;

  return (
    <AppShell
      title="IA & Modelos de Linguagem"
      subtitle="Controle central de ativação e fallbacks das funcionalidades com LLM do bot Fun"
      onRefresh={() => void load()}
      refreshing={loading}
      status={error}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Banner de Feedback de Salvamento */}
        {saveSuccess && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            Configuração sincronizada e aplicada imediatamente no bot em tempo real!
          </div>
        )}

        {/* Hero Card: Master Switch */}
        <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl transition-colors ${
                  masterOn
                    ? "bg-emerald-600/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                    : "bg-amber-600/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                }`}
              >
                {masterOn ? <Sparkles className="h-6 w-6" /> : <ZapOff className="h-6 w-6" />}
              </div>
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                    Master Switch: LLM Global
                  </h2>
                  <Badge tone={masterOn ? "success" : "warn"}>
                    {masterOn ? "ONLINE (Zen Ativo)" : "MODO ECONÔMICO (Offline / Templates)"}
                  </Badge>
                  {saving && (
                    <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                      <RotateCw className="h-3 w-3 animate-spin" />
                      Gravando...
                    </span>
                  )}
                </div>
                <p className="max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
                  {masterOn
                    ? "O LLM está ativo. As funções abaixo geram conteúdos inteligentes e dinâmicos via OpenCode Zen / OpenAI."
                    : "O LLM está desligado globalmente. NENHUMA chamada externa de IA é feita. Todas as funções usam templates estáticos e bancos locais instantâneos (zero latência e custo zero)."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:self-center">
              <span className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                {masterOn ? "Ligado" : "Desligado"}
              </span>
              <Switch
                id="master-llm-switch"
                size="lg"
                checked={masterOn}
                onCheckedChange={handleMasterToggle}
                disabled={loading || saving}
                aria-label="Liga ou desliga todo o LLM do bot globalmente"
              />
            </div>
          </div>

          {/* Dados de Endpoint */}
          <div className="mt-5 grid gap-3 border-t border-zinc-100 pt-4 sm:grid-cols-2 dark:border-zinc-800/80">
            <div className="rounded-lg bg-zinc-50 px-3.5 py-2.5 dark:bg-zinc-800/40">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Endpoint Zen
              </span>
              <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                {config?.zenBaseUrl || "http://localhost:20128/v1"}
              </div>
            </div>
            <div className="rounded-lg bg-zinc-50 px-3.5 py-2.5 dark:bg-zinc-800/40">
              <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                Modelo Configurado
              </span>
              <div className="mt-0.5 font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                {config?.zenModel || "bot-zap"}
              </div>
            </div>
          </div>
        </div>

        {/* Barra de Filtros e Ações Rápidas */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
              <Input
                placeholder="Buscar funcionalidade..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-9 pl-8 text-sm"
              />
            </div>

            <div className="flex flex-wrap gap-1">
              <button
                type="button"
                onClick={() => setSelectedCategory("all")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedCategory === "all"
                    ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                }`}
              >
                Todas ({config?.items?.length || 0})
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    selectedCategory === cat
                      ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleToggleAll(true)}
              disabled={loading || saving}
            >
              Ativar Todos
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleToggleAll(false)}
              disabled={loading || saving}
            >
              Desativar Todos
            </Button>
          </div>
        </div>

        {/* Grid de Funcionalidades */}
        <div className="grid gap-4 sm:grid-cols-2">
          {filteredItems.map((item) => (
            <FeatureCard
              key={item.id}
              item={item}
              masterEnabled={masterOn}
              disabled={loading || saving}
              onToggle={(checked) => handleFeatureToggle(item.id, checked)}
            />
          ))}

          {filteredItems.length === 0 && (
            <div className="col-span-full rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Nenhuma funcionalidade encontrada para os filtros aplicados.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

function FeatureCard({
  item,
  masterEnabled,
  disabled,
  onToggle,
}: {
  item: LlmFeatureItem;
  masterEnabled: boolean;
  disabled: boolean;
  onToggle: (checked: boolean) => void;
}) {
  const isFeatureEnabled = item.enabled !== false;
  const isEffectivelyActive = masterEnabled && isFeatureEnabled;

  const categoryIcons: Record<string, typeof Sparkles> = {
    "Chat & Social": Users,
    Memória: Brain,
    "Jogos & Economia": Gamepad2,
    Sistema: Settings2,
  };
  const Icon = categoryIcons[item.category] || Bot;

  return (
    <div
      className={`flex flex-col justify-between rounded-xl border p-5 transition-all ${
        isEffectivelyActive
          ? "border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          : "border-zinc-200/60 bg-zinc-50/70 opacity-80 dark:border-zinc-800/60 dark:bg-zinc-900/50"
      }`}
    >
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <div
              className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                isEffectivelyActive
                  ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
              }`}
            >
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{item.name}</h3>
              <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
                {item.category}
              </span>
            </div>
          </div>

          <Switch
            id={`switch-${item.id}`}
            checked={isFeatureEnabled}
            onCheckedChange={onToggle}
            disabled={disabled}
            aria-label={`Ativar ou desativar LLM para ${item.name}`}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
          {item.description}
        </p>

        {/* Caixa de Fallback */}
        <div className="mt-3.5 rounded-md border border-zinc-100 bg-zinc-50/80 p-2.5 text-xs text-zinc-500 dark:border-zinc-800/80 dark:bg-zinc-950/40 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Fallback sem IA:{" "}
          </span>
          {item.fallback}
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-800/60">
        <span className="text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
          ID: {item.id}
        </span>
        <Badge
          tone={
            !masterEnabled
              ? "neutral"
              : isFeatureEnabled
                ? "success"
                : "warn"
          }
        >
          {!masterEnabled
            ? "Suspenso pelo Master"
            : isFeatureEnabled
              ? "Ativo com IA"
              : "Desativado (Fallback)"}
        </Badge>
      </div>
    </div>
  );
}
