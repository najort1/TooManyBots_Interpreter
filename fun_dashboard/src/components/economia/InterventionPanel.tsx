import React, { useState, useEffect } from "react";
import {
  Wrench,
  Flame,
  Coins,
  Anchor,
  Sparkles,
  Sliders,
  AlertTriangle,
  CheckCircle2,
  X,
  HelpCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { formatCoins, formatNumber } from "@/lib/format";
import { funApi } from "@/lib/api";
import type {
  EconomyInterventionPayload,
  EconomyInterventionResult,
  EconomyRegulatorKnobs,
} from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  scope: string;
  groupName?: string;
  currentJackpot: number;
  currentBaseline: number;
  currentCirculating: number;
  currentKnobs: EconomyRegulatorKnobs;
  onSuccess: () => void;
};

type ActionType = "inject_jackpot" | "burn_jackpot" | "set_baseline" | "trigger_seed" | "adjust_knobs";

const ACTIONS: Array<{
  id: ActionType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  description: string;
}> = [
  {
    id: "inject_jackpot",
    label: "Injetar no Jackpot",
    icon: Coins,
    description: "Injeta moedas no pote do cassino do grupo para estimular atividade e liquidez.",
  },
  {
    id: "burn_jackpot",
    label: "Queimar Jackpot",
    icon: Flame,
    description: "Remove moedas do jackpot, contraindo a base monetária sem penalizar carteiras individuais.",
  },
  {
    id: "set_baseline",
    label: "Redefinir Baseline",
    icon: Anchor,
    description: "Ajusta a âncora de equilíbrio monetário que o Regulador Invisível usa para detectar inflação/deflação.",
  },
  {
    id: "trigger_seed",
    label: "Ativar Semente Narrativa",
    icon: Sparkles,
    description: "Injeta uma semente narrativa que direciona o tom e os eventos dos próximos ciclos de notícias e preços.",
  },
  {
    id: "adjust_knobs",
    label: "Ajustar Knobs",
    icon: Sliders,
    description: "Calibra manualmente multiplicadores de volatilidade, recompensas, decepção e fluxo do Regulador.",
  },
];

const PRESET_SEEDS = [
  { id: "liquidity_wave", label: "Onda de Liquidez (Injeção e Estímulo)" },
  { id: "austerity_soft", label: "Austeridade Suave (Redução de Recompensas)" },
  { id: "meme_spike", label: "Disparada Especulativa (Alta Volatilidade)" },
  { id: "quiet_week", label: "Semana Calma (Estabilização de Preços)" },
  { id: "blitz_luxury", label: "Blitz de Artigos de Luxo (Dreno de Magnatas)" },
];

