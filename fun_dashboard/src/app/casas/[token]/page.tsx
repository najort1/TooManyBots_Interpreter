"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { funApi } from "@/lib/api";
import type { HouseItem, HouseView, NeighborhoodHouse } from "@/lib/types";

const HouseGame = dynamic(() => import("@/components/casas/HouseGame"), {
  ssr: false,
  loading: () => <div className="house-game-canvas casas-loading bg-[#251839]" />,
});

type Props = { params: Promise<{ token: string }> };
type Screen = "home" | "neighborhood" | "neighbor";
type ShopItem = { id: string; name: string; emoji: string; cost: number };
type NeighborView = { id: string; house: HouseView };

const itemNames: Record<string, string> = {
  sofa_inicial: "Sofá de entrada",
  planta_inicial: "Planta sobrevivente",
  tapete_rua: "Tapete da rua",
  luminaria_neon: "Luminária neon",
  estante_caotica: "Estante caótica",
  tv_tubo: "TV de tubo",
  geladeira_premium: "Geladeira premium",
  gato_sindico: "Gato síndico",
  camera_porta: "Câmera de porta",
};

function findFreeCell(items: HouseItem[]) {
  const occupied = new Set(items.filter((item) => item.placed).map((item) => `${item.x}:${item.y}`));
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 6; x += 1) {
      if (!occupied.has(`${x}:${y}`)) return { x, y };
    }
  }
  return null;
}

