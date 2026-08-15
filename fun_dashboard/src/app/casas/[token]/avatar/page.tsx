"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { AvatarFigure } from "@/components/casas/AvatarFigure";
import { funApi } from "@/lib/api";
import type { AvatarState } from "@/lib/types";

type Props = { params: Promise<{ token: string }> };
type Slot = "hair_face" | "outfit" | "optional_accessory";

const slotConfig: Array<{ id: Slot; icon: string; label: string; description: string }> = [
  { id: "hair_face", icon: "✦", label: "Rosto", description: "Expressão e estilo" },
  { id: "outfit", icon: "▣", label: "Roupa", description: "Seu visual no bairro" },
  { id: "optional_accessory", icon: "✧", label: "Acessório", description: "O detalhe final" },
];

export default function AvatarPage({ params }: Props) {
  const { token } = use(params);
  const [avatar, setAvatar] = useState<AvatarState | null>(null);
  const [activeSlot, setActiveSlot] = useState<Slot>("hair_face");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    try {
      setAvatar(await funApi.houses.avatar(token));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Avatar indisponível.");
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const select = async (id: string) => {
    const item = avatar?.catalog.find((entry) => entry.id === id);
    if (!item) return;
    try {
      setBusyId(id);
      setError("");
      if (!item.owned && item.cost > 0) await funApi.houses.buyAvatar(token, id);
      await funApi.houses.equipAvatar(token, id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível atualizar o visual.");
    } finally {
      setBusyId("");
    }
  };

  const visibleItems = useMemo(() => avatar?.catalog.filter((item) => item.slot === activeSlot) || [], [activeSlot, avatar]);
  const currentSlot = slotConfig.find((slot) => slot.id === activeSlot) || slotConfig[0];

  if (!avatar) return <main className="grid min-h-screen place-items-center bg-[#171020] font-mono text-violet-200">{error || "Preparando o estúdio…"}</main>;

  return <main className="avatar-page">
    <header className="avatar-topbar"><Link href={`/casas/${token}`} className="avatar-back">← Voltar para casa</Link><span className="casas-coin-pill">✦ Nível {avatar.level}</span></header>
    {error && <p className="casas-toast casas-toast-error">{error}</p>}
    <div className="avatar-layout">
      <section className="avatar-stage"><div className="avatar-stage-copy"><p className="casas-kicker">ESTÚDIO DO BECO</p><h1>Seu avatar, sua presença.</h1><p>Monte o visual que todo mundo vai ver quando entrar na sua casa.</p></div><div className="avatar-mirror"><div className="avatar-mirror-glow" /><div className="avatar-mirror-frame"><AvatarFigure avatar={avatar} label="VOCÊ" /></div><span className="avatar-stage-spark avatar-stage-spark-one">✦</span><span className="avatar-stage-spark avatar-stage-spark-two">✧</span></div></section>
      <section className="avatar-wardrobe"><div className="avatar-wardrobe-heading"><div><p className="casas-kicker">GUARDA-ROUPA</p><h2>{currentSlot.label}</h2><p>{currentSlot.description}</p></div><span className="avatar-count">{visibleItems.filter((item) => item.owned).length}/{visibleItems.length}</span></div><div className="avatar-tabs">{slotConfig.map((slot) => <button key={slot.id} type="button" onClick={() => setActiveSlot(slot.id)} className={`avatar-tab ${slot.id === activeSlot ? "avatar-tab-active" : ""}`}><span>{slot.icon}</span><span>{slot.label}</span></button>)}</div><div className="avatar-items" key={activeSlot}>{visibleItems.map((item) => { const equipped = avatar.slots[item.slot] === item.id; const lockedByLevel = !item.owned && item.cost === 0; return <button key={item.id} type="button" disabled={busyId === item.id || lockedByLevel} onClick={() => void select(item.id)} className={`avatar-item ${equipped ? "avatar-item-equipped" : ""} ${!item.owned ? "avatar-item-locked" : ""}`}><span className="avatar-item-emoji">{item.emoji}</span><span className="min-w-0 flex-1 text-left"><b>{item.name}</b><small>{equipped ? "Equipado agora" : item.owned ? "Disponível para equipar" : item.cost ? `${item.cost} coins para liberar` : `Libera no nível ${item.unlockLevel}`}</small></span><span className="avatar-item-state">{equipped ? "✓" : item.owned ? "Usar" : item.cost ? "Comprar" : "🔒"}</span></button>; })}</div></section>
    </div>
  </main>;
}
