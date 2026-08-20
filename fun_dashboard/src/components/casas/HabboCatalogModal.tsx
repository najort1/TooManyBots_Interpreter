"use client";

import React, { useState } from "react";
import type { HouseShopItem } from "@/lib/types";

type HabboCatalogModalProps = {
  isOpen: boolean;
  onClose: () => void;
  coins: number;
  catalog: HouseShopItem[];
  onBuyItem: (item: HouseShopItem) => void;
  onApplyStyle: (item: HouseShopItem) => void;
};

export default function HabboCatalogModal({ isOpen, onClose, coins, catalog, onBuyItem, onApplyStyle }: HabboCatalogModalProps) {
  const [activeCategory, setActiveCategory] = useState<"all" | HouseShopItem["kind"]>("all");

  if (!isOpen) return null;

  const categories = [
    { id: "all", label: "Todos", emoji: "🛍️" },
    { id: "furniture", label: "Mobília", emoji: "🛋️" },
    { id: "wallpaper", label: "Paredes", emoji: "🧱" },
    { id: "floor", label: "Pisos", emoji: "🪵" },
    { id: "window", label: "Janelas", emoji: "🪟" },
  ] as const;

  const filteredItems = catalog.filter((item) => activeCategory === "all" || item.kind === activeCategory);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-2 backdrop-blur-sm animate-in fade-in duration-200 sm:p-4">
      <div className="relative flex h-[92svh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-amber-500/30 bg-slate-900/95 shadow-2xl shadow-amber-950/40 backdrop-blur-xl sm:h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 border-b border-slate-800 p-3 sm:p-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/20 text-xl shadow-inner sm:h-11 sm:w-11 sm:text-2xl">
              🏪
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold tracking-tight text-slate-100 sm:text-xl">Catálogo do Beco</h3>
              <p className="hidden text-xs text-slate-400 sm:block">Móveis e estilos para transformar sua casa</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 font-mono text-xs font-bold text-amber-400 sm:px-4 sm:text-sm">
              🪙 <span>{coins.toLocaleString()}</span> <span className="hidden text-xs text-amber-500/80 sm:inline">moedas</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar catálogo"
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Body layout with Sidebar categories */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden sm:flex-row">
          {/* Sidebar */}
          <div className="flex w-full flex-none gap-1 overflow-x-auto border-b border-slate-800 bg-slate-950/40 p-2 sm:w-48 sm:flex-col sm:space-y-1 sm:overflow-visible sm:border-r sm:border-b-0 sm:p-3">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`flex w-auto flex-none items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-all sm:w-full sm:gap-3 sm:py-2.5 ${
                  activeCategory === cat.id
                    ? "bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                }`}
              >
                <span className="text-base">{cat.emoji}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* Grid View */}
          <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-4">
              {filteredItems.map((item) => {
                const isStyle = item.kind === "wallpaper" || item.kind === "floor" || item.kind === "window";
                const canAfford = coins >= item.cost;

                return (
                  <div
                    key={item.id}
                    className="group relative flex min-w-0 flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/80 p-3 transition-all hover:border-amber-500/40 hover:bg-amber-950/10 sm:p-4"
                  >
                    <div>
                      <div className="my-2 flex h-16 w-full items-center justify-center rounded-xl bg-slate-900/90 text-3xl shadow-inner transition-transform group-hover:scale-105 sm:h-20 sm:text-4xl">
                        {item.emoji}
                      </div>
                      <h4 className="font-bold text-slate-200 text-sm">{item.name}</h4>
                      <p className="mt-1 text-[11px] text-slate-400 line-clamp-2 leading-relaxed">{item.description}</p>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-900 pt-3 sm:mt-4">
                      <div className="font-mono text-xs font-bold text-amber-400 flex items-center gap-1">
                        🪙 {item.cost > 0 ? item.cost : "Grátis"}
                      </div>

                      {isStyle ? (
                        <button
                          onClick={() => onApplyStyle(item)}
                          disabled={!canAfford && !item.owned}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all shadow-md ${
                            item.applied
                              ? "bg-emerald-600 text-white cursor-default"
                              : canAfford || item.owned
                              ? "bg-amber-500 text-slate-950 hover:bg-amber-400 active:scale-95"
                              : "bg-slate-800 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          {item.applied ? "Aplicado ✓" : item.owned ? "Aplicar" : "Comprar"}
                        </button>
                      ) : (
                        <button
                          onClick={() => onBuyItem(item)}
                          disabled={!canAfford}
                          className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all shadow-md ${
                            canAfford
                              ? "bg-amber-500 text-slate-950 hover:bg-amber-400 active:scale-95"
                              : "bg-slate-800 text-slate-500 cursor-not-allowed"
                          }`}
                        >
                          Comprar 🛒
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
