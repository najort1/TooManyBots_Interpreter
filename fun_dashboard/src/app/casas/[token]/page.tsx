"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronRight, Maximize2, Plus, RotateCw } from "lucide-react";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { funApi } from "@/lib/api";
import type { HouseItem, HouseShopItem, HouseView, NeighborhoodHouse } from "@/lib/types";
import MobiInventoryModal from "@/components/casas/MobiInventoryModal";
import HabboCatalogModal from "@/components/casas/HabboCatalogModal";
import SpeechBubbleLayer, { type ChatMessage } from "@/components/casas/SpeechBubbleLayer";
import { soundEngine } from "@/lib/soundEngine";
import { useHouseRealtime } from "@/hooks/useHouseRealtime";
import { useHouseVoice } from "@/hooks/useHouseVoice";

const HouseGame = dynamic(() => import("@/components/casas/HouseGame3D"), {
  ssr: false,
  loading: () => <div className="house-game-canvas casas-loading bg-[#251839]" />,
});
const StreetWorld = dynamic(() => import("@/components/casas/StreetWorld"), {
  ssr: false,
  loading: () => <div className="house-game-canvas casas-loading bg-[#251839]" />,
});

type Props = { params: Promise<{ token: string }> };
type Screen = "home" | "neighborhood" | "neighbor";
type NeighborView = { id: string; house: HouseView };

