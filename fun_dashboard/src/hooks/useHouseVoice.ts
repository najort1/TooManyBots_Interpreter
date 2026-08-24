"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HousePlayer } from "@/lib/types";
import type { RealtimeSignal } from "./useHouseRealtime";

type SendSignal = (body: Record<string, unknown>) => Promise<void> | void;

export function useHouseVoice(players: HousePlayer[], incoming: RealtimeSignal | null, sendSignal: SendSignal) {
  const [enabled, setEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const audioRef = useRef(new Map<string, HTMLAudioElement>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const speakingFrameRef = useRef<number | null>(null);
  const speakingRef = useRef(false);

  const setSpeaking = useCallback((next: boolean) => {
    if (speakingRef.current === next) return;
    speakingRef.current = next;
    setIsSpeaking(next);
  }, []);
  const stopSpeakingMonitor = useCallback(() => {
    if (speakingFrameRef.current != null) cancelAnimationFrame(speakingFrameRef.current);
    speakingFrameRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setSpeaking(false);
  }, [setSpeaking]);

  const closePeer = useCallback((id: string) => {
    peersRef.current.get(id)?.close(); peersRef.current.delete(id);
    const audio = audioRef.current.get(id); if (audio) { audio.srcObject = null; audio.remove(); }
    audioRef.current.delete(id);
  }, []);
  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    [...peersRef.current.keys()].forEach(closePeer); setEnabled(false);
    stopSpeakingMonitor();
  }, [closePeer, stopSpeakingMonitor]);
  const peerFor = useCallback((id: string) => {
    const existing = peersRef.current.get(id); if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    streamRef.current?.getTracks().forEach((track) => peer.addTrack(track, streamRef.current!));
    peer.onicecandidate = (event) => { if (event.candidate) void sendSignal({ toParticipantId: id, kind: "ice", payload: event.candidate.toJSON() }); };
    peer.ontrack = (event) => {
      let audio = audioRef.current.get(id);
      if (!audio) { audio = document.createElement("audio"); audio.autoplay = true; audio.hidden = true; document.body.appendChild(audio); audioRef.current.set(id, audio); }
      audio.srcObject = event.streams[0];
    };
    peer.onconnectionstatechange = () => { if (["failed", "closed"].includes(peer.connectionState)) closePeer(id); };
    peersRef.current.set(id, peer); return peer;
  }, [closePeer, sendSignal]);
  const start = useCallback(async () => {
    try {
      setError(""); streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("Seu navegador não oferece análise de áudio para o indicador de fala.");
      const context = new AudioContextCtor();
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(streamRef.current).connect(analyser);
      audioContextRef.current = context;
      const samples = new Uint8Array(analyser.fftSize);
      const monitor = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        setSpeaking(rms > .027);
        speakingFrameRef.current = requestAnimationFrame(monitor);
      };
      monitor();
      setEnabled(true);
      for (const player of players) {
        const peer = peerFor(player.id); const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
        await sendSignal({ toParticipantId: player.id, kind: "offer", payload: offer });
      }
    } catch { stop(); setError("Não foi possível acessar o microfone."); }
  }, [peerFor, players, sendSignal, setSpeaking, stop]);

  useEffect(() => {
    if (!enabled || !incoming) return;
    void (async () => {
      const peer = peerFor(incoming.fromParticipantId);
      if (incoming.kind === "ice") await peer.addIceCandidate(incoming.payload as RTCIceCandidateInit);
      else {
        await peer.setRemoteDescription(incoming.payload as RTCSessionDescriptionInit);
        if (incoming.kind === "offer") { const answer = await peer.createAnswer(); await peer.setLocalDescription(answer); await sendSignal({ toParticipantId: incoming.fromParticipantId, kind: "answer", payload: answer }); }
      }
    })().catch(() => closePeer(incoming.fromParticipantId));
  }, [closePeer, enabled, incoming, peerFor, sendSignal]);
  useEffect(() => { if (enabled) for (const id of peersRef.current.keys()) if (!players.some((p) => p.id === id)) closePeer(id); }, [closePeer, enabled, players]);
  useEffect(() => stop, [stop]);
  return { enabled, isSpeaking, error, start, stop };
}