export function InterventionPanel({
  scope,
  groupName,
  currentJackpot,
  currentBaseline,
  currentCirculating,
  currentKnobs,
  onSuccess,
}: Props) {
  const [selectedAction, setSelectedAction] = useState<ActionType>("inject_jackpot");
  const [amountInput, setAmountInput] = useState<string>("");
  const [burnAll, setBurnAll] = useState<boolean>(false);
  const [selectedSeed, setSelectedSeed] = useState<string>("liquidity_wave");
  const [customSeed, setCustomSeed] = useState<string>("");

  // Knobs editáveis
  const [knobsInput, setKnobsInput] = useState<Record<string, number>>({
    volMult: currentKnobs.volMult ?? 1.0,
    rewardMult: currentKnobs.rewardMult ?? 1.0,
    eventImpactMult: currentKnobs.eventImpactMult ?? 1.0,
    eventFreqMult: currentKnobs.eventFreqMult ?? 1.0,
    restockMult: currentKnobs.restockMult ?? 1.0,
    deceptionRate: currentKnobs.deceptionRate ?? 0.12,
    flowScale: currentKnobs.flowScale ?? 500,
    baseNoisePct: currentKnobs.baseNoisePct ?? 0.012,
    shockDecay: currentKnobs.shockDecay ?? 0.85,
    volumeDecay: currentKnobs.volumeDecay ?? 0.72,
  });

  // Modal de confirmação
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && confirmOpen && !submitting) {
        setConfirmOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmOpen, submitting]);

  const resetForm = () => {
    setAmountInput("");
    setBurnAll(false);
    setCustomSeed("");
    setKnobsInput({
      volMult: currentKnobs.volMult ?? 1.0,
      rewardMult: currentKnobs.rewardMult ?? 1.0,
      eventImpactMult: currentKnobs.eventImpactMult ?? 1.0,
      eventFreqMult: currentKnobs.eventFreqMult ?? 1.0,
      restockMult: currentKnobs.restockMult ?? 1.0,
      deceptionRate: currentKnobs.deceptionRate ?? 0.12,
      flowScale: currentKnobs.flowScale ?? 500,
      baseNoisePct: currentKnobs.baseNoisePct ?? 0.012,
      shockDecay: currentKnobs.shockDecay ?? 0.85,
      volumeDecay: currentKnobs.volumeDecay ?? 0.72,
    });
  };

  const handleActionChange = (action: ActionType) => {
    setSelectedAction(action);
    setFeedback(null);
    resetForm();
  };

  // Prepara o payload para submissão
  const preparePayload = (): EconomyInterventionPayload | null => {
    if (!scope) return null;

    if (selectedAction === "inject_jackpot") {
      const amt = Math.floor(Number(amountInput) || 0);
      if (amt <= 0) return null;
      return { scope, action: "inject_jackpot", amount: amt };
    }

    if (selectedAction === "burn_jackpot") {
      if (burnAll) {
        return { scope, action: "burn_jackpot" };
      }
      const amt = Math.floor(Number(amountInput) || 0);
      if (amt <= 0) return null;
      return { scope, action: "burn_jackpot", amount: amt };
    }

    if (selectedAction === "set_baseline") {
      const amt = Math.floor(Number(amountInput) || 0);
      if (amt <= 0) return null;
      return { scope, action: "set_baseline", amount: amt };
    }

    if (selectedAction === "trigger_seed") {
      const seed = customSeed.trim() || selectedSeed;
      if (!seed) return null;
      return { scope, action: "trigger_seed", seed };
    }

    if (selectedAction === "adjust_knobs") {
      return { scope, action: "adjust_knobs", knobs: knobsInput };
    }

    return null;
  };

  const isFormValid = Boolean(preparePayload());

  const handleOpenConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid) return;
    setConfirmOpen(true);
  };

  const handleExecuteIntervention = async () => {
    const payload = preparePayload();
    if (!payload) return;

    setSubmitting(true);
    setFeedback(null);

    try {
      const result: EconomyInterventionResult = await funApi.economyIntervene(payload);
      if (result.ok) {
        setFeedback({
          type: "success",
          message: result.message || "Intervenção executada com sucesso.",
        });
        setConfirmOpen(false);
        resetForm();
        onSuccess();
      } else {
        setFeedback({
          type: "error",
          message: result.message || "Falha ao processar intervenção.",
        });
        setConfirmOpen(false);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        message: err instanceof Error ? err.message : "Erro inesperado ao executar intervenção.",
      });
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  const currentActionMeta = ACTIONS.find((a) => a.id === selectedAction)!;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900">
            <Wrench className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Painel de Intervenção Monetária
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Controles de política monetária direta e ajuste fino dos parâmetros do mundo
            </p>
          </div>
        </div>
      </div>

      {/* Banner de Feedback (Sucesso / Erro) */}
      {feedback ? (
        <div
          className={cn(
            "flex items-start justify-between gap-3 rounded-lg border p-4 text-sm",
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200"
              : "border-red-200 bg-red-50 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          )}
        >
          <div className="flex items-center gap-2.5">
            {feedback.type === "success" ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {/* Navegação entre Ações (Tabs/Pills) */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5 p-1 rounded-lg bg-zinc-100 dark:bg-zinc-800/60">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          const active = selectedAction === action.id;
          return (
            <button
              key={action.id}
              type="button"
              disabled={submitting}
              onClick={() => handleActionChange(action.id)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-all",
                active
                  ? "bg-white text-zinc-900 shadow-xs dark:bg-zinc-900 dark:text-zinc-50"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
                submitting && "opacity-50 cursor-not-allowed"
              )}
            >
              <Icon className={cn("h-4 w-4", active ? "text-amber-500" : "opacity-70")} />
              <span className="truncate">{action.label}</span>
            </button>
          );
        })}
      </div>

      {/* Formulário Contextual da Ação */}
      <form onSubmit={handleOpenConfirm} className="flex flex-col gap-4">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/40 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
            <HelpCircle className="h-4 w-4 text-zinc-400" />
            <span>{currentActionMeta.description}</span>
          </div>

          {/* 1. Injetar Jackpot */}
          {selectedAction === "inject_jackpot" ? (
            <div className="flex flex-col gap-3 pt-1">
              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Quantidade a Injetar (coins)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="Ex: 5000"
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
                    required
                  />
                  <div className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                    Pote atual: <span className="font-semibold text-zinc-900 dark:text-zinc-100">{formatCoins(currentJackpot)}</span>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Atalhos rápidos:</span>
                {[1000, 5000, 25000, 100000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmountInput(String(preset))}
                    className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                  >
                    +{formatNumber(preset)}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* 2. Queimar Jackpot */}
          {selectedAction === "burn_jackpot" ? (
            <div className="flex flex-col gap-3 pt-1">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={burnAll}
                    onChange={(e) => setBurnAll(e.target.checked)}
                    className="rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span>Queimar Todo o Jackpot Atual ({formatCoins(currentJackpot)})</span>
                </label>
              </div>

              {!burnAll ? (
                <>
                  <div>
                    <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      Quantidade Específica a Queimar (coins)
                    </label>
                    <div className="mt-1 flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder={`Máximo: ${currentJackpot}`}
                        value={amountInput}
                        onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
                        required={!burnAll}
                      />
                      <div className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400 tabular-nums">
                        Disponível: <span className="font-semibold">{formatCoins(currentJackpot)}</span>
                      </div>
                    </div>
                  </div>
                  {currentJackpot > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-zinc-400 dark:text-zinc-500">Porcentagem do pote:</span>
                      {[0.25, 0.5, 0.75].map((pct) => {
                        const calculated = Math.floor(currentJackpot * pct);
                        return (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => setAmountInput(String(calculated))}
                            className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          >
                            {pct * 100}% ({formatNumber(calculated)})
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}

          {/* 3. Redefinir Baseline */}
          {selectedAction === "set_baseline" ? (
            <div className="flex flex-col gap-3 pt-1">
              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Novo Baseline Monetário (coins)
                </label>
                <div className="mt-1 flex items-center gap-2">
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder={`Atual: ${currentBaseline}`}
                    value={amountInput}
                    onChange={(e) => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
                    required
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setAmountInput(String(currentCirculating))}
                    className="shrink-0 text-xs"
                  >
                    Usar Circulação Atual ({formatCoins(currentCirculating)})
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Baseline atual: <strong className="text-zinc-900 dark:text-zinc-100">{formatCoins(currentBaseline)}</strong>.
                Se a circulação superar +25% do baseline, o bot entra em regime de contenção inflacionária.
              </p>
            </div>
          ) : null}

          {/* 4. Ativar Semente Narrativa */}
          {selectedAction === "trigger_seed" ? (
            <div className="flex flex-col gap-3 pt-1">
              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Escolha uma Semente Predefinida
                </label>
                <Select
                  value={selectedSeed}
                  onChange={(e) => {
                    setSelectedSeed(e.target.value);
                    setCustomSeed("");
                  }}
                  className="mt-1"
                >
                  {PRESET_SEEDS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </Select>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  Ou digite uma semente customizada (slug sem espaços)
                </label>
                <Input
                  type="text"
                  placeholder="Ex: crash_petroleo, bolha_cripto"
                  value={customSeed}
                  onChange={(e) =>
                    setCustomSeed(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '_'))
                  }
                  className="mt-1"
                />
              </div>
            </div>
          ) : null}

          {/* 5. Ajustar Knobs */}
          {selectedAction === "adjust_knobs" ? (
            <div className="flex flex-col gap-4 pt-1">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Volatilidade (volMult) [0.5 - 1.8]
                  </label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.5"
                    max="1.8"
                    value={knobsInput.volMult}
                    onChange={(e) =>
                      setKnobsInput((prev) => ({ ...prev, volMult: parseFloat(e.target.value) || 1 }))
                    }
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Recompensas (rewardMult) [0.7 - 1.35]
                  </label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.7"
                    max="1.35"
                    value={knobsInput.rewardMult}
                    onChange={(e) =>
                      setKnobsInput((prev) => ({ ...prev, rewardMult: parseFloat(e.target.value) || 1 }))
                    }
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Taxa de Decepção (deceptionRate) [0.02 - 0.28]
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0.02"
                    max="0.28"
                    value={knobsInput.deceptionRate}
                    onChange={(e) =>
                      setKnobsInput((prev) => ({ ...prev, deceptionRate: parseFloat(e.target.value) || 0.12 }))
                    }
                    className="mt-1"
                  />
                </div>

                <div>
                  <label className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    Impacto dos Eventos (eventImpactMult) [0.55 - 1.45]
                  </label>
                  <Input
                    type="number"
                    step="0.05"
                    min="0.55"
                    max="1.45"
                    value={knobsInput.eventImpactMult}
                    onChange={(e) =>
                      setKnobsInput((prev) => ({ ...prev, eventImpactMult: parseFloat(e.target.value) || 1 }))
                    }
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setKnobsInput({
                      volMult: 1.0,
                      rewardMult: 1.0,
                      eventImpactMult: 1.0,
                      eventFreqMult: 1.0,
                      restockMult: 1.0,
                      deceptionRate: 0.12,
                      flowScale: 500,
                      baseNoisePct: 0.012,
                      shockDecay: 0.85,
                      volumeDecay: 0.72,
                    })
                  }
                >
                  Restaurar Padrões de Fábrica
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {/* Botão de Ação */}
        <div className="flex items-center justify-end gap-3">
          <Button type="submit" disabled={!isFormValid || submitting} className="px-5">
            Revisar & Executar Intervenção
          </Button>
        </div>
      </form>

      {/* Modal de Confirmação Obrigatório */}
      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4"
          role="dialog"
          aria-modal="true"
        >
          {/* Backdrop */}
          <button
            type="button"
            className="absolute inset-0 bg-zinc-950/70 backdrop-blur-xs transition-opacity"
            aria-label="Cancelar"
            onClick={() => {
              if (!submitting) setConfirmOpen(false);
            }}
          />

          {/* Conteúdo */}
          <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
            <header className="flex items-center justify-between border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <h4 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    Confirmar Intervenção Monetária
                  </h4>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    Grupo: {groupName || scope}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="p-5 text-sm text-zinc-600 dark:text-zinc-300 flex flex-col gap-3">
              <p>
                Você está prestes a executar a seguinte ação direta na economia do bot:
              </p>

              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3.5 dark:border-zinc-800 dark:bg-zinc-950 text-xs flex flex-col gap-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Ação:</span>
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {currentActionMeta.label}
                  </span>
                </div>
                {selectedAction === "inject_jackpot" ? (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Valor a injetar:</span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400">
                      +{formatCoins(Number(amountInput))}
                    </span>
                  </div>
                ) : null}
                {selectedAction === "burn_jackpot" ? (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Valor a queimar:</span>
                    <span className="font-bold text-red-600 dark:text-red-400">
                      {burnAll ? `Todo o pote (${formatCoins(currentJackpot)})` : `-${formatCoins(Number(amountInput))}`}
                    </span>
                  </div>
                ) : null}
                {selectedAction === "set_baseline" ? (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Novo Baseline:</span>
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">
                      {formatCoins(Number(amountInput))} (anterior: {formatCoins(currentBaseline)})
                    </span>
                  </div>
                ) : null}
                {selectedAction === "trigger_seed" ? (
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Semente Narrativa:</span>
                    <span className="font-bold text-amber-600 dark:text-amber-400">
                      {customSeed.trim() || selectedSeed}
                    </span>
                  </div>
                ) : null}
                {selectedAction === "adjust_knobs" ? (
                  <div className="flex flex-col gap-1 pt-1">
                    <span className="text-zinc-500">Novos Multiplicadores:</span>
                    <div className="grid grid-cols-2 gap-1 text-[11px] text-zinc-700 dark:text-zinc-300 font-mono">
                      <span>volMult: {knobsInput.volMult}</span>
                      <span>rewardMult: {knobsInput.rewardMult}</span>
                      <span>deceptionRate: {knobsInput.deceptionRate}</span>
                      <span>eventImpactMult: {knobsInput.eventImpactMult}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <p className="text-xs text-zinc-500 dark:text-zinc-400 italic">
                Esta ação tem efeito imediato nas tabelas do banco de dados e nos próximos cálculos de mercado do grupo.
              </p>
            </div>

            <footer className="flex items-center justify-end gap-2.5 border-t border-zinc-200 bg-zinc-50/60 px-5 py-3.5 dark:border-zinc-800 dark:bg-zinc-950/60">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setConfirmOpen(false)}
                disabled={submitting}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleExecuteIntervention}
                disabled={submitting}
                className="bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600"
              >
                {submitting ? "Processando..." : "Confirmar & Aplicar"}
              </Button>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
  );
}
