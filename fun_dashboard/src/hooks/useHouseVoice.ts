"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HousePlayer } from "@/lib/types";
import { isVoiceOfferInitiator } from "@/lib/houseVoicePolicy.js";
import { HOUSE_VOICE_SPATIAL, getHouseVoiceSpatialPosition } from "@/lib/houseVoiceSpatial.js";
import type { RealtimeSignal } from "./useHouseRealtime";

type SendSignal = (body: Record<string, unknown>) => Promise<void> | void;
type SpatialPeer = {
  source: MediaStreamAudioSourceNode;
  panner: PannerNode;
  gain: GainNode;
};

export function useHouseVoice(players: HousePlayer[], selfId: string, signals: RealtimeSignal[], sendSignal: SendSignal) {
  const [enabled, setEnabled] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [error, setError] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const audioRef = useRef(new Map<string, HTMLAudioElement>());
  const spatialPeersRef = useRef(new Map<string, SpatialPeer>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const playersRef = useRef(players);
  const listenerPositionRef = useRef({ x: 50, y: 54 });
  const speakingFrameRef = useRef<number | null>(null);
  const speakingRef = useRef(false);
  const pendingCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const makingOfferRef = useRef(new Set<string>());
  const announcedPeersRef = useRef(new Set<string>());
  const handledSignalsRef = useRef(new Set<string>());
  const signalQueueRef = useRef(Promise.resolve());
  const retryTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [peerRetryVersion, setPeerRetryVersion] = useState(0);

  const setSpeaking = useCallback((next: boolean) => {
    if (speakingRef.current === next) return;
    speakingRef.current = next;
    setIsSpeaking(next);
  }, []);

  playersRef.current = players;

  const disposeSpatialPeer = useCallback((id: string) => {
    const spatialPeer = spatialPeersRef.current.get(id);
    if (!spatialPeer) return;
    spatialPeer.source.disconnect();
    spatialPeer.panner.disconnect();
    spatialPeer.gain.disconnect();
    spatialPeersRef.current.delete(id);
  }, []);

  const updateSpatialPeer = useCallback((id: string, spatialPeer: SpatialPeer) => {
    const player = playersRef.current.find((candidate) => candidate.id === id);
    if (!player) return;
    const position = getHouseVoiceSpatialPosition(listenerPositionRef.current, player);
    const now = audioContextRef.current?.currentTime ?? 0;
    spatialPeer.panner.positionX.setTargetAtTime(position.x, now, 0.06);
    spatialPeer.panner.positionY.setTargetAtTime(position.y, now, 0.06);
    spatialPeer.panner.positionZ.setTargetAtTime(position.z, now, 0.06);
    spatialPeer.gain.gain.setTargetAtTime(position.gain, now, 0.1);
  }, []);

  const updateSpatialPeers = useCallback(() => {
    for (const [id, spatialPeer] of spatialPeersRef.current) updateSpatialPeer(id, spatialPeer);
  }, [updateSpatialPeer]);

  const setListenerPosition = useCallback((x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    listenerPositionRef.current = { x, y };
    updateSpatialPeers();
  }, [updateSpatialPeers]);

  const stopSpeakingMonitor = useCallback(() => {
    if (speakingFrameRef.current != null) cancelAnimationFrame(speakingFrameRef.current);
    speakingFrameRef.current = null;
    audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    setSpeaking(false);
  }, [setSpeaking]);

  const closePeer = useCallback((id: string) => {
    peersRef.current.get(id)?.close();
    peersRef.current.delete(id);
    pendingCandidatesRef.current.delete(id);
    makingOfferRef.current.delete(id);
    const audio = audioRef.current.get(id);
    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }
    audioRef.current.delete(id);
    disposeSpatialPeer(id);
    announcedPeersRef.current.delete(`${selfId}:${id}`);
  }, [disposeSpatialPeer, selfId]);

  const retryPeer = useCallback((id: string) => {
    closePeer(id);
    if (!streamRef.current || retryTimersRef.current.has(id)) return;
    const timer = setTimeout(() => {
      retryTimersRef.current.delete(id);
      if (streamRef.current) setPeerRetryVersion((version) => version + 1);
    }, 700);
    retryTimersRef.current.set(id, timer);
  }, [closePeer]);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    [...peersRef.current.keys()].forEach(closePeer);
    [...spatialPeersRef.current.keys()].forEach(disposeSpatialPeer);
    retryTimersRef.current.forEach((timer) => clearTimeout(timer));
    retryTimersRef.current.clear();
    pendingCandidatesRef.current.clear();
    makingOfferRef.current.clear();
    announcedPeersRef.current.clear();
    handledSignalsRef.current.clear();
    signalQueueRef.current = Promise.resolve();
    setEnabled(false);
    stopSpeakingMonitor();
  }, [closePeer, disposeSpatialPeer, stopSpeakingMonitor]);

  const connectSpatialAudio = useCallback((id: string, stream: MediaStream) => {
    const context = audioContextRef.current;
    if (!context) return false;
    try {
      disposeSpatialPeer(id);
      const source = context.createMediaStreamSource(stream);
      const panner = context.createPanner();
      panner.panningModel = "HRTF";
      panner.distanceModel = "inverse";
      panner.refDistance = HOUSE_VOICE_SPATIAL.pannerReferenceDistance;
      panner.maxDistance = HOUSE_VOICE_SPATIAL.maxDistance;
      panner.rolloffFactor = HOUSE_VOICE_SPATIAL.pannerRolloffFactor;
      const gain = context.createGain();
      source.connect(panner).connect(gain).connect(context.destination);
      const spatialPeer = { source, panner, gain };
      spatialPeersRef.current.set(id, spatialPeer);
      updateSpatialPeer(id, spatialPeer);
      void context.resume().catch(() => undefined);
      return true;
    } catch {
      return false;
    }
  }, [disposeSpatialPeer, updateSpatialPeer]);

  const peerFor = useCallback((id: string) => {
    const existing = peersRef.current.get(id);
    if (existing) return existing;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    streamRef.current?.getTracks().forEach((track) => peer.addTrack(track, streamRef.current!));
    peer.onicecandidate = (event) => {
      if (event.candidate) void sendSignal({ toParticipantId: id, kind: "ice", payload: event.candidate.toJSON() });
    };
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
      if (connectSpatialAudio(id, stream)) return;
      let audio = audioRef.current.get(id);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.hidden = true;
        document.body.appendChild(audio);
        audioRef.current.set(id, audio);
      }
      audio.srcObject = stream;
      void audio.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed") retryPeer(id);
      else if (peer.connectionState === "closed") closePeer(id);
    };
    peersRef.current.set(id, peer);
    return peer;
  }, [closePeer, connectSpatialAudio, retryPeer, sendSignal]);

  const flushCandidates = useCallback(async (id: string, peer: RTCPeerConnection) => {
    const candidates = pendingCandidatesRef.current.get(id) || [];
    pendingCandidatesRef.current.delete(id);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }, []);

  const sendOffer = useCallback(async (peerId: string) => {
    let peer = peerFor(peerId);
    if (peer.connectionState === "connected" || makingOfferRef.current.has(peerId)) return;
    if (peer.signalingState !== "stable") {
      closePeer(peerId);
      peer = peerFor(peerId);
    }
    makingOfferRef.current.add(peerId);
    try {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (peer.localDescription) await sendSignal({ toParticipantId: peerId, kind: "offer", payload: peer.localDescription.toJSON() });
    } finally {
      makingOfferRef.current.delete(peerId);
    }
  }, [closePeer, peerFor, sendSignal]);

  const handleSignal = useCallback(async (signal: RealtimeSignal) => {
    const peerId = signal.fromParticipantId;
    if (signal.kind === "ready") {
      if (isVoiceOfferInitiator(selfId, peerId)) await sendOffer(peerId);
      return;
    }

    let peer = peerFor(peerId);
    if (signal.kind === "ice") {
      if (!peer.remoteDescription) {
        const candidates = pendingCandidatesRef.current.get(peerId) || [];
        if (candidates.length < 32) candidates.push(signal.payload as RTCIceCandidateInit);
        pendingCandidatesRef.current.set(peerId, candidates);
        return;
      }
      await peer.addIceCandidate(signal.payload as RTCIceCandidateInit);
      return;
    }

    if (signal.kind === "offer") {
      if (peer.signalingState !== "stable") {
        closePeer(peerId);
        peer = peerFor(peerId);
      }
      await peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
      await flushCandidates(peerId, peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (peer.localDescription) await sendSignal({ toParticipantId: peerId, kind: "answer", payload: peer.localDescription.toJSON() });
      return;
    }

    if (peer.signalingState !== "have-local-offer") return;
    await peer.setRemoteDescription(signal.payload as RTCSessionDescriptionInit);
    await flushCandidates(peerId, peer);
  }, [closePeer, flushCandidates, peerFor, selfId, sendOffer, sendSignal]);

  useEffect(() => {
    if (!enabled) return;
    for (const signal of signals) {
      if (handledSignalsRef.current.has(signal.id)) continue;
      handledSignalsRef.current.add(signal.id);
      signalQueueRef.current = signalQueueRef.current
        .then(() => handleSignal(signal))
        .catch(() => retryPeer(signal.fromParticipantId));
    }
  }, [enabled, handleSignal, retryPeer, signals]);

  const announceVoice = useCallback(async (peerId: string) => {
    await sendSignal({ toParticipantId: peerId, kind: "ready", payload: null });
    if (isVoiceOfferInitiator(selfId, peerId)) await sendOffer(peerId);
  }, [selfId, sendOffer, sendSignal]);

  useEffect(() => {
    if (!enabled) return;
    const activeIds = new Set(players.map((player) => player.id));
    for (const peerId of peersRef.current.keys()) {
      if (!activeIds.has(peerId)) closePeer(peerId);
    }
    for (const player of players) {
      const key = `${selfId}:${player.id}`;
      if (announcedPeersRef.current.has(key)) continue;
      announcedPeersRef.current.add(key);
      void announceVoice(player.id).catch(() => retryPeer(player.id));
    }
  }, [announceVoice, closePeer, enabled, peerRetryVersion, players, retryPeer, selfId]);

  useEffect(() => {
    updateSpatialPeers();
  }, [players, updateSpatialPeers]);

  const start = useCallback(async () => {
    try {
      setError("");
      handledSignalsRef.current = new Set(signals.map((signal) => signal.id));
      streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      const AudioContextCtor = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) throw new Error("Seu navegador não oferece análise de áudio para o indicador de fala.");
      const context = new AudioContextCtor();
      await context.resume();
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
    } catch {
      stop();
      setError("Não foi possível acessar o microfone.");
    }
  }, [setSpeaking, signals, stop]);

  useEffect(() => stop, [stop]);
  return { enabled, isSpeaking, error, start, stop, setListenerPosition };
}
