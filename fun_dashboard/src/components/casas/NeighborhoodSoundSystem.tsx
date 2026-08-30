"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Clock3, Link2, Music2, Plus, Radio, Search, Volume2, VolumeX, X } from "lucide-react";
import { funApi } from "@/lib/api";
import type { SoundSystemState, SoundSystemTrack, YouTubeSearchResult } from "@/lib/types";
import type { SoundSystemScreenRect } from "./StreetWorld";
import { soundSystemVisualStateKey } from "@/lib/soundSystemStatePolicy.js";

type Props = {
  token: string;
  open: boolean;
  tvScreenRect: SoundSystemScreenRect | null;
  onOpen: () => void;
  onClose: () => void;
};

type PlayerEvent = { target: YouTubePlayer; data: number };
type YouTubePlayer = {
  loadVideoById: (input: { videoId: string; startSeconds?: number }) => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  mute: () => void;
  unMute: () => void;
  setVolume: (volume: number) => void;
  destroy: () => void;
};
type YouTubeApi = {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YouTubePlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number };
};

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (youtubeApiPromise) return youtubeApiPromise;
  youtubeApiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("youtube-player-unavailable"));
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = () => reject(new Error("youtube-player-unavailable"));
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (message.includes("youtube-search-not-configured")) return "A pesquisa interna precisa da variável YOUTUBE_API_KEY. Colar links já está disponível.";
  if (message.includes("youtube-link-invalid")) return "Cole um link válido de vídeo do YouTube.";
  if (message.includes("queue-full")) return "A fila do bairro já chegou ao limite de 30 músicas.";
  if (message.includes("track-still-playing")) return "Essa música ainda está tocando no relógio do bairro.";
  return "O paredão não conseguiu concluir a ação. Tente novamente.";
}

