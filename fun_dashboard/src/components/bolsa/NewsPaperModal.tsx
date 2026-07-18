"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { formatPct, formatWhen } from "@/lib/format";
import type { BolsaEvent } from "@/lib/types";
import { cn } from "@/lib/cn";

type Props = {
  event: BolsaEvent | null;
  open: boolean;
  onClose: () => void;
};

/**
 * Modal temático de jornal — notícia completa da corretora.
 */
export function NewsPaperModal({ event, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !event) return null;

  const dir =
    event.impactPct > 0 ? "alta" : event.impactPct < 0 ? "baixa" : "lateral";
  const masthead = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(event.createdAt || Date.now()));

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="news-modal-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/60 backdrop-blur-[2px]"
        aria-label="Fechar"
        onClick={onClose}
      />

      <article
        className={cn(
          "relative z-10 flex max-h-[min(92dvh,720px)] w-full max-w-lg flex-col overflow-hidden",
          "rounded-t-xl border border-zinc-300 bg-[#f7f4ec] shadow-2xl sm:rounded-lg",
          "dark:border-zinc-600 dark:bg-[#1a1916]"
        )}
      >
        {/* Masthead jornal */}
        <header className="border-b-2 border-zinc-900 px-5 pb-3 pt-4 dark:border-zinc-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-serif text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600 dark:text-zinc-400">
                Diário do Beco · Edição de mercado
              </p>
              <p className="mt-0.5 text-[11px] capitalize text-zinc-500 dark:text-zinc-400">
                {masthead}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-zinc-700 hover:bg-zinc-900/5 dark:text-zinc-200 dark:hover:bg-white/10"
              aria-label="Fechar notícia"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-400/50 pt-2 text-[10px] font-medium uppercase tracking-wide text-zinc-600 dark:border-zinc-500/40 dark:text-zinc-400">
            <span>Mercado</span>
            <span aria-hidden>·</span>
            <span>{event.category || "geral"}</span>
            {event.companyId ? (
              <>
                <span aria-hidden>·</span>
                <span className="font-mono normal-case tracking-normal">
                  {event.companyId}
                </span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span
              className={cn(
                dir === "alta" && "text-emerald-800 dark:text-emerald-400",
                dir === "baixa" && "text-red-800 dark:text-red-400",
                dir === "lateral" && "text-zinc-600 dark:text-zinc-400"
              )}
            >
              {formatPct(event.impactPct, 0)} {dir}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {formatWhen(event.createdAt)}
            {event.archetype ? ` · ${event.archetype}` : ""}
          </p>
          <h2
            id="news-modal-title"
            className="mt-2 font-serif text-2xl font-bold leading-tight tracking-tight text-zinc-950 dark:text-zinc-50"
          >
            {event.title}
          </h2>
          <div
            className="mt-3 h-px w-16 bg-zinc-900 dark:bg-zinc-200"
            aria-hidden
          />
          <div className="mt-4 space-y-3 font-serif text-[15px] leading-relaxed text-zinc-800 dark:text-zinc-200">
            {(event.description || "Sem corpo da matéria.")
              .split(/\n+/)
              .filter(Boolean)
              .map((para, i) => (
                <p key={i}>{para}</p>
              ))}
          </div>
        </div>

        <footer className="border-t border-zinc-300 bg-[#efe9dc] px-5 py-3 text-[11px] text-zinc-600 dark:border-zinc-600 dark:bg-[#141310] dark:text-zinc-400">
          Só leitura · preços e ordens no WhatsApp com{" "}
          <code className="rounded bg-zinc-900/5 px-1 dark:bg-white/10">
            /bolsa
          </code>
        </footer>
      </article>
    </div>
  );
}
