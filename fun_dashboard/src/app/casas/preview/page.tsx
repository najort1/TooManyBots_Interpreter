"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import GraphicsQualityControl from "@/components/casas/GraphicsQualityControl";
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

const residentNames = [
  "Bia", "Nando", "Lua", "Jota", "Pri", "Lucas Santos", "Malu", "Davi", "Carol", "Juninho",
  "Beca", "Rafa", "Gabi", "Theo", "Lari", "Caio", "Nina", "Gui", "Iza", "Léo",
  "Tati", "Noah", "Cris", "Vini", "Maya", "Breno", "Luna", "João", "Ana",
];

const houses: NeighborhoodHouse[] = residentNames.map((nickname, index) => ({
  id: String(index + 1),
  nickname,
  cleanliness: 42 + (index * 13) % 57,
  securityLevel: index % 4,
}));

export default function StreetPreviewPage() {
  const [position, setPosition] = useState({ x: 50, y: 56 });
  const [stressPlayerCount, setStressPlayerCount] = useState(3);
  useEffect(() => {
    const requested = Number(new URLSearchParams(window.location.search).get("stress"));
    if (Number.isFinite(requested) && requested > 3) {
      setStressPlayerCount(Math.min(30, Math.floor(requested)));
    }
  }, []);
  const players = useMemo<HousePlayer[]>(() => {
    const variants: Array<Partial<AvatarSlots>> = [
      { top: "jaqueta_neon", hair: "cabelo_rosa", headAccessory: "fones_neon" },
      { top: "uniforme_arcade", faceAccessory: "oculos_pixel", neckAccessory: "corrente_brilho" },
      { top: "traje_astral", hair: "franja_azul", backAccessory: "asas_pixel" },
    ];
    return Array.from({ length: stressPlayerCount }, (_, index) => ({
      id: `preview-player-${index + 1}`,
      nickname: residentNames[index] ?? `Morador ${index + 1}`,
      avatar: avatar(variants[index % variants.length], 4 + (index % 12)),
      x: 24 + (index % 10) * 5.8,
      y: 38 + Math.floor(index / 10) * 12,
    }));
  }, [stressPlayerCount]);
  return <main className="min-h-screen bg-[#101913] p-5 text-white">
    <div className="mx-auto max-w-[1500px]">
      <header className="mb-4 flex items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.24em] text-amber-300/70">Preview de direção de arte</p><h1 className="text-2xl font-black">Bairro TooManyBots</h1></div>
        <div className="flex items-center gap-3"><p className="text-sm text-white/60">{players.length} avatares • clique no cenário ou use WASD • posição {position.x}, {position.y}</p><GraphicsQualityControl /></div>
      </header>
      <div className="h-[calc(100vh-7.5rem)] min-h-[620px] overflow-hidden rounded-2xl border border-white/10">
        <StreetWorld players={players} houses={houses} onMove={(x, y) => setPosition({ x, y })} onOpenHouse={() => undefined} />
      </div>
    </div>
  </main>;
}