const itemNames: Record<string, string> = {
  sofa_inicial: "Sofá de entrada",
  planta_inicial: "Planta sobrevivente",
  tapete_rua: "Tapete da rua",
  mesa_cafe: "Mesa de café",
  vaso_flores: "Vaso florido",
  luminaria_neon: "Luminária neon",
  puff_estrela: "Puff estrela",
  poltrona_vintage: "Poltrona vintage",
  estante_caotica: "Estante caótica",
  tv_tubo: "TV de tubo",
  cama_nuvem: "Cama nuvem",
  jukebox_neon: "Jukebox neon",
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

function normalizeShopItems(items: HouseShopItem[]) {
  return items.map((item) => ({
    ...item,
    kind: item.kind || "furniture",
    description: item.description || "Item de decoração do beco.",
    owned: Boolean(item.owned),
    applied: Boolean(item.applied),
  }));
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
  const [shop, setShop] = useState<HouseShopItem[]>([]);
  const [shopOpen, setShopOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [muralOpen, setMuralOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  const catalogMap = useMemo(() => {
    const map = new Map<string, HouseShopItem>();
    shop.forEach((item) => map.set(item.id, item));
    return map;
  }, [shop]);
  const [giftCoins, setGiftCoins] = useState("25");
  const [visitNote, setVisitNote] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const realtimeAvatar = useMemo(() => ownHouse?.avatar || { slots: {}, level: 1 }, [ownHouse?.avatar]);
  const realtimeScene = screen === "neighborhood" ? "street" as const : "house" as const;
  const realtimeSceneId = screen === "neighbor" ? neighborView?.id || token : screen === "neighborhood" ? "street" : token;
  const realtime = useHouseRealtime(token, realtimeScene, realtimeSceneId, realtimeAvatar);
  const voice = useHouseVoice(realtime.players, realtime.lastSignal, realtime.signal);
  const stopVoice = voice.stop;
  useEffect(() => { stopVoice(); }, [realtime.sessionKey, stopVoice]);

  useEffect(() => {
    setChatMessages(realtime.messages.map((message) => ({ id: message.id, senderJid: message.senderId, nickname: message.senderId === "you" ? "Você" : "VIZINHO", text: message.text, createdAt: message.createdAt })));
  }, [realtime.messages]);

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
    void funApi.houses.shop(token)
      .then((response) => setShop(normalizeShopItems(response.shop)))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "O catálogo de móveis está indisponível."));
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`/api/fun/houses/${token}/stream`);
    es.addEventListener("chat", (event) => {
      try {
        const data: ChatMessage = JSON.parse(event.data);
        setChatMessages((prev) => {
          if (prev.some((m) => m.id === data.id)) return prev;
          return [...prev.slice(-19), data];
        });
        soundEngine.playChatBubbleSound();
      } catch {}
    });
    return () => es.close();
  }, [token]);

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
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ação indisponível.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [neighborView, refresh, token]);

  const openShop = useCallback(async () => {
    try {
      setError("");
      setShop(normalizeShopItems((await funApi.houses.shop(token)).shop));
      setShopOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "A loja está indisponível.");
    }
  }, [token]);

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

  const enterFullscreenLandscape = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      // O layout continua ocupando 100dvh quando a API de fullscreen não é permitida.
    }
    try {
      const orientation = window.screen.orientation as ScreenOrientation & { lock?: (value: "landscape") => Promise<void> };
      await orientation.lock?.("landscape");
    } catch {
      // Safari/iOS e alguns navegadores só permitem que o usuário gire manualmente.
    }
  }, []);

  const selectedItem = useMemo(() => ownHouse?.items.find((item) => item.id === selectedItemId) || null, [ownHouse, selectedItemId]);
  const rotateSelectedItem = useCallback(async () => {
    if (!selectedItem || busy) return;
    const previousRotation = Number.isFinite(selectedItem.rotation) ? selectedItem.rotation : selectedItem.rotated ? 1 : 0;
    const nextRotation = (previousRotation + 1) % 4;
    setOwnHouse((current) => current ? {
      ...current,
      items: current.items.map((item) => item.id === selectedItem.id ? { ...item, rotation: nextRotation, rotated: nextRotation % 2 === 1 } : item),
    } : current);
    try {
      setBusy(true);
      setError("");
      await funApi.houses.move(token, {
        itemId: selectedItem.id,
        x: selectedItem.x,
        y: selectedItem.y,
        rotation: nextRotation,
        rotated: nextRotation % 2 === 1,
      });
      await refresh();
      setNotice("Móvel girado.");
    } catch (err) {
      setOwnHouse((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === selectedItem.id ? { ...item, rotation: previousRotation, rotated: previousRotation % 2 === 1 } : item),
      } : current);
      setError(err instanceof Error ? err.message : "Não foi possível girar o móvel.");
    } finally {
      setBusy(false);
    }
  }, [busy, refresh, selectedItem, token]);
  const displayedHouse = screen === "neighbor" ? neighborView?.house || ownHouse : ownHouse;
  const coins = ownHouse?.coins ?? 0;
  const chooseShopItem = useCallback(async (item: HouseShopItem) => {
    if (!ownHouse) return;
    if (item.kind === "furniture") {
      const cell = findFreeCell(ownHouse.items);
      if (!cell) {
        setError("Sua casa está cheia.");
        return;
      }
      const saved = await runAction(() => funApi.houses.place(token, { itemId: item.id, ...cell }), `${item.name} colocado na casa.`);
      if (saved) setShopOpen(false);
      return;
    }
    const saved = await runAction(() => funApi.houses.applyStyle(token, item.id), `${item.name} aplicado na casa.`);
    if (saved) setShop(normalizeShopItems((await funApi.houses.shop(token)).shop));
  }, [ownHouse, runAction, token]);

  if (error && !ownHouse) return <main className="grid min-h-screen place-items-center bg-[#171020] p-6 text-center text-zinc-50"><div className="casas-error-card"><p className="casas-kicker">CASAS DO BECO</p><span className="casas-error-icon" aria-hidden="true">🏚️</span><h1>Casa indisponível</h1><p className="mt-2 text-violet-200">{error}</p></div></main>;
  if (!displayedHouse || !ownHouse) return <main className="grid min-h-screen place-items-center bg-[#171020]"><div className="casas-loading-card"><span className="casas-loading-house" aria-hidden="true">🏠</span><p>Carregando o bairro…</p><span className="casas-loading-bar"><span /></span></div></main>;

  const isHome = screen === "home";
  const isNeighbor = screen === "neighbor" && neighborView;

  return <main className="house-page casas-world-page casas-world-page-fullscreen">
    <section className="casas-game-shell">
      <header className="casas-topbar">
        <div className="casas-heading">
          <p className="casas-brand"><span aria-hidden="true">🏠</span><b>CASAS DO BECO</b></p>
          <div className="casas-title-row"><span aria-hidden="true">⌂</span><h1>{screen === "neighborhood" ? "Bairro do grupo" : isNeighbor ? displayedHouse.host?.nickname || "Casa de um vizinho" : "Sua casa"}</h1></div>
        </div>
        <div className="casas-topbar-actions">
          <button type="button" className="casas-fullscreen-button" onClick={() => void enterFullscreenLandscape()} aria-label="Usar tela cheia em paisagem" title="Tela cheia">
            <Maximize2 size={17} />
          </button>
          <button type="button" className="casas-coin-pill" onClick={() => void openShop()} aria-label={`${coins} moedas. Abrir catálogo`}>
            <span aria-hidden="true">🪙</span><strong>{coins}</strong><span className="casas-coin-plus" aria-hidden="true"><Plus size={15} strokeWidth={3} /></span>
          </button>
          <nav className="casas-desktop-nav" aria-label="Navegação de Casas do Beco"><IconButton active={isHome} icon="🏠" label="Casa" onClick={() => { setNeighborView(null); setScreen("home"); }} /><IconButton active={screen === "neighborhood"} icon="🌆" label="Bairro" onClick={() => { setNeighborView(null); setScreen("neighborhood"); }} /><Link href={`/casas/${token}/avatar`} className="casas-nav-button"><span>🙂</span><span>Avatar</span></Link></nav>
        </div>
      </header>

      {error && <p className="casas-toast casas-toast-error">{error.includes("cooldown") ? "⏳ Aguarde alguns segundos para realizar esta ação novamente." : `⚠ ${error}`}</p>}
      {notice && <p className="casas-toast">✦ {notice}</p>}

      <div className="absolute right-3 top-24 z-30 flex items-center gap-2 rounded-xl bg-[#241735]/90 px-3 py-2 text-xs text-white shadow-lg">
        <span aria-live="polite">{voice.enabled ? voice.isSpeaking ? "🎙️ Falando" : "🎙️ Voz ativa" : "🔇 Voz desligada"}</span>
        <button type="button" className="casas-small-button" onClick={() => void (voice.enabled ? voice.stop() : voice.start())}>{voice.enabled ? "Desligar" : "Ativar voz"}</button>
        {voice.error ? <span className="text-red-200">{voice.error}</span> : null}
      </div>

      <SpeechBubbleLayer
        messages={chatMessages}
        onSendMessage={async (text) => {
          const localMsg: ChatMessage = {
            id: 'local_' + Date.now(),
            senderJid: "you",
            nickname: ownHouse.host?.nickname || 'Você',
            text,
            isNpc: false,
            createdAt: Date.now(),
          };
          setChatMessages((prev) => [...prev.slice(-19), localMsg]);
          soundEngine.playChatBubbleSound();
          try {
            await realtime.sendChat(text);
          } catch {
            setError("Mensagem não enviada. Verifique sua conexão.");
          }
        }}
      />
      {screen === "neighborhood" ? <StreetWorld players={realtime.players} houses={neighborhood} localAvatar={ownHouse?.avatar} speaking={voice.isSpeaking} onMove={realtime.move} onOpenHouse={(neighbor) => void openNeighbor(neighbor)} /> : <HouseGame remotePlayers={realtime.players} speaking={voice.isSpeaking} onAvatarMove={realtime.move} mode="house" house={displayedHouse} catalog={shop} neighborhood={neighborhood} owns={isHome} selectedItemId={isHome ? selectedItemId : undefined} interactionLocked={busy || !shop.length || shopOpen || inventoryOpen || muralOpen} onExit={leaveScene} onOpenNeighbor={(neighbor) => void openNeighbor(neighbor)} onSelectItem={(item) => { setSelectedItemId(item.id); soundEngine.playRotateMobiSound(); }} onClearSelection={() => setSelectedItemId(undefined)} onMoveItem={(item, x, y) => { soundEngine.playPlaceMobiSound(); return runAction(() => funApi.houses.move(token, { itemId: item.id, x, y, rotation: item.rotation, rotated: item.rotated }), "Móvel reposicionado."); }} />}

      {isHome && <div className="casas-stage-status">
        <span className="casas-hud-stat">
          <b>🧹 Limpeza {ownHouse.house.cleanliness}%</b>
          <small>conservação do cômodo</small>
          <span className="casas-hud-bar"><span style={{ width: `${Math.max(4, Math.min(100, ownHouse.house.cleanliness))}%` }} /></span>
        </span>
        <span className="casas-hud-stat">
          <b>🛡️ Segurança Nv. {ownHouse.house.securityLevel}</b>
          <small>proteção da casa</small>
          <span className="casas-hud-pips">{[1, 2, 3].map((level) => <i key={level} className={level <= ownHouse.house.securityLevel ? "on" : ""} />)}</span>
        </span>
      </div>}
      {isHome && <div className="casas-stage-hint">{selectedItem ? `Selecionado: ${itemNames[selectedItem.itemId] || "Móvel"}` : "Clique em um móvel para decorar"}</div>}
    </section>

    {isHome && <div className="casas-actions-wrapper">
      <section className="casas-daily-banner" aria-label="Recompensa diária">
        <div className="casas-daily-info">
          <span className="casas-daily-icon">🎁</span>
          <div>
            <b>Recompensa Diária</b>
            <p>Colete moedas grátis todos os dias para sua casa.</p>
          </div>
        </div>
        <button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.collect(token), "Recompensa diária coletada!")} className="casas-daily-button">
          <span>Coletar</span><span aria-hidden="true">🪙</span>
        </button>
      </section>

      <section className="casas-game-dock-grid">
        <button type="button" disabled={busy} onClick={() => setInventoryOpen(true)} className="casas-dock-card">
          <span className="casas-dock-icon">💼</span><span className="casas-dock-copy"><b>Mala de Mobis</b><small>Seus móveis guardados.</small></span><ChevronRight className="casas-dock-arrow" size={17} />
        </button>
        <button type="button" disabled={busy} onClick={() => void openShop()} className="casas-dock-card">
          <span className="casas-dock-icon">📕</span><span className="casas-dock-copy"><b>Catálogo</b><small>Novos móveis e estilos.</small></span><ChevronRight className="casas-dock-arrow" size={17} />
        </button>
        <button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.upgradeSecurity(token), "Segurança melhorada.")} className="casas-dock-card">
          <span className="casas-dock-icon">🛡️</span><span className="casas-dock-copy"><b>Segurança</b><small>Proteção nível {ownHouse.house.securityLevel}.</small></span><ChevronRight className="casas-dock-arrow" size={17} />
        </button>
        <button type="button" onClick={() => setMuralOpen(true)} className="casas-dock-card">
          <span className="casas-dock-icon">📌</span><span className="casas-dock-copy"><b>Mural</b><small>Recados de quem visitou.</small></span><ChevronRight className="casas-dock-arrow" size={17} />
        </button>
      </section>

      {selectedItem && (
        <div className="casas-selected-item-actions">
          <button type="button" disabled={busy} onClick={() => void rotateSelectedItem()} className="casas-small-button">
            ↻ Girar Móvel
          </button>
          <button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.sell(token, selectedItem.id), "Móvel vendido.")} className="casas-small-button casas-rob-button">
            ◫ Vender Móvel
          </button>
        </div>
      )}
    </div>}

    {screen === "neighborhood" && <section className="casas-context-panel casas-neighborhood-panel"><span className="casas-context-icon">🌆</span><div><p className="casas-kicker">MAPA SOCIAL</p><h2>Escolha uma porta e visite o bairro.</h2><p>Os moradores aparecem com a aparência que salvaram no avatar.</p></div></section>}

    {isNeighbor && <section className="casas-context-panel casas-visit-panel"><span className="casas-context-icon">👋</span><div className="min-w-0 flex-1"><p className="casas-kicker">VISITANDO</p><h2>Deixe sua marca no mural.</h2><div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><input value={visitNote} onChange={(event) => setVisitNote(event.target.value)} maxLength={120} placeholder="Passei para conhecer!" className="casas-field" /><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.visitNeighbor(token, neighborView.id, visitNote), "Visita registrada no mural.", true)} className="casas-small-button">Visitar</button></div><div className="mt-3 flex flex-wrap gap-2"><input type="number" min="1" value={giftCoins} onChange={(event) => setGiftCoins(event.target.value)} className="casas-coin-input" /><button type="button" disabled={busy} onClick={() => { const amount = Math.floor(Number(giftCoins)); if (amount > 0) void runAction(() => funApi.houses.giftNeighbor(token, neighborView.id, amount), "Presente enviado.", true); else setError("Informe uma quantidade válida de coins."); }} className="casas-small-button casas-gift-button">🎁 Presentear</button><button type="button" disabled={busy} onClick={() => void runAction(() => funApi.houses.robNeighbor(token, neighborView.id), "A tentativa de roubo foi resolvida.", true)} className="casas-small-button casas-rob-button">🕵️ Tentar roubo</button><button type="button" onClick={() => setMuralOpen(true)} className="casas-small-button">📌 Mural</button></div></div></section>}

    <footer className="casas-footer"><span>Casas do Beco</span><i aria-hidden="true" /><span>Seu cantinho no grupo.</span></footer>

    <nav className="casas-mobile-nav" aria-label="Navegação de Casas do Beco"><IconButton active={isHome} icon="🏠" label="Casa" onClick={() => { setNeighborView(null); setScreen("home"); }} /><IconButton active={screen === "neighborhood"} icon="🌆" label="Bairro" onClick={() => { setNeighborView(null); setScreen("neighborhood"); }} /><Link href={`/casas/${token}/avatar`} className="casas-nav-button"><span>🙂</span><span>Avatar</span></Link></nav>

    <section className="casas-orientation-gate" role="dialog" aria-modal="true" aria-label="Gire o celular para jogar">
      <span className="casas-orientation-icon" aria-hidden="true"><RotateCw size={34} /></span>
      <p className="casas-kicker">MODO DE JOGO</p>
      <h2>Gire o celular</h2>
      <p>Casas do Beco usa a tela inteira em paisagem para mostrar o bairro, os controles e seus amigos.</p>
      <button type="button" onClick={() => void enterFullscreenLandscape()}><Maximize2 size={17} /> Entrar em tela cheia</button>
    </section>

    <MobiInventoryModal
      isOpen={inventoryOpen}
      onClose={() => setInventoryOpen(false)}
      inventory={ownHouse?.items || []}
      catalogMap={catalogMap}
      onPlaceItem={async (item) => {
        const cell = findFreeCell(ownHouse.items);
        if (!cell) {
          setError("Sua casa está cheia.");
          return;
        }
        const saved = await runAction(() => funApi.houses.place(token, { itemId: item.itemId, ...cell }), "Móvel posicionado na casa!");
        if (saved) setInventoryOpen(false);
      }}
    />

    <HabboCatalogModal
      isOpen={shopOpen}
      onClose={() => setShopOpen(false)}
      coins={coins}
      catalog={shop}
      onBuyItem={(item) => void chooseShopItem(item)}
      onApplyStyle={(item) => void chooseShopItem(item)}
    />

    {muralOpen && <div className="casas-sheet-backdrop" role="presentation" onMouseDown={() => setMuralOpen(false)}><section className="casas-sheet" role="dialog" aria-modal="true" aria-label="Mural de visitas" onMouseDown={(event) => event.stopPropagation()}><div className="casas-sheet-handle" /><div className="flex items-start justify-between gap-3"><div><p className="casas-kicker">MURAL DO BECO</p><h2>Quem passou por aqui</h2></div><button type="button" onClick={() => setMuralOpen(false)} className="casas-close-button">Fechar</button></div><div className="mt-4 space-y-2">{displayedHouse.mural.length ? displayedHouse.mural.map((visit, index) => <article key={visit.id || index} className="casas-visit-entry"><span>🙂</span><div><b>{visit.nickname || "Visitante"}</b><p>{visit.note || "Passou para conhecer a casa."}</p>{visit.createdAt ? <small>{timeAgo(visit.createdAt)}</small> : null}</div></article>) : <p className="casas-empty-state">Ainda não houve visitas. Saia para conhecer o bairro e comece a conversa.</p>}</div></section></div>}
  </main>;
}
