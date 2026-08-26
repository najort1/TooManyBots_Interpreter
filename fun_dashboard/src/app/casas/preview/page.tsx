"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { AvatarSlots, HousePlayer, NeighborhoodHouse } from "@/lib/types";

const StreetWorld = dynamic(() => import("@/components/casas/StreetWorld"), { ssr: false });

const avatar = (slots: Partial<AvatarSlots>, level: number): HousePlayer["avatar"] => ({
  schemaVersion: 2,
  revision: 1,
  catalogRevision: 1,
  level,
  slots: {
    body: "corpo_beco", skinTone: "skin_warm", face: "face_beco", hair: "hair_short",
    top: "camiseta_beco", bottom: "bottom_beco", shoes: "shoes_beco",
    headAccessory: "none", faceAccessory: "none", neckAccessory: "none",
    backAccessory: "none", waistAccessory: "none", ...slots,
  },
});

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
    { id: "bia", nickname: "Bia", avatar: avatar({ top: "jaqueta_neon", hair: "cabelo_rosa", headAccessory: "fones_neon" }, 8), x: 38, y: 54 },
    { id: "nando", nickname: "Nando", avatar: avatar({ top: "uniforme_arcade", faceAccessory: "oculos_pixel", neckAccessory: "corrente_brilho" }, 5), x: 63, y: 49 },
    { id: "lua", nickname: "Lua", avatar: avatar({ top: "traje_astral", hair: "franja_azul", backAccessory: "asas_pixel" }, 12), x: 72, y: 73 },
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
