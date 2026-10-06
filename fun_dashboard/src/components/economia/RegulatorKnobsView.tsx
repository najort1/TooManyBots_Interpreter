import React from "react";
import { Sliders, Clock, Tag, Activity } from "lucide-react";
import { formatWhen } from "@/lib/format";
import type { EconomyRegulatorKnobs } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  regulator: EconomyRegulatorKnobs;
};

type KnobMeta = {
  key: keyof EconomyRegulatorKnobs;
  name: string;
  min: number;
  max: number;
  defaultVal: number;
  format: (v: number) => string;
  description: string;
};

const KNOBS_METADATA: KnobMeta[] = [
  {
    key: "volMult",
    name: "Multiplicador de Volatilidade",
    min: 0.5,
    max: 1.8,
    defaultVal: 1.0,
    format: (v) => `${v.toFixed(2)}x`,
    description: "Multiplica a oscilação percentual dos ativos no mercado.",
  },
  {
    key: "rewardMult",
    name: "Multiplicador de Recompensas",
    min: 0.7,
    max: 1.35,
    defaultVal: 1.0,
    format: (v) => `${v.toFixed(2)}x`,
    description: "Modifica o yield de empregos, mini-games e bônus da base.",
  },
  {
    key: "eventImpactMult",
    name: "Impacto dos Eventos",
    min: 0.55,
    max: 1.45,
    defaultVal: 1.0,
    format: (v) => `${v.toFixed(2)}x`,
    description: "Multiplicador de magnitude dos choques de notícias.",
  },
  {
    key: "eventFreqMult",
    name: "Frequência de Eventos",
    min: 0.5,
    max: 1.8,
    defaultVal: 1.0,
    format: (v) => `${v.toFixed(2)}x`,
    description: "Acelera ou espaça o intervalo de eventos automáticos.",
  },
  {
    key: "restockMult",
    name: "Reposição de Estoque",
    min: 0.7,
    max: 1.4,
    defaultVal: 1.0,
    format: (v) => `${v.toFixed(2)}x`,
    description: "Volume de itens reabastecidos semanalmente nas lojas.",
  },
  {
    key: "deceptionRate",
    name: "Taxa de Decepção",
    min: 0.02,
    max: 0.28,
    defaultVal: 0.12,
    format: (v) => `${(v * 100).toFixed(1)}%`,
    description: "Probabilidade de rumores falsos / reversão de manchetes.",
  },
  {
    key: "flowScale",
    name: "Escala de Fluxo",
    min: 80,
    max: 5000,
    defaultVal: 500,
    format: (v) => `${v.toFixed(0)}`,
    description: "Sensibilidade de pressão compradora/vendedora nos preços.",
  },
  {
    key: "baseNoisePct",
    name: "Ruído Base do Mercado",
    min: 0.004,
    max: 0.04,
    defaultVal: 0.012,
    format: (v) => `${(v * 100).toFixed(2)}%`,
    description: "Variação randômica mínima a cada tick de mercado.",
  },
  {
    key: "shockDecay",
    name: "Decaimento de Choque",
    min: 0.7,
    max: 0.95,
    defaultVal: 0.85,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    description: "Fator de dissipação dos choques de preço ao longo do tempo.",
  },
  {
    key: "volumeDecay",
    name: "Decaimento de Volume",
    min: 0.5,
    max: 0.9,
    defaultVal: 0.72,
    format: (v) => `${(v * 100).toFixed(0)}%`,
    description: "Ritmo de arrefecimento da atividade de negociação recente.",
  },
];

const SEED_DESCRIPTIONS: Record<string, string> = {
  austerity_soft: "Austeridade Suave — Reduz recompensas e estimula sinks de moedas.",
  liquidity_wave: "Onda de Liquidez — Injeta moedas e incentiva atividade no mercado.",
  quiet_week: "Semana Calma — Diminui volatilidade e acalma choques especulativos.",
  meme_spike: "Disparada Especulativa — Aumenta volatilidade e notícias bombásticas.",
  blitz_luxury: "Blitz de Luxo — Cria itens exclusivos para drenar moedas do topo.",
};

export function RegulatorKnobsView({ regulator }: Props) {
  const { lastRegulateAt, narrativeSeeds } = regulator;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 shadow-sm flex flex-col gap-5">
      {/* Header com Status do Último Tick */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
            <Sliders className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
              Regulador Invisível (Camada 4)
            </h3>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Mecanismo dinâmico de autocorreção monetária que ajusta multiplicadores em tempo real
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start text-xs text-zinc-500 dark:text-zinc-400 sm:self-auto">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Último ciclo:</span>
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {lastRegulateAt ? formatWhen(lastRegulateAt) : "Aguardando 1º tick"}
          </span>
        </div>
      </div>

      {/* Grid de Knobs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {KNOBS_METADATA.map((knob) => {
          const val = Number(regulator[knob.key]) || knob.defaultVal;
          const range = knob.max - knob.min;
          const pct = Math.min(100, Math.max(0, ((val - knob.min) / range) * 100));
          const isDeviated = Math.abs(val - knob.defaultVal) > 0.02;

          return (
            <div
              key={knob.key}
              className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3.5 dark:border-zinc-800 dark:bg-zinc-950/40 flex flex-col justify-between gap-2.5"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                    {knob.name}
                  </span>
                  {isDeviated ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Ajustado pelo regulador" />
                  ) : null}
                </div>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-lg font-bold tracking-tight text-zinc-900 tabular-nums dark:text-zinc-50">
                    {knob.format(val)}
                  </span>
                  <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                    pad: {knob.format(knob.defaultVal)}
                  </span>
                </div>
              </div>

              {/* Barra do Range */}
              <div className="flex flex-col gap-1">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-300",
                      isDeviated ? "bg-amber-500" : "bg-zinc-900 dark:bg-zinc-100"
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-zinc-400 dark:text-zinc-500">
                  <span>{knob.format(knob.min)}</span>
                  <span>{knob.format(knob.max)}</span>
                </div>
              </div>

              <p className="text-[11px] leading-tight text-zinc-500 dark:text-zinc-400 border-t border-zinc-200/60 pt-2 dark:border-zinc-800/60">
                {knob.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Sementes Narrativas Ativas */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/50 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-4 w-4 text-zinc-500 dark:text-zinc-400" aria-hidden="true" />
            <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">
              Sementes Narrativas Agendadas ({narrativeSeeds.length})
            </h4>
          </div>
          <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
            Orientam os eventos automáticos do bot
          </span>
        </div>

        {narrativeSeeds.length === 0 ? (
          <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">
            Nenhuma semente narrativa ativa no momento. O regulador emitirá eventos padrão de mercado.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {narrativeSeeds.map((seed, idx) => {
              const desc = SEED_DESCRIPTIONS[seed];
              return (
                <div
                  key={`${seed}-${idx}`}
                  className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs shadow-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <Activity className="h-3 w-3 text-amber-500" aria-hidden="true" />
                  <span className="font-semibold text-zinc-900 dark:text-zinc-100">{seed}</span>
                  {desc ? (
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">· {desc}</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
