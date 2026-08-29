import type * as THREE from "three";
import { summarizeFrameDurations } from "./casasPerformance.js";

type PerformanceSnapshot = ReturnType<typeof summarizeFrameDurations> & {
  label: string;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  longTasks: number;
  savedDrawCalls: number;
  recordedAt: number;
};

declare global {
  interface Window {
    __CASAS_PERFORMANCE__?: Record<string, PerformanceSnapshot>;
  }
}

export function createThreePerformanceMonitor(label: string, renderer: THREE.WebGLRenderer, savedDrawCalls = 0) {
  const previewBenchmark = typeof window !== "undefined"
    && window.location.pathname === "/casas/preview"
    && new URLSearchParams(window.location.search).get("metrics") === "1";
  if (process.env.NODE_ENV !== "development" && !previewBenchmark) {
    return { beginFrame: () => undefined, frame: () => undefined, dispose: () => undefined };
  }
  const frameDurations: number[] = [];
  let previousFrameAt = performance.now();
  let lastCommitAt = previousFrameAt;
  let longTasks = 0;
  let observer: PerformanceObserver | null = null;
  renderer.info.autoReset = false;

  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    observer = new PerformanceObserver((entries) => { longTasks += entries.getEntries().length; });
    observer.observe({ entryTypes: ["longtask"] });
  }

  const commit = (now: number) => {
    const summary = summarizeFrameDurations(frameDurations);
    const snapshot: PerformanceSnapshot = {
      label,
      ...summary,
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      longTasks,
      savedDrawCalls,
      recordedAt: Date.now(),
    };
    window.__CASAS_PERFORMANCE__ = { ...(window.__CASAS_PERFORMANCE__ || {}), [label]: snapshot };
    renderer.domElement.dataset.casasPerformance = JSON.stringify(snapshot);
    if (frameDurations.length > 600) frameDurations.splice(0, frameDurations.length - 600);
    lastCommitAt = now;
  };

  return {
    beginFrame() {
      renderer.info.reset();
    },
    frame() {
      const now = performance.now();
      frameDurations.push(Math.min(250, now - previousFrameAt));
      previousFrameAt = now;
      if (now - lastCommitAt >= 1000) commit(now);
    },
    dispose() {
      observer?.disconnect();
      observer = null;
      commit(performance.now());
      renderer.info.autoReset = true;
      renderer.info.reset();
    },
  };
}