function timeAgo(timestamp: number) {
  const seconds = Math.max(1, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "agora mesmo";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d atrás`;
  return new Date(timestamp).toLocaleDateString("pt-BR");
}

function IconButton({ active, icon, label, onClick }: { active?: boolean; icon: string; label: string; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`casas-nav-button ${active ? "casas-nav-button-active" : ""}`}><span aria-hidden="true">{icon}</span><span>{label}</span></button>;
}

export default function CasaPage({ params }: Props) {
  const { token } = use(params);
  const [ownHouse, setOwnHouse] = useState<HouseView | null>(null);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodHouse[]>([]);
  const [screen, setScreen] = useState<Screen>("home");
  const [neighborView, setNeighborView] = useState<NeighborView | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const [shop, setShop] = useState<ShopItem[]>([]);
  const [shopOpen, setShopOpen] = useState(false);
  const [muralOpen, setMuralOpen] = useState(false);
  const [giftCoins, setGiftCoins] = useState("25");
  const [visitNote, setVisitNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [houseResponse, neighborhoodResponse] = await Promise.all([funApi.houses.get(token), funApi.houses.neighborhood(token)]);
    setOwnHouse(houseResponse);
    setNeighborhood(neighborhoodResponse.houses);
    setSelectedItemId((current) => current && houseResponse.items.some((item) => item.id === current) ? current : undefined);
  }, [token]);

  useEffect(() => {
    void refresh().catch((err: unknown) => setError(err instanceof Error ? err.message : "Não foi possível abrir a casa."));
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const runAction = useCallback(async (operation: () => Promise<unknown>, success: string, refreshNeighbor = false) => {
    try {
      setBusy(true);
      setError("");
      await operation();
      await refresh();
      if (refreshNeighbor && neighborView) {
        const house = await funApi.houses.neighbor(token, neighborView.id);
        setNeighborView({ id: neighborView.id, house });
      }
      setNotice(success);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ação indisponível.");
    } finally {
      setBusy(false);
    }
  }, [neighborView, refresh, token]);

  const openShop = useCallback(async () => {
    try {
      setError("");
      if (!shop.length) setShop((await funApi.houses.shop(token)).shop);
      setShopOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "A loja está indisponível.");
    }
  }, [shop.length, token]);

  const openNeighbor = useCallback(async (neighbor: NeighborhoodHouse) => {
    try {
      setBusy(true);
      setError("");
      setNeighborView({ id: neighbor.id, house: await funApi.houses.neighbor(token, neighbor.id) });
      setSelectedItemId(undefined);
      setScreen("neighbor");
    } catch (err) {
      setError(err instanceof Error ? err.message : "A casa do vizinho não está disponível.");
    } finally {
      setBusy(false);
    }
  }, [token]);

  const leaveScene = useCallback(() => {
    setShopOpen(false);
    setSelectedItemId(undefined);
    setScreen((current) => current === "neighborhood" ? "home" : "neighborhood");
    if (screen === "neighbor") setNeighborView(null);
  }, [screen]);

  const selectedItem = useMemo(() => ownHouse?.items.find((item) => item.id === selectedItemId) || null, [ownHouse, selectedItemId]);
  const displayedHouse = screen === "neighbor" ? neighborView?.house || ownHouse : ownHouse;
  const coins = ownHouse?.coins ?? 0;

  if (error && !ownHouse) return <main className="grid min-h-screen place-items-center bg-[#171020] p-6 text-center text-zinc-50"><div className="casas-error-card"><p className="casas-kicker">CASAS DO BECO</p><span className="casas-error-icon" aria-hidden="true">🏚️</span><h1>Casa indisponível</h1><p className="mt-2 text-violet-200">{error}</p></div></main>;
  if (!displayedHouse || !ownHouse) return <main className="grid min-h-screen place-items-center bg-[#171020]"><div className="casas-loading-card"><span className="casas-loading-house" aria-hidden="true">🏠</span><p>Carregando o bairro…</p><span className="casas-loading-bar"><span /></span></div></main>;

  const isHome = screen === "home";
  const isNeighbor = screen === "neighbor" && neighborView;

  return <main className="house-page casas-world-page">
    <header className="casas-topbar">
      <div><p className="casas-kicker">CASAS DO BECO</p><h1>{screen === "neighborhood" ? "Bairro do grupo" : isNeighbor ? displayedHouse.host?.nickname || "Casa de um vizinho" : "Sua casa"}</h1></div>
      <div className="casas-topbar-actions"><span className="casas-coin-pill">🪙 {coins}</span><nav className="casas-desktop-nav"><IconButton active={isHome} icon="🏠" label="Casa" onClick={() => { setNeighborView(null); setScreen("home"); }} /><IconButton active={screen === "neighborhood"} icon="🌆" label="Bairro" onClick={() => { setNeighborView(null); setScreen("neighborhood"); }} /><Link href={`/casas/${token}/avatar`} className="casas-nav-button"><span>🙂</span><span>Avatar</span></Link></nav></div>
    </header>

    {error && <p className="casas-toast casas-toast-error">⚠ {error}</p>}
    {notice && <p className="casas-toast">✦ {notice}</p>}

    <section className="casas-game-shell">
      <HouseGame mode={screen === "neighborhood" ? "neighborhood" : "house"} house={displayedHouse} neighborhood={neighborhood} owns={isHome} selectedItemId={isHome ? selectedItemId : undefined} onExit={leaveScene} onOpenNeighbor={(neighbor) => void openNeighbor(neighbor)} onSelectItem={(item) => setSelectedItemId(item.id)} onMoveItem={(item, x, y) => void runAction(() => funApi.houses.move(token, { itemId: item.id, x, y, rotated: item.rotated }), "Móvel reposicionado.")} />

      {isHome && <div className="casas-stage-status">
        <span className="casas-hud-stat">
          <b>🧹 {ownHouse.house.cleanliness}%</b>
          <small>casa cuidada</small>
          <span className="casas-hud-bar"><span style={{ width: `${Math.max(4, Math.min(100, ownHouse.house.cleanliness))}%` }} /></span>
        </span>
        <span className="casas-hud-stat">
          <b>🛡 Nv. {ownHouse.house.securityLevel}</b>
          <small>segurança</small>
          <span className="casas-hud-pips">{[1, 2, 3].map((level) => <i key={level} className={level <= ownHouse.house.securityLevel ? "on" : ""} />)}</span>
        </span>
      </div>}
      {isHome && <div className="casas-stage-hint">{selectedItem ? `Selecionado: ${itemNames[selectedItem.itemId] || "Móvel"}` : "Clique em um móvel para decorar"}</div>}
    </section>

    {isHome && <section className="casas-game-dock"><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.collect(token), "Recompensa diária coletada.")} className="casas-primary-action"><span aria-hidden="true">🎁</span><span><b>Coletar diária</b><small>recompensa da casa</small></span></button><button type="button" disabled={busy} onClick={() => void openShop()} className="casas-dock-action"><span aria-hidden="true">🛋️</span><span>Loja</span></button><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.upgradeSecurity(token), "Segurança melhorada.")} className="casas-dock-action"><span aria-hidden="true">🛡️</span><span>Segurança</span></button><button type="button" onClick={() => setMuralOpen(true)} className="casas-dock-action"><span aria-hidden="true">📌</span><span>Mural</span></button>{selectedItem && <><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.move(token, { itemId: selectedItem.id, x: selectedItem.x, y: selectedItem.y, rotated: !selectedItem.rotated }), "Móvel girado.")} className="casas-dock-action"><span aria-hidden="true">↻</span><span>Girar</span></button><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.sell(token, selectedItem.id), "Móvel vendido.")} className="casas-dock-action casas-dock-danger"><span aria-hidden="true">◫</span><span>Vender</span></button></>}</section>}

    {screen === "neighborhood" && <section className="casas-context-panel"><span className="casas-context-icon">🌆</span><div><p className="casas-kicker">MAPA SOCIAL</p><h2>Escolha uma porta e visite o bairro.</h2><p>Os moradores aparecem com a aparência que salvaram no avatar. A presença em tempo real ficará para uma futura etapa.</p></div></section>}

    {isNeighbor && <section className="casas-context-panel casas-visit-panel"><span className="casas-context-icon">👋</span><div className="min-w-0 flex-1"><p className="casas-kicker">VISITANDO</p><h2>Deixe sua marca no mural.</h2><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><input value={visitNote} onChange={(event) => setVisitNote(event.target.value)} maxLength={120} placeholder="Passei para conhecer!" className="casas-field" /><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.visitNeighbor(token, neighborView.id, visitNote), "Visita registrada no mural.", true)} className="casas-small-button">Visitar</button></div><div className="mt-3 flex flex-wrap gap-2"><input type="number" min="1" value={giftCoins} onChange={(event) => setGiftCoins(event.target.value)} className="casas-coin-input" /><button type="button" disabled={busy} onClick={() => { const amount = Math.floor(Number(giftCoins)); if (amount > 0) void runAction(() => funApi.houses.giftNeighbor(token, neighborView.id, amount), "Presente enviado.", true); else setError("Informe uma quantidade válida de coins."); }} className="casas-small-button casas-gift-button">🎁 Presentear</button><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.robNeighbor(token, neighborView.id), "A tentativa de roubo foi resolvida.", true)} className="casas-small-button casas-rob-button">🕵️ Tentar roubo</button><button type="button" onClick={() => setMuralOpen(true)} className="casas-small-button">📌 Mural</button></div></div></section>}

    <nav className="casas-mobile-nav"><IconButton active={isHome} icon="🏠" label="Casa" onClick={() => { setNeighborView(null); setScreen("home"); }} /><IconButton active={screen === "neighborhood"} icon="🌆" label="Bairro" onClick={() => { setNeighborView(null); setScreen("neighborhood"); }} /><Link href={`/casas/${token}/avatar`} className="casas-nav-button"><span>🙂</span><span>Avatar</span></Link></nav>

    {muralOpen && <div className="casas-sheet-backdrop" role="presentation" onMouseDown={() => setMuralOpen(false)}><section className="casas-sheet" role="dialog" aria-modal="true" aria-label="Mural de visitas" onMouseDown={(event) => event.stopPropagation()}><div className="casas-sheet-handle" /><div className="flex items-start justify-between gap-3"><div><p className="casas-kicker">MURAL DO BECO</p><h2>Quem passou por aqui</h2></div><button type="button" onClick={() => setMuralOpen(false)} className="casas-close-button">Fechar</button></div><div className="mt-4 space-y-2">{displayedHouse.mural.length ? displayedHouse.mural.map((visit, index) => <article key={visit.id || index} className="casas-visit-entry"><span>🙂</span><div><b>{visit.nickname || "Visitante"}</b><p>{visit.note || "Passou para conhecer a casa."}</p>{visit.createdAt ? <small>{timeAgo(visit.createdAt)}</small> : null}</div></article>) : <p className="casas-empty-state">Ainda não houve visitas. Saia para conhecer o bairro e comece a conversa.</p>}</div></section></div>}

    {shopOpen && <div className="casas-sheet-backdrop" role="presentation" onMouseDown={() => setShopOpen(false)}><section className="casas-sheet casas-shop-sheet" role="dialog" aria-modal="true" aria-label="Loja do Beco" onMouseDown={(event) => event.stopPropagation()}><div className="casas-sheet-handle" /><div className="flex items-start justify-between gap-3"><div><p className="casas-kicker">LOJA DO BECO</p><h2>O que combina com sua casa?</h2></div><span className="casas-coin-pill">🪙 {coins}</span><button type="button" onClick={() => setShopOpen(false)} className="casas-close-button">Fechar</button></div><div className="casas-shop-grid">{shop.map((item) => { const affordable = item.cost <= coins; return <button key={item.id} type="button" disabled={busy || !affordable} onClick={() => { const cell = findFreeCell(ownHouse.items); if (!cell) { setError("Sua casa está cheia."); return; } void runAction(() => funApi.houses.place(token, { itemId: item.id, ...cell }), `${item.name} colocado na casa.`).then(() => setShopOpen(false)); }} className={`casas-shop-item ${affordable ? "" : "casas-shop-locked"}`}><span className="casas-shop-emoji">{item.emoji}</span><span><b>{item.name}</b><small>{affordable ? "Colocar na casa" : "Sem coins suficientes"}</small></span><strong>{item.cost}c</strong></button>; })}</div></section></div>}
  </main>;
}
