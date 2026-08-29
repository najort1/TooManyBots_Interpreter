"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  CASAS_GRAPHICS_STORAGE_KEY,
  normalizeCasasGraphicsQuality,
  resolveCasasGraphicsPreset,
} from "@/lib/casasGraphicsQuality.js";
import { disposeStreetResourceRegistry } from "./streetResources";
import { disposeAvatarResourceRegistry } from "./avatar/resources";

export type CasasGraphicsQuality = "performance" | "balanced" | "high";
export type CasasGraphicsPreset = ReturnType<typeof resolveCasasGraphicsPreset>;

type CasasGraphicsContextValue = {
  quality: CasasGraphicsQuality;
  preset: CasasGraphicsPreset;
  setQuality: (quality: CasasGraphicsQuality) => void;
  acquireRenderer: (mount: HTMLElement) => THREE.WebGLRenderer;
  releaseRenderer: (mount: HTMLElement) => void;
};

const CasasGraphicsContext = createContext<CasasGraphicsContextValue | null>(null);

export function CasasGraphicsProvider({ children }: { children: React.ReactNode }) {
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const [quality, setQualityState] = useState<CasasGraphicsQuality>("balanced");

  useEffect(() => {
    try {
      setQualityState(normalizeCasasGraphicsQuality(localStorage.getItem(CASAS_GRAPHICS_STORAGE_KEY)) as CasasGraphicsQuality);
    } catch {
      setQualityState("balanced");
    }
  }, []);

  const setQuality = useCallback((next: CasasGraphicsQuality) => {
    const normalized = normalizeCasasGraphicsQuality(next) as CasasGraphicsQuality;
    setQualityState(normalized);
    try {
      localStorage.setItem(CASAS_GRAPHICS_STORAGE_KEY, normalized);
    } catch {
      // O perfil continua válido na sessão mesmo sem armazenamento local.
    }
  }, []);

  const acquireRenderer = useCallback((mount: HTMLElement) => {
    let instance = renderer.current;
    if (!instance) {
      instance = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
      instance.outputColorSpace = THREE.SRGBColorSpace;
      instance.shadowMap.enabled = true;
      instance.shadowMap.type = THREE.PCFShadowMap;
      renderer.current = instance;
    }
    instance.setAnimationLoop(null);
    if (instance.domElement.parentElement !== mount) mount.replaceChildren(instance.domElement);
    return instance;
  }, []);

  const releaseRenderer = useCallback((mount: HTMLElement) => {
    const instance = renderer.current;
    if (!instance) return;
    instance.setAnimationLoop(null);
    if (instance.domElement.parentElement === mount) instance.domElement.remove();
  }, []);

  useEffect(() => () => {
    const instance = renderer.current;
    renderer.current = null;
    if (instance) {
      instance.setAnimationLoop(null);
      instance.dispose();
      instance.forceContextLoss();
      instance.domElement.remove();
    }
    disposeStreetResourceRegistry();
    disposeAvatarResourceRegistry();
  }, []);

  const preset = useMemo(() => resolveCasasGraphicsPreset(quality, typeof devicePixelRatio === "number" ? devicePixelRatio : 1), [quality]);
  const value = useMemo(() => ({ quality, preset, setQuality, acquireRenderer, releaseRenderer }), [acquireRenderer, preset, quality, releaseRenderer, setQuality]);
  return <CasasGraphicsContext.Provider value={value}>{children}</CasasGraphicsContext.Provider>;
}

export function useCasasGraphics() {
  const value = useContext(CasasGraphicsContext);
  if (!value) throw new Error("useCasasGraphics fora de CasasGraphicsProvider");
  return value;
}