export default function NeighborhoodSoundSystem({ token, open, tvScreenRect, onOpen, onClose }: Props) {
  const playerHost = useRef<HTMLDivElement>(null);
  const browserPlayerSlot = useRef<HTMLDivElement>(null);
  const player = useRef<YouTubePlayer | null>(null);
  const playerReady = useRef(false);
  const loadedVideoId = useRef("");
  const currentState = useRef<SoundSystemState | null>(null);
  const soundActiveRef = useRef(false);
  const soundPreferredRef = useRef(false);
  const autoplayFallbackPending = useRef(false);
  const volumeRef = useRef(82);
  const serverOffsetMs = useRef(0);
  const reportedTrack = useRef("");
  const advancingTrack = useRef("");
  const [state, setState] = useState<SoundSystemState | null>(null);
  const [address, setAddress] = useState("");
  const [results, setResults] = useState<YouTubeSearchResult[]>([]);
  const [soundActive, setSoundActive] = useState(false);
  const [volume, setVolume] = useState(82);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [browserPlayerRect, setBrowserPlayerRect] = useState<SoundSystemScreenRect | null>(null);

  const commitState = useCallback((next: SoundSystemState) => {
    currentState.current = next;
    setState((previous) => soundSystemVisualStateKey(previous) === soundSystemVisualStateKey(next) ? previous : next);
  }, []);

  const desiredSeconds = useCallback((track: SoundSystemTrack) => {
    const serverNow = Date.now() + serverOffsetMs.current;
    return Math.max(0, (serverNow - track.startedAt) / 1000);
  }, []);

  const loadCurrent = useCallback((force = false) => {
    const active = currentState.current?.current;
    const instance = player.current;
    if (!active || !instance || !playerReady.current) return;
    const startSeconds = desiredSeconds(active);
    if (!soundActiveRef.current) instance.mute();
    if (force || loadedVideoId.current !== active.videoId) {
      loadedVideoId.current = active.videoId;
      reportedTrack.current = "";
      advancingTrack.current = "";
      instance.loadVideoById({ videoId: active.videoId, startSeconds });
    } else {
      const drift = Math.abs(instance.getCurrentTime() - startSeconds);
      if (drift > 1.5) instance.seekTo(startSeconds, true);
    }
    if (soundActiveRef.current) instance.unMute();
    else instance.mute();
    instance.playVideo();
  }, [desiredSeconds]);

  const refresh = useCallback(async () => {
    const requestedAt = Date.now();
    const response = await funApi.houses.soundSystem(token);
    serverOffsetMs.current = response.serverNow - (requestedAt + Date.now()) / 2;
    commitState(response);
    loadCurrent();
    return response;
  }, [commitState, loadCurrent, token]);

  const reportDuration = useCallback(async (trackId: string, durationSeconds: number) => {
    if (reportedTrack.current === trackId || durationSeconds < 1) return;
    reportedTrack.current = trackId;
    try {
      const response = await funApi.houses.reportSoundDuration(token, trackId, durationSeconds);
      commitState(response.state);
    } catch {
      reportedTrack.current = "";
    }
  }, [commitState, token]);

  const advance = useCallback(async (trackId: string) => {
    if (advancingTrack.current === trackId) return;
    advancingTrack.current = trackId;
    try {
      const response = await funApi.houses.advanceSound(token, trackId);
      commitState(response.state);
      loadCurrent(true);
    } catch {
      advancingTrack.current = "";
      void refresh().catch(() => undefined);
    }
  }, [commitState, loadCurrent, refresh, token]);

  useEffect(() => {
    soundActiveRef.current = soundActive;
  }, [soundActive]);

  useEffect(() => {
    const preferred = window.localStorage.getItem("casas-paredao-sound") === "on";
    soundPreferredRef.current = preferred;
    if (preferred) {
      soundActiveRef.current = true;
      setSoundActive(true);
    }
    const unlockPreferredSound = () => {
      if (!soundPreferredRef.current || soundActiveRef.current || !currentState.current?.current) return;
      soundActiveRef.current = true;
      setSoundActive(true);
      player.current?.unMute();
      loadCurrent(true);
    };
    window.addEventListener("pointerdown", unlockPreferredSound, { capture: true });
    return () => window.removeEventListener("pointerdown", unlockPreferredSound, { capture: true });
  }, [loadCurrent]);

  useEffect(() => {
    volumeRef.current = volume;
    player.current?.setVolume(volume);
  }, [volume]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const schedule = (delay: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void tick(), delay);
    };
    const tick = async () => {
      try {
        await refresh();
      } catch (err) {
        if (!cancelled && !currentState.current) setError(errorMessage(err));
      } finally {
        if (!cancelled) schedule(document.hidden ? 15_000 : 2_500);
      }
    };
    const onVisibility = () => { if (!document.hidden) schedule(0); };
    document.addEventListener("visibilitychange", onVisibility);
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let instance: YouTubePlayer | null = null;
    void loadYouTubeApi().then((yt) => {
      if (cancelled || !playerHost.current) return;
      instance = new yt.Player(playerHost.current, {
        width: "100%",
        height: "100%",
        videoId: "",
        playerVars: { playsinline: 1, controls: 1, rel: 0, modestbranding: 1, origin: window.location.origin },
        events: {
          onReady: (event: PlayerEvent) => {
            player.current = event.target;
            playerReady.current = true;
            event.target.setVolume(volumeRef.current);
            if (soundActiveRef.current) event.target.unMute();
            else event.target.mute();
            loadCurrent(true);
          },
          onStateChange: (event: PlayerEvent) => {
            const track = currentState.current?.current;
            if (!track) return;
            if (event.data === yt.PlayerState.PLAYING) void reportDuration(track.id, event.target.getDuration());
            if (event.data === yt.PlayerState.ENDED) void advance(track.id);
          },
          onAutoplayBlocked: (event: PlayerEvent) => {
            soundActiveRef.current = false;
            setSoundActive(false);
            if (autoplayFallbackPending.current) return;
            autoplayFallbackPending.current = true;
            event.target.mute();
            window.setTimeout(() => {
              autoplayFallbackPending.current = false;
              event.target.playVideo();
            }, 0);
          },
        },
      });
    }).catch(() => setError("O player do YouTube não pôde ser carregado."));
    return () => {
      cancelled = true;
      playerReady.current = false;
      player.current = null;
      instance?.destroy();
    };
  }, [advance, loadCurrent, reportDuration]);

  useLayoutEffect(() => {
    if (!open || !browserPlayerSlot.current) return;
    const slot = browserPlayerSlot.current;
    const updateRect = () => {
      const rect = slot.getBoundingClientRect();
      const style = getComputedStyle(slot);
      const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
      const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
      const borderTop = Number.parseFloat(style.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0;
      const width = Math.max(0, rect.width - borderLeft - borderRight);
      const height = Math.max(0, rect.height - borderTop - borderBottom);
      setBrowserPlayerRect({ left: rect.left + borderLeft, top: rect.top + borderTop, width, height, visible: width > 0 && height > 0 });
    };
    const observer = new ResizeObserver(updateRect);
    const browser = slot.closest(".paredao-browser");
    observer.observe(slot);
    window.addEventListener("resize", updateRect);
    browser?.addEventListener("transitionend", updateRect);
    const settleTimer = window.setTimeout(updateRect, 260);
    updateRect();
    return () => {
      window.clearTimeout(settleTimer);
      observer.disconnect();
      window.removeEventListener("resize", updateRect);
      browser?.removeEventListener("transitionend", updateRect);
    };
  }, [open, error, results.length]);

  const activateSound = useCallback(() => {
    soundPreferredRef.current = true;
    window.localStorage.setItem("casas-paredao-sound", "on");
    soundActiveRef.current = true;
    setSoundActive(true);
    player.current?.unMute();
    loadCurrent(true);
  }, [loadCurrent]);

  const deactivateSound = useCallback(() => {
    soundPreferredRef.current = false;
    window.localStorage.removeItem("casas-paredao-sound");
    soundActiveRef.current = false;
    setSoundActive(false);
    player.current?.mute();
    player.current?.playVideo();
  }, []);

  const enqueue = useCallback(async (url: string) => {
    try {
      setBusy(true);
      setError("");
      const response = await funApi.houses.enqueueSound(token, url);
      commitState(response.state);
      setResults([]);
      setAddress("");
      loadCurrent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [commitState, loadCurrent, token]);

  const submitAddress = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const value = address.trim();
    if (!value) return;
    if (/youtu(?:\.be|be\.com)|^[A-Za-z0-9_-]{11}$/i.test(value)) {
      await enqueue(value);
      return;
    }
    if (!state?.searchEnabled) {
      setError("A pesquisa interna ainda não tem YOUTUBE_API_KEY. Cole um link do YouTube na barra.");
      return;
    }
    try {
      setBusy(true);
      setError("");
      setResults((await funApi.houses.searchYouTube(token, value)).results);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }, [address, enqueue, state?.searchEnabled, token]);

  const current = state?.current || null;
  const elapsed = current ? desiredSeconds(current) : 0;
  const activePlayerRect = open ? browserPlayerRect : tvScreenRect;
  // No mobile Safari, se opacity for 0 ou tamanho for 0x0, o WebKit congela o iframe.
  // Mantemos visibilidade mínima para áudio contínuo.
  const playerSurfaceStyle: CSSProperties = activePlayerRect ? {
    left: activePlayerRect.left,
    top: activePlayerRect.top,
    width: Math.max(1, activePlayerRect.width),
    height: Math.max(1, activePlayerRect.height),
    opacity: current && activePlayerRect.visible ? 1 : 0.001,
    pointerEvents: open ? "auto" : "none",
  } : { opacity: 0.001, width: 1, height: 1, pointerEvents: "none" };

  return <>
    <div className={`paredao-live-player ${open ? "is-browser" : "is-street"}`} style={playerSurfaceStyle} aria-label={open ? "Player de vídeo do paredão" : "Vídeo tocando na TV ao lado do paredão"}>
      <div ref={playerHost} className="paredao-player" />
    </div>

    <button type="button" className={`paredao-now-playing ${soundActive ? "is-live" : ""}`} onClick={onOpen} aria-label="Abrir navegador virtual do Paredão do Beco">
      <span className="paredao-now-icon"><Radio size={15} /></span>
      <span><b>{current ? current.title : "Paredão do Beco"}</b><small>{current ? `${formatTime(elapsed)} · ${soundActive ? "som ativo" : "toque para ouvir"}` : "fila aberta"}</small></span>
    </button>

    <div className={`paredao-backdrop ${open ? "is-open" : ""}`} aria-hidden={!open} onMouseDown={onClose}>
      <section className="paredao-browser" role="dialog" aria-modal="true" aria-label="Navegador virtual do Paredão do Beco" onMouseDown={(event) => event.stopPropagation()}>
        <header className="paredao-browser-titlebar">
          <div className="paredao-browser-dots" aria-hidden="true"><i /><i /><i /></div>
          <div className="paredao-browser-tab"><Music2 size={14} /><span>Paredão do Beco</span></div>
          <button type="button" onClick={onClose} aria-label="Fechar navegador virtual"><X size={18} /></button>
        </header>

        <form className="paredao-addressbar" onSubmit={(event) => void submitAddress(event)}>
          <span aria-hidden="true">{address.includes("youtu") ? <Link2 size={15} /> : <Search size={15} />}</span>
          <input value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} placeholder="Pesquise no YouTube ou cole um link…" aria-label="Pesquisar ou colar link do YouTube" />
          <button type="submit" disabled={busy}>{busy ? "Aguarde" : "Ir"}</button>
        </form>

        {error ? <div className="paredao-error">{error}</div> : null}
        {results.length ? <div className="paredao-search-results" aria-label="Resultados da pesquisa">
          {results.map((result) => <article key={result.videoId}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.thumbnailUrl} alt="" />
            <div><b>{result.title}</b><small>{result.channelTitle}</small></div>
            <button type="button" disabled={busy} onClick={() => void enqueue(result.url)} aria-label={`Adicionar ${result.title}`}><Plus size={16} /></button>
          </article>)}
        </div> : null}

        <div className="paredao-browser-body">
          <section className="paredao-tv-column">
            <div ref={browserPlayerSlot} className="paredao-tv-frame">
              {!current ? <div className="paredao-player-empty"><Radio size={34} /><b>O paredão está esperando a primeira música</b><span>Cole um link do YouTube na barra acima.</span></div> : null}
            </div>
            <div className="paredao-current">
              <div className="paredao-current-copy"><span>TOCANDO AGORA</span><b>{current?.title || "Nenhuma música na fila"}</b><small>{current ? `Pedido de ${current.requestedBy}` : "O bairro está em silêncio."}</small></div>
              <div className="paredao-sound-controls">
                <button type="button" className={soundActive ? "active" : ""} onClick={soundActive ? deactivateSound : activateSound} disabled={!current}>
                  {soundActive ? <Volume2 size={17} /> : <VolumeX size={17} />}{soundActive ? "Som ligado" : "Ativar som"}
                </button>
                <label><span>Volume</span><input type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /></label>
              </div>
            </div>
          </section>

          <aside className="paredao-queue">
            <div className="paredao-queue-heading"><div><span>FILA DO BAIRRO</span><b>{state?.queue.length || 0} a seguir</b></div><Radio size={20} /></div>
            <div className="paredao-queue-list">
              {state?.queue.length ? state.queue.map((track, index) => <article key={track.id}>
                <span className="paredao-queue-index">{String(index + 1).padStart(2, "0")}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={track.thumbnailUrl} alt="" />
                <div><b>{track.title}</b><small>Pedido de {track.requestedBy}</small></div>
                <span className="paredao-duration"><Clock3 size={12} />{track.durationSeconds ? formatTime(track.durationSeconds) : "--:--"}</span>
              </article>) : <div className="paredao-queue-empty"><Music2 size={24} /><b>A próxima é sua</b><span>Todo mundo do grupo pode adicionar.</span></div>}
            </div>
            <p className="paredao-search-note">{state?.searchEnabled ? "Pesquisa e links do YouTube disponíveis dentro do jogo." : "Links funcionam agora. Para liberar pesquisa, configure YOUTUBE_API_KEY no servidor."}</p>
          </aside>
        </div>
      </section>
    </div>
  </>;
}
