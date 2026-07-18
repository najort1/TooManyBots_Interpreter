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

/** Card surface utilities (desktop depth). */
export const cardClass =
  "rounded-xl border border-zinc-200/90 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.05)] " +
  "dark:border-[#2d2d2d] dark:bg-[#18181b] dark:shadow-[0_8px_30px_rgba(0,0,0,0.32)]";

export const cardRaisedClass =
  "rounded-xl border border-zinc-200 bg-zinc-50/80 shadow-[0_8px_30px_rgba(0,0,0,0.06)] " +
  "dark:border-[#35353a] dark:bg-[#202025] dark:shadow-[0_8px_30px_rgba(0,0,0,0.35)]";
