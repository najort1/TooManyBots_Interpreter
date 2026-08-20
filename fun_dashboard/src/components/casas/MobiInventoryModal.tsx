"use client";

import React from "react";
import type { HouseItem, HouseShopItem } from "@/lib/types";

type MobiInventoryModalProps = {
  isOpen: boolean;
  onClose: () => void;
  inventory: HouseItem[];
  catalogMap: Map<string, HouseShopItem>;
  onPlaceItem: (item: HouseItem) => void;
};

export default function MobiInventoryModal({ isOpen, onClose, inventory, catalogMap, onPlaceItem }: MobiInventoryModalProps) {
  if (!isOpen) return null;

  const unplacedItems = inventory.filter((item) => !item.placed && !item.stolen);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-2xl border border-purple-500/30 bg-slate-900/95 p-6 shadow-2xl shadow-purple-950/50 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/20 text-xl border border-purple-500/40">
              💼
            </div>
            <div>
              <h3 className="font-bold text-slate-100 text-lg">Mala de Mobis</h3>
              <p className="text-xs text-slate-400">Seus móveis guardados no inventário</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-slate-200 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 max-h-[60vh] overflow-y-auto pr-1">
          {unplacedItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <span className="text-4xl mb-3 opacity-60">📦</span>
              <p className="text-sm text-slate-400 font-medium">Sua mala de mobis está vazia!</p>
              <p className="text-xs text-slate-500 mt-1">Compre novos itens na loja ou recolha móveis da casa.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {unplacedItems.map((item) => {
                const def = catalogMap.get(item.itemId);
                return (
                  <div
                    key={item.id}
                    className="group relative flex flex-col items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3 hover:border-purple-500/50 hover:bg-purple-950/20 transition-all"
                  >
                    <div className="my-2 flex h-14 w-14 items-center justify-center rounded-lg bg-slate-900 text-3xl group-hover:scale-110 transition-transform">
                      {def?.emoji || "🛋️"}
                    </div>
                    <div className="w-full text-center">
                      <p className="truncate text-xs font-semibold text-slate-200">{def?.name || item.itemId}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">Pronto para colocar</p>
                    </div>
                    <button
                      onClick={() => onPlaceItem(item)}
                      className="mt-3 w-full rounded-lg bg-purple-600 px-2 py-1.5 text-xs font-bold text-white hover:bg-purple-500 active:scale-95 transition-all shadow-md shadow-purple-950"
                    >
                      Colocar 📍
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-800 px-5 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
