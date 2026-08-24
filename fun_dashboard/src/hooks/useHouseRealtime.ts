"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HousePlayer, HouseView } from "@/lib/types";
import { createRealtimeLifecycleController } from "@/lib/realtimeLifecycle";

type WireEvent = { seq?: number; type: string; data: Record<string, unknown> };
export type RealtimeChatMessage = { id: string; senderId: string; text: string; createdAt: number };
export type RealtimeSignal = { fromParticipantId: string; toParticipantId: string; kind: "offer" | "answer" | "ice"; payload: unknown };
type SessionResponse = { sessionId: string; streamTicket: string; roomId: string; self: { id: string }; nextClientSeq?: number };
type ActiveSession = Omit<SessionResponse, "streamTicket">;

export function useHouseRealtime(token: string, scene: "street" | "house", sceneId: string, fallbackAvatar: HouseView["avatar"]) {
  const [players, setPlayers] = useState<HousePlayer[]>([]);
  const [messages, setMessages] = useState<RealtimeChatMessage[]>([]);
  const [connection, setConnection] = useState<"connecting" | "online" | "offline">("connecting");
  const [lastSignal, setLastSignal] = useState<RealtimeSignal | null>(null);
  const [sessionKey, setSessionKey] = useState("");
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
    let attempts = 0;
    const leave = (session: ActiveSession | null) => {
      if (!session) return;
      void fetch(`/api/fun/houses/${token}/realtime/leave`, { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "X-House-Token": token }, body: JSON.stringify({ sessionId: session.sessionId }) }).catch(() => undefined);
    };
    const resetRoom = () => { setPlayers([]); setMessages([]); setLastSignal(null); };
    const connect = async () => {
      if (cancelled) return;
      setConnection("connecting");
      const previous = sessionRef.current; sessionRef.current = null; source?.close(); leave(previous); resetRoom();
      try {
        const response = await fetch(`/api/fun/houses/${token}/session`, { method: "POST", headers: { "Content-Type": "application/json", "X-House-Token": token }, body: JSON.stringify({ scene, sceneId }) });
        if (response.status === 403 || response.status === 401) { setConnection("offline"); return; }
        if (!response.ok) throw new Error("realtime-session");
        const sessionResponse = await response.json() as SessionResponse;
        const { streamTicket, ...session } = sessionResponse;
        if (cancelled) { leave(session); return; }
        const generation = lifecycle.acceptSession(session.roomId, sessionResponse.nextClientSeq);
        sessionRef.current = session; setSessionKey(`${session.roomId}:${session.sessionId}:${session.self.id}`);
        source = new EventSource(`/api/fun/houses/${token}/realtime/stream?ticket=${encodeURIComponent(streamTicket)}`);
        source.onopen = () => { if (!lifecycle.isCurrent(generation)) return; attempts = 0; setConnection("online"); };
        const reconnect = () => {
          if (cancelled || reconnectTimer || !lifecycle.isCurrent(generation)) return;
          setConnection("offline"); source?.close();
          reconnectTimer = setTimeout(() => { reconnectTimer = null; attempts += 1; void connect(); }, Math.min(8000, 500 * 2 ** attempts));
        };
        source.onerror = reconnect;
        const receive = (raw: MessageEvent<string>) => {
          if (!lifecycle.isCurrent(generation)) return;
          const event = JSON.parse(raw.data) as WireEvent;
          if (event.seq) {
            const decision = lifecycle.acceptServerSeq(event.seq);
            if (decision === "drop") return;
            if (decision === "resync") { reconnect(); return; }
          }
          const data = event.data;
          if (event.type === "snapshot") {
            const list = (data.participants as Array<{ id: string; x: number; y: number }> || []).filter((p) => p.id !== session.self.id);
            setPlayers(list.map((p) => ({ ...p, nickname: "VIZINHO", avatar: fallbackAvatar })));
            setMessages((data.recentMessages as RealtimeChatMessage[] || []).slice(-20));
          } else if (event.type === "presence") {
            const participant = data.participant as { id: string; x?: number; y?: number };
            if (participant.id !== session.self.id) setPlayers((current) => data.action === "leave" ? current.filter((p) => p.id !== participant.id) : current.some((p) => p.id === participant.id) ? current : [...current, { id: participant.id, x: participant.x || 0, y: participant.y || 0, nickname: "VIZINHO", avatar: fallbackAvatar }]);
          } else if (event.type === "movement" && data.participantId !== session.self.id) setPlayers((current) => current.map((p) => p.id === data.participantId ? { ...p, x: Number(data.x), y: Number(data.y) } : p));
          else if (event.type === "chat") { const message = data as unknown as RealtimeChatMessage; setMessages((current) => current.some((item) => item.id === message.id) ? current : [...current.slice(-19), message]); }
          else if (event.type === "signal" && data.toParticipantId === session.self.id) setLastSignal(data as unknown as RealtimeSignal);
        };
        ["snapshot", "presence", "movement", "chat", "signal"].forEach((name) => source?.addEventListener(name, receive as EventListener));
      } catch {
        if (!cancelled) reconnectTimer = setTimeout(() => { reconnectTimer = null; attempts += 1; void connect(); }, Math.min(8000, 500 * 2 ** attempts));
      }
    };
    const onPageHide = () => leave(sessionRef.current); window.addEventListener("pagehide", onPageHide); void connect();
    return () => { cancelled = true; lifecycle.invalidate(); if (reconnectTimer) clearTimeout(reconnectTimer); source?.close(); leave(sessionRef.current); sessionRef.current = null; resetRoom(); setSessionKey(""); setConnection("connecting"); window.removeEventListener("pagehide", onPageHide); };
  }, [fallbackAvatar, scene, sceneId, token]);

  const move = useCallback((x: number, y: number, moving: boolean) => { const clientSeq = lifecycleRef.current.nextClientSeq(); void post("move", { x, y, moving, clientSeq }).catch(() => undefined); }, [post]);
  const sendChat = useCallback((text: string) => post("chat", { text }), [post]);
  return { players, messages, connection, sessionKey, lastSignal, move, sendChat, signal: (body: Record<string, unknown>) => post("signal", body) };
}
