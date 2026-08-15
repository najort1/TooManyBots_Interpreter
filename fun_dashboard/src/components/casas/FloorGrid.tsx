"use client";

import type { HouseItem } from "@/lib/types";

const EMOJI: Record<string, string> = {
  sofa_inicial: "🛋️", planta_inicial: "🪴", tapete_rua: "🟫", luminaria_neon: "💡", estante_caotica: "🗄️", tv_tubo: "📺", geladeira_premium: "🧊", gato_sindico: "🐈", camera_porta: "📹",
};

export default function FloorGrid({ items, onItemClick }: { items: HouseItem[]; onItemClick?: (item: HouseItem) => void }) {
  return <div className="grid aspect-[3/4] grid-cols-6 grid-rows-8 gap-1 rounded-2xl border border-amber-900/15 bg-amber-100 p-2 shadow-inner dark:border-amber-200/10 dark:bg-amber-950/35">{Array.from({ length: 48 }, (_, index) => { const x = index % 6; const y = Math.floor(index / 6); const item = items.find((entry) => entry.placed && entry.x === x && entry.y === y); return <button key={index} type="button" onClick={() => item && onItemClick?.(item)} className="flex min-h-0 items-center justify-center rounded-md bg-white/45 text-xl transition hover:bg-white/80 dark:bg-zinc-900/35 dark:hover:bg-zinc-800">{item ? EMOJI[item.itemId] || "📦" : ""}</button>; })}</div>;
}
