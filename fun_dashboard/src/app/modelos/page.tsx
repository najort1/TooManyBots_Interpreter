"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu,
  Bot,
  Brain,
  Gamepad2,
  Users,
  Settings2,
  CheckCircle2,
  RotateCw,
  Search,
  ZapOff,
  AlertTriangle,
  Layers,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { funApi } from "@/lib/api";
import type {
  LlmConfigResponse,
  LlmFeatureItem,
  LlmSuggestedModel,
} from "@/lib/types";

const CATEGORY_ICONS: Record<string, typeof Bot> = {
  "Chat & Social": Users,
  Memória: Brain,
  "Jogos & Economia": Gamepad2,
  Sistema: Settings2,
};

/** Ordem canônica usada nos filtros de categoria. */
const CATEGORY_ORDER = [
  "Chat & Social",
  "Memória",
  "Jogos & Economia",
  "Sistema",
];

type ModeFilter = "all" | "specific" | "inherited";

export default function ModelosPage() {
  const [config, setConfig] = useState<LlmConfigResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Rascunhos por função: id -> texto digitado/selecionado ("" = herdar padrão)
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  // Padrão global
  const [globalDraft, setGlobalDraft] = useState("");

  // Ação rápida em lote
  const [batchModel, setBatchModel] = useState("");

  // Busca e filtros
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [mode, setMode] = useState<ModeFilter>("all");

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await funApi.llmConfig();
      setConfig(data);
      setGlobalDraft(data.zenModel || "");
      // Sincroniza direto com o servidor (botão "Atualizar" precisa refletir o estado real)
      setDrafts(() => {
        const next: Record<string, string> = {};
        for (const item of data.items) {
          next[item.id] = item.modelOverride ?? "";
        }
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Falha ao carregar configuração de modelos"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const defaultModel = config?.zenModel || "";

  const suggestedModels: LlmSuggestedModel[] = config?.suggestedModels ?? [];

  /**
   * Persista um patch de modelos e recarrega o estado canônico do servidor.
   * Sem atualização otimista: o servidor é a fonte da verdade (pode normalizar
   * ou rejeitar um modelo inexistente).
   */
  const persist = useCallback(
    async (payload: {
      zenModel?: string;
      llmModels?: Record<string, string>;
    }) => {
      setSaving(true);
      setError(null);
      setSuccess(false);
      try {
        const res = await funApi.updateLlmConfig(payload);
        setConfig(res);
        setGlobalDraft(res.zenModel || "");
        // Chaves enviadas no payload pegam o valor canônico do servidor (já com
        // trim); as demais preservam o rascunho local ainda não enviado.
        const sentKeys = new Set(Object.keys(payload.llmModels ?? {}));
        setDrafts((prev) => {
          const next: Record<string, string> = {};
          for (const item of res.items) {
            next[item.id] = sentKeys.has(item.id)
              ? item.modelOverride ?? ""
              : prev[item.id] ?? item.modelOverride ?? "";
          }
          return next;
        });
        setSuccess(true);
        setTimeout(() => setSuccess(false), 2500);
        return true;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Falha ao salvar configuração de modelo"
        );
        return false;
      } finally {
        setSaving(false);
      }
    },
    []
  );

  const handleSaveGlobal = async () => {
    if (!config) return;
    if (!globalDraft.trim() || globalDraft.trim() === defaultModel) return;
    await persist({ zenModel: globalDraft.trim() });
  };

  const handleSaveFeature = async (featureId: string) => {
    if (!config) return;
    const item = config.items.find((i) => i.id === featureId);
    if (!item) return;
    const nextValue = (drafts[featureId] ?? "").trim();
    if (nextValue === ((item.modelOverride ?? "").trim())) return;
    await persist({ llmModels: { [featureId]: nextValue } });
  };

  const handleUseDefault = async (featureId: string) => {
    if (!config) return;
    const item = config.items.find((i) => i.id === featureId);
    if (!item || !item.modelOverride) return;
    setDrafts((prev) => ({ ...prev, [featureId]: "" }));
    await persist({ llmModels: { [featureId]: "" } });  };

  const handleResetAll = async () => {
    if (!config) return;
    const cleared: Record<string, string> = {};
    for (const item of config.items) {
      cleared[item.id] = "";
    }
    setDrafts(cleared);
    await persist({ llmModels: cleared });
  };

  const overrideCount = useMemo(() => {
    if (!config?.items) return 0;
    return config.items.filter((item) => Boolean(item.modelOverride)).length;
  }, [config?.items]);

  const categories = useMemo(() => {
    if (!config?.items) return [];
    const present = new Set(config.items.map((i) => i.category));
    const ordered = CATEGORY_ORDER.filter((c) => present.has(c));
    for (const c of present) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }, [config?.items]);

  const filteredItems = useMemo(() => {
    if (!config?.items) return [];
    const q = search.trim().toLowerCase();
    return config.items.filter((item) => {
      const matchesSearch =
        q === "" ||
        item.name.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        (item.effectiveModel ?? "").toLowerCase().includes(q) ||
        (item.modelOverride ?? "").toLowerCase().includes(q);
      const matchesCategory = category === "all" || item.category === category;
      const matchesMode =
        mode === "all" ||
        (mode === "specific" && Boolean(item.modelOverride)) ||
        (mode === "inherited" && !item.modelOverride);
      return matchesSearch && matchesCategory && matchesMode;
    });
  }, [config?.items, search, category, mode]);

  const filteredWithOverride = useMemo(
    () => filteredItems.filter((item) => Boolean(item.modelOverride)).length,
    [filteredItems]
  );

  const handleApplyBatch = async () => {
    if (!config) return;
    const model = batchModel.trim();
    if (model === "" || filteredItems.length === 0) return;
    const llmModels: Record<string, string> = {};
    for (const item of filteredItems) {
      llmModels[item.id] = model;
    }
    const ok = await persist({ llmModels });
    if (ok) {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const item of filteredItems) next[item.id] = model;
        return next;
      });
    }
  };

  const handleClearBatch = async () => {
    if (!config) return;
    if (filteredWithOverride === 0) return;
    const llmModels: Record<string, string> = {};
    for (const item of filteredItems) {
      llmModels[item.id] = "";
    }
    const ok = await persist({ llmModels });
    if (ok) {
      setDrafts((prev) => {
        const next = { ...prev };
        for (const item of filteredItems) next[item.id] = "";
        return next;
      });
    }
  };

  const masterOn = config?.zenEnabled !== false;
  const batchDisabled = saving || loading || batchModel.trim() === "" || filteredItems.length === 0;

  return (
    <AppShell
      title="Modelos LLM por Função"
      subtitle="Defina um modelo específico para cada função que chama a LLM, ou deixe todas herdando o padrão global"
      onRefresh={() => void loadConfig()}
      refreshing={loading}
      status={error}
    >
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Banner de sucesso */}
        {success && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            Modelos aplicados e sincronizados com o bot em tempo real!
          </div>
        )}

        {/* Banner de erro */}
        {error && !loading && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-700 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Estado: carregando */}
        {loading && (
          <div className="flex items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white p-10 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <RotateCw className="h-4 w-4 animate-spin" />
            Carregando funções e modelos...
          </div>
        )}

        {/* Estado: erro fatal (sem config) */}
        {!loading && !config && (
          <div className="rounded-xl border border-dashed border-zinc-200 p-8 text-center dark:border-zinc-800">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Não foi possível carregar a configuração de modelos.
            </p>
            <Button className="mt-3" variant="secondary" size="sm" onClick={() => void loadConfig()}>
              Tentar novamente
            </Button>
          </div>
        )}

        {config && (
          <>
            {/* Bloco 1 — Modelo Padrão Global & Status do Endpoint */}
            <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-start gap-3">
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                    masterOn
                      ? "bg-emerald-600/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400"
                      : "bg-amber-600/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
                  }`}
                >
                  {masterOn ? <Cpu className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
                      Modelo Padrão Global
                    </h2>
                    <Badge tone={masterOn ? "success" : "warn"}>
                      {masterOn ? "LLM Ativo" : "LLM Desligado"}
                    </Badge>
                    {saving && (
                      <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                        <RotateCw className="h-3 w-3 animate-spin" />
                        Gravando...
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                    Usado por toda função que não tiver um modelo específico definido.
                  </p>
                </div>
              </div>

              {/* Resumo funcional + endpoint */}
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-zinc-50 px-3.5 py-2.5 dark:bg-zinc-800/40">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Endpoint Ativo
                  </span>
                  <div className="mt-0.5 truncate font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {config.zenBaseUrl || "—"}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 px-3.5 py-2.5 dark:bg-zinc-800/40">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Provedor Detectado
                  </span>
                  <div className="mt-0.5 truncate font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {config.activeProvider || "indefinido"}
                  </div>
                </div>
                <div className="rounded-lg bg-zinc-50 px-3.5 py-2.5 dark:bg-zinc-800/40">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
                    Overrides Ativos
                  </span>
                  <div className="mt-0.5 text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                    {overrideCount} de {config.items.length} funções usando modelo específico
                  </div>
                </div>
              </div>

              {/* Editor do padrão global */}
              <form
                className="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800/80"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSaveGlobal();
                }}
              >
                <label
                  htmlFor="global-model"
                  className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
                >
                  Modelo padrão global
                </label>
                <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    id="global-model"
                    list="global-model-suggestions"
                    value={globalDraft}
                    onChange={(e) => setGlobalDraft(e.target.value)}
                    placeholder="ex.: bot-zap"
                    autoComplete="off"
                    spellCheck={false}
                    className="font-mono text-sm sm:max-w-sm"
                    disabled={saving}
                  />
                  <datalist id="global-model-suggestions">
                    {suggestedModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.name}
                      </option>
                    ))}
                  </datalist>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="submit"
                      size="sm"
                      disabled={saving || loading || globalDraft.trim() === "" || globalDraft.trim() === defaultModel}
                    >
                      Salvar Padrão
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={saving || loading || overrideCount === 0}
                      onClick={() => void handleResetAll()}
                    >
                      Restaurar todas para o padrão
                    </Button>
                  </div>
                </div>
                <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                  Sugestões disponíveis:{" "}
                  {suggestedModels.length > 0
                    ? suggestedModels.map((m) => m.id).join(", ")
                    : "nenhuma (digite livremente)"}
                </p>
              </form>
            </section>

            {/* Bloco 2 — Ação Rápida em Lote */}
            <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-zinc-400" />
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  Ação Rápida em Lote
                </h2>
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Aplica um mesmo modelo a todas as funções que passarem pelos filtros
                abaixo (ex.: usar um modelo barato para toda extração social).
              </p>

              <form
                className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleApplyBatch();
                }}
              >
                <label htmlFor="batch-model" className="sr-only">
                  Modelo para aplicar em lote
                </label>
                <Input
                  id="batch-model"
                  list="batch-model-suggestions"
                  value={batchModel}
                  onChange={(e) => setBatchModel(e.target.value)}
                  placeholder="modelo-x (ex.: gpt-4o-mini, deepseek/deepseek-chat, glm-5)"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm sm:max-w-md"
                  disabled={saving || loading}
                />
                <datalist id="batch-model-suggestions">
                  {suggestedModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.name}
                    </option>
                  ))}
                </datalist>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="submit"
                    size="sm"
                    disabled={batchDisabled}
                  >
                    Aplicar às funções filtradas ({filteredItems.length})
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={saving || loading || filteredWithOverride === 0}
                    onClick={() => void handleClearBatch()}
                  >
                    Limpar overrides filtrados ({filteredWithOverride})
                  </Button>
                </div>
              </form>
            </section>

            {/* Bloco 3 — Busca e Filtros */}
            <section className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-72">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-zinc-400" />
                  <label htmlFor="function-search" className="sr-only">
                    Buscar função
                  </label>
                  <Input
                    id="function-search"
                    placeholder="Buscar por nome, ID, categoria ou modelo..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="h-9 pl-8 text-sm"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <label htmlFor="mode-filter" className="sr-only">
                    Filtrar por modo de modelo
                  </label>
                  <Select
                    id="mode-filter"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as ModeFilter)}
                    className="h-9 w-auto text-sm"
                  >
                    <option value="all">Modo: Todos</option>
                    <option value="specific">Modo: Modelo específico</option>
                    <option value="inherited">Modo: Herdando padrão</option>
                  </Select>
                </div>
              </div>

              <div className="flex flex-wrap gap-1" role="group" aria-label="Filtrar por categoria">
                <button
                  type="button"
                  onClick={() => setCategory("all")}
                  aria-pressed={category === "all"}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    category === "all"
                      ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                  }`}
                >
                  Todas ({config.items.length})
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    aria-pressed={category === cat}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      category === cat
                        ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </section>

            {/* Bloco 4 — Grid de Cards de Funções */}
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredItems.map((item) => (
                <FunctionModelCard
                  key={item.id}
                  item={item}
                  masterEnabled={masterOn}
                  defaultModel={defaultModel}
                  suggestedModels={suggestedModels}
                  draft={drafts[item.id] ?? ""}
                  disabled={saving || loading}
                  onDraftChange={(value) =>
                    setDrafts((prev) => ({ ...prev, [item.id]: value }))
                  }
                  onSave={() => void handleSaveFeature(item.id)}
                  onUseDefault={() => void handleUseDefault(item.id)}
                />
              ))}

              {filteredItems.length === 0 && (
                <div className="col-span-full rounded-xl border border-dashed border-zinc-200 p-8 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  Nenhuma função encontrada para os filtros aplicados.
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function FunctionModelCard({
  item,
  masterEnabled,
  defaultModel,
  suggestedModels,
  draft,
  disabled,
  onDraftChange,
  onSave,
  onUseDefault,
}: {
  item: LlmFeatureItem;
  masterEnabled: boolean;
  defaultModel: string;
  suggestedModels: LlmSuggestedModel[];
  draft: string;
  disabled: boolean;
  onDraftChange: (value: string) => void;
  onSave: () => void;
  onUseDefault: () => void;
}) {
  const isFeatureEnabled = item.enabled !== false;
  const isEffectivelyActive = masterEnabled && isFeatureEnabled;
  const hasOverride = Boolean(item.modelOverride);
  const Icon = CATEGORY_ICONS[item.category] || Bot;

  const effectiveModel = item.effectiveModel || item.modelOverride || defaultModel || "—";
  const isDirty = draft.trim() !== (item.modelOverride ?? "").trim();
  const suggestId = `model-suggestions-${item.id}`;

  return (
    <div
      className={`flex flex-col rounded-xl border p-5 transition-all ${
        isEffectivelyActive
          ? "border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
          : "border-zinc-200/60 bg-zinc-50/70 opacity-80 dark:border-zinc-800/60 dark:bg-zinc-900/50"
      }`}
    >
      {/* Cabeçalho */}
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
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">{item.name}</h3>
          <span className="text-[11px] font-medium text-zinc-400 dark:text-zinc-500">
            {item.category}
          </span>
        </div>
        <Badge
          tone={
            !masterEnabled ? "neutral" : isFeatureEnabled ? "success" : "warn"
          }
        >
          {!masterEnabled
            ? "Suspenso pelo Master"
            : isFeatureEnabled
              ? "Ativo com IA"
              : "Desativado"}
        </Badge>
      </div>

      {/* Descrição */}
      <p className="mt-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
        {item.description}
      </p>

      {/* Indicador de modelo */}
      <div className="mt-3 rounded-md border border-zinc-100 bg-zinc-50/80 p-2.5 dark:border-zinc-800/80 dark:bg-zinc-950/40">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={hasOverride ? "ink" : "neutral"}>
            {hasOverride ? "Modelo específico" : "Herdando padrão"}
          </Badge>
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Modelo efetivo:{" "}
            <span className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">
              {effectiveModel}
            </span>
          </span>
        </div>
        <p className="mt-1 text-[11px] font-mono text-zinc-400 dark:text-zinc-500">
          ID: {item.id}
        </p>
      </div>

      {/* Edição */}
      <form
        className="mt-3.5 space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (isDirty && !disabled) onSave();
        }}
      >
        <label
          htmlFor={`model-select-${item.id}`}
          className="text-[11px] font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400"
        >
          Modelo desta função
        </label>
        <Select
          id={`model-select-${item.id}`}
          value={suggestedModels.some((m) => m.id === draft) ? draft : draft === "" ? "__inherit__" : "__custom__"}
          disabled={disabled}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "__inherit__") onDraftChange("");
            else if (value !== "__custom__") onDraftChange(value);
          }}
        >
          <option value="__inherit__">
            Herdar padrão global{defaultModel ? ` (${defaultModel})` : ""}
          </option>
          {suggestedModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
              {model.providerName ? ` — ${model.providerName}` : ""}
            </option>
          ))}
          {draft !== "" &&
            !suggestedModels.some((m) => m.id === draft) && (
              <option value="__custom__">{draft} (personalizado)</option>
            )}
        </Select>

        <label htmlFor={`model-input-${item.id}`} className="sr-only">
          Ou digite qualquer string de modelo para {item.name}
        </label>
        <Input
          id={`model-input-${item.id}`}
          list={suggestId}
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          placeholder="Digite um modelo (ex.: bot-zap, glm-5, gpt-4o-mini)"
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          disabled={disabled}
        />
        <datalist id={suggestId}>
          {suggestedModels.map((model) => (
            <option key={model.id} value={model.id}>
              {model.name}
            </option>
          ))}
        </datalist>

        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button
            type="submit"
            size="sm"
            onClick={onSave}
            disabled={disabled || !isDirty}
          >
            Salvar
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onUseDefault}
            disabled={disabled || !hasOverride}
            title="Remover o override e voltar a herdar o modelo padrão global"
          >
            Usar padrão
          </Button>
          {isDirty && !disabled && (
            <span className="self-center text-[11px] text-amber-600 dark:text-amber-400">
              alteração não salva
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
