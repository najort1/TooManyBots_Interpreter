import type { BolsaEvent, BolsaQuote } from "@/lib/types";

export function riskLabel(risk: number) {
  if (risk >= 0.7) return "alto";
  if (risk >= 0.4) return "médio";
  return "baixo";
}

export function riskTone(risk: number): "danger" | "warn" | "success" {
  if (risk >= 0.7) return "danger";
  if (risk >= 0.4) return "warn";
  return "success";
}

export function volLabel(vol: number) {
  if (vol >= 0.7) return "alta";
  if (vol >= 0.35) return "média";
  return "baixa";
}

/** 1–5 estrelas de impacto da notícia. */
export function impactStars(impactPct: number) {
  const a = Math.abs(Number(impactPct) || 0);
  if (a >= 12) return 5;
  if (a >= 8) return 4;
  if (a >= 4) return 3;
  if (a >= 1.5) return 2;
  if (a > 0) return 1;
  return 0;
}

export function newsAffects(
  event: BolsaEvent,
  quotes: BolsaQuote[]
): BolsaQuote[] {
  if (event.companyId) {
    const hit = quotes.find((q) => q.id === event.companyId);
    return hit ? [hit] : [];
  }
  // sem companyId: mostra top 2 por |delta| como “radar” contextual
  return [...quotes]
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))
    .slice(0, 2);
}

export function formatClock(ts: number) {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(ts));
}

/** Card surface utilities — prefer beco-panel for desktop identity. */
export const cardClass = "beco-panel";

export const cardRaisedClass =
  "beco-panel dark:!bg-[#202025] dark:!border-[#35353a]";

/** Escala de espaço (4–32). */
export const space = {
  1: "gap-1",
  2: "gap-2",
  3: "gap-3",
  4: "gap-4",
  5: "gap-6",
  6: "gap-8",
} as const;
