"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HousePlayer, HouseView } from "@/lib/types";
import { createRealtimeLifecycleController } from "@/lib/realtimeLifecycle";

type WireEvent = { seq?: number; type: string; data: Record<string, unknown> };
export type RealtimeChatMessage = { id: string; senderId: string; text: string; createdAt: number };
export type RealtimeSignal = { id: string; fromParticipantId: string; toParticipantId: string; kind: "offer" | "answer" | "ice" | "ready"; payload: unknown };
type SessionResponse = { sessionId: string; streamTicket: string; roomId: string; self: { id: string }; nextClientSeq?: number };
type ActiveSession = Omit<SessionResponse, "streamTicket">;
type WireParticipant = { id: string; x?: number; y?: number; moving?: boolean; nickname?: string; avatar?: HousePlayer["avatar"] };
type PolledSignal = Omit<RealtimeSignal, "id"> & { seq: number };
type PollResponse = { snapshot: Record<string, unknown>; signals?: PolledSignal[]; nextSignalSeq?: number };

function toPlayer(participant: WireParticipant, fallbackAvatar: HouseView["avatar"]): HousePlayer {
  return {
    id: participant.id,
    x: Number(participant.x) || 0,
    y: Number(participant.y) || 0,
    moving: Boolean(participant.moving),
    nickname: String(participant.nickname || "VIZINHO"),
    avatar: participant.avatar || fallbackAvatar,
  };
}

function newerAvatar(current: HousePlayer["avatar"], incoming: HousePlayer["avatar"]) {
  return Number(incoming?.revision || 0) > Number(current?.revision || 0) ? incoming : current;
}

