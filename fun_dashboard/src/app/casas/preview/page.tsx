"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { HousePlayer, NeighborhoodHouse } from "@/lib/types";

const StreetWorld = dynamic(() => import("@/components/casas/StreetWorld"), { ssr: false });

const houses: NeighborhoodHouse[] = [
  { id: "1", nickname: "Casa da Bia", cleanliness: 88, securityLevel: 2 },
  { id: "2", nickname: "QG do Nando", cleanliness: 72, securityLevel: 1 },
  { id: "3", nickname: "Apê da Lua", cleanliness: 95, securityLevel: 3 },
  { id: "4", nickname: "Casa do Jota", cleanliness: 61, securityLevel: 1 },
  { id: "5", nickname: "Vila da Pri", cleanliness: 80, securityLevel: 2 },
];

export default function StreetPreviewPage() {
  const [position, setPosition] = useState({ x: 50, y: 56 });
  const players = useMemo<HousePlayer[]>(() => [
    { id: "bia", nickname: "Bia", avatar: { level: 8, slots: { outfit: "jaqueta_neon", hair_face: "cabelo_rosa", optional_accessory: "fones_neon" } }, x: 38, y: 54 },
    { id: "nando", nickname: "Nando", avatar: { level: 5, slots: { outfit: "uniforme_arcade", hair_face: "oculos_pixel", optional_accessory: "corrente_brilho" } }, x: 63, y: 49 },
    { id: "lua", nickname: "Lua", avatar: { level: 12, slots: { outfit: "traje_astral", hair_face: "franja_azul", optional_accessory: "asas_pixel" } }, x: 72, y: 73 },
  ], []);
  return <main className="min-h-screen bg-[#101913] p-5 text-white">
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.24em] text-amber-300/70">Preview de direção de arte</p><h1 className="text-2xl font-black">Bairro TooManyBots</h1></div>
        <p className="text-sm text-white/60">Clique no cenário ou use WASD • posição {position.x}, {position.y}</p>
      </header>
      <StreetWorld players={players} houses={houses} onMove={(x, y) => setPosition({ x, y })} onOpenHouse={() => undefined} />
    </div>
  </main>;
}