export function useHouseRealtime(token: string, scene: "street" | "house", sceneId: string, fallbackAvatar: HouseView["avatar"]) {
  const [players, setPlayers] = useState<HousePlayer[]>([]);
  const [messages, setMessages] = useState<RealtimeChatMessage[]>([]);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [signals, setSignals] = useState<RealtimeSignal[]>([]);
  const [sessionKey, setSessionKey] = useState("");
  const [selfId, setSelfId] = useState("");
  const sessionRef = useRef<ActiveSession | null>(null);
  const lifecycleRef = useRef(createRealtimeLifecycleController());

  const post = useCallback(async (action: string, body: Record<string, unknown>, keepalive = false) => {
    const session = sessionRef.current;
    if (!session) return;
    const response = await fetch(`/api/fun/houses/${token}/realtime/${action}`, {
      method: "POST", keepalive, headers: { "Content-Type": "application/json", "X-House-Token": token },
      body: JSON.stringify({ sessionId: session.sessionId, ...body }),
    });
    if (!response.ok) throw new Error(`realtime-${action}-${response.status}`);
  }, [token]);

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    let source: EventSource | null = null;
    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let streamWatchdog: ReturnType<typeof setTimeout> | null = null;
    let polling = false;
    let attempts = 0;
    let lastSignalSeq = 0;
    const leave = (session: ActiveSession | null) => {
      if (!session) return;
      void fetch(`/api/fun/houses/${token}/realtime/leave`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-House-Token": token }, body: JSON.stringify({ sessionId: session.sessionId }) }).catch(() => undefined);
    };
    const resetRoom = () => { setPlayers([]); setMessages([]); setSignals([]); };
    const stopPolling = () => {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      polling = false;
    };
    const clearStreamWatchdog = () => {
      if (streamWatchdog) clearTimeout(streamWatchdog);
      streamWatchdog = null;
    };
    const connect = async () => {
      if (cancelled) return;
      setConnection("connecting");
      const previous = sessionRef.current;
      sessionRef.current = null;
      source?.close();
      source = null;
      stopPolling();
      clearStreamWatchdog();
      leave(previous);
      resetRoom();
      try {
        const response = await fetch(`/api/fun/houses/${token}/session`, { method: "POST", headers: { "Content-Type": "application/json", "X-House-Token": token }, body: JSON.stringify({ scene, sceneId }) });
        if (response.status === 403 || response.status === 401) { setConnection("offline"); return; }
        if (!response.ok) throw new Error("realtime-session");
        const sessionResponse = await response.json() as SessionResponse;
        const { streamTicket, ...session } = sessionResponse;
        if (cancelled) { leave(session); return; }
        const generation = lifecycle.acceptSession(session.roomId, sessionResponse.nextClientSeq);
        sessionRef.current = session; setSessionKey(`${session.roomId}:${session.sessionId}:${session.self.id}`); setSelfId(session.self.id);
        let reconnect = () => undefined;
        const receiveEvent = (event: WireEvent, trackSequence = true) => {
          if (!lifecycle.isCurrent(generation)) return;
          if (trackSequence && event.seq) {
            const decision = lifecycle.acceptServerSeq(event.seq);
            if (decision === "drop") return;
            if (decision === "resync") { reconnect(); return; }
          }
          const data = event.data;
          if (event.type === "snapshot") {
            const list = (data.participants as WireParticipant[] || []).filter((p) => p.id !== session.self.id);
            setPlayers(list.map((participant) => toPlayer(participant, fallbackAvatar)));
            setMessages((data.recentMessages as RealtimeChatMessage[] || []).slice(-20));
          } else if (event.type === "presence") {
            const participant = data.participant as WireParticipant;
            if (participant.id !== session.self.id) setPlayers((current) => {
              if (data.action === "leave") return current.filter((player) => player.id !== participant.id);
              const incoming = toPlayer(participant, fallbackAvatar);
              const existing = current.find((player) => player.id === participant.id);
              return existing
                ? current.map((player) => player.id === participant.id ? { ...player, ...incoming, avatar: newerAvatar(player.avatar, incoming.avatar) } : player)
                : [...current, incoming];
            });
          } else if (event.type === "movement" && data.participantId !== session.self.id) setPlayers((current) => current.map((p) => p.id === data.participantId ? { ...p, x: Number(data.x), y: Number(data.y), moving: Boolean(data.moving) } : p));
          else if (event.type === "avatar" && data.participantId !== session.self.id) {
            const avatar = data.avatar as HousePlayer["avatar"];
            setPlayers((current) => current.map((player) => player.id === data.participantId ? {
              ...player,
              nickname: String(data.nickname || player.nickname),
              avatar: newerAvatar(player.avatar, avatar),
            } : player));
          }
          else if (event.type === "chat") { const message = data as unknown as RealtimeChatMessage; setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current.slice(-19), message]); }
          else if (event.type === "signal" && data.toParticipantId === session.self.id) {
            const signal = data as Omit<RealtimeSignal, "id">;
            const id = `${session.sessionId}:${event.seq || Date.now()}`;
            if (event.seq) lastSignalSeq = Math.max(lastSignalSeq, event.seq);
            setSignals((current) => current.some((item) => item.id === id) ? current : [...current.slice(-63), { ...signal, id }]);
          }
        };
        const enablePolling = () => {
          if (cancelled || polling || !lifecycle.isCurrent(generation)) return;
          source?.close();
          source = null;
          polling = true;
          const poll = async () => {
            if (cancelled || !polling || !lifecycle.isCurrent(generation)) return;
            try {
              const pollResponse = await fetch(`/api/fun/houses/${token}/realtime/poll`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-House-Token": token },
                body: JSON.stringify({ sessionId: session.sessionId, afterSignalSeq: lastSignalSeq }),
              });
              if (pollResponse.status === 401 || pollResponse.status === 403) {
                polling = false;
                reconnect();
                return;
              }
              if (!pollResponse.ok) throw new Error("realtime-poll");
              const payload = await pollResponse.json() as PollResponse;
              receiveEvent({ type: "snapshot", data: payload.snapshot });
              for (const signal of payload.signals || []) {
                receiveEvent({ seq: signal.seq, type: "signal", data: signal }, false);
              }
              lastSignalSeq = Math.max(lastSignalSeq, Number(payload.nextSignalSeq) || 0);
              attempts = 0;
              setConnection("online");
            } catch {
              if (!cancelled) setConnection("offline");
            } finally {
              if (!cancelled && polling && lifecycle.isCurrent(generation)) {
                pollTimer = setTimeout(() => { pollTimer = null; void poll(); }, 1000);
              } else {
                polling = false;
              }
            }
          };
          void poll();
        };
        if (window.location.hostname.endsWith(".trycloudflare.com")) {
          enablePolling();
          return;
        }
        source = new EventSource(`/api/fun/houses/${token}/realtime/stream?ticket=${encodeURIComponent(streamTicket)}`);
        source.onopen = () => {
          if (!lifecycle.isCurrent(generation)) return;
          setConnection("online");
        };
        reconnect = () => {
          if (cancelled || reconnectTimer || !lifecycle.isCurrent(generation)) return;
          setConnection("offline"); source?.close();
          reconnectTimer = setTimeout(() => { reconnectTimer = null; attempts += 1; void connect(); }, Math.min(8000, 500 * 2 ** attempts));
        };
        source.onerror = () => { clearStreamWatchdog(); enablePolling(); };
        const receive = (raw: MessageEvent<string>) => {
          clearStreamWatchdog();
          stopPolling();
          attempts = 0;
          receiveEvent(JSON.parse(raw.data) as WireEvent);
        };
        ["snapshot", "presence", "movement", "avatar", "chat", "signal", "signal-meta"].forEach((name) => source?.addEventListener(name, receive as EventListener));
        streamWatchdog = setTimeout(() => { streamWatchdog = null; enablePolling(); }, 2000);
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(() => { reconnectTimer = null; attempts += 1; void connect(); }, Math.min(8000, 500 * 2 ** attempts));
      }
    };
    const onPageHide = () => leave(sessionRef.current); window.addEventListener("pagehide", onPageHide); void connect();
    return () => { cancelled = true; lifecycle.invalidate(); if (reconnectTimer) clearTimeout(reconnectTimer); clearStreamWatchdog(); stopPolling(); source?.close(); leave(sessionRef.current); sessionRef.current = null; resetRoom(); setSessionKey(""); setSelfId(""); setConnection("connecting"); window.removeEventListener("pagehide", onPageHide); };
  }, [fallbackAvatar, scene, sceneId, token]);

  const move = useCallback((x: number, y: number, moving: boolean) => { const clientSeq = lifecycleRef.current.nextClientSeq(); void post("move", { x, y, moving, clientSeq }).catch(() => undefined); }, [post]);
  const sendChat = useCallback((text: string) => post("chat", { text }), [post]);
  return { players, messages, connection, sessionKey, selfId, signals, move, sendChat, signal: (body: Record<string, unknown>) => post("signal", body) };
}
