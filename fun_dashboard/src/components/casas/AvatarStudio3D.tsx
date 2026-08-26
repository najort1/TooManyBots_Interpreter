"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AvatarState } from "@/lib/types";
import { animateAvatar3D, createAvatar3D, disposeAvatar3D, updateAvatar3D } from "./avatar3d";
import { getAvatarVisualKey } from "./avatarAppearance.js";

type CameraView = "front" | "side" | "back";

type Props = {
  avatar: Pick<AvatarState, "slots">;
  label?: string;
  view?: CameraView;
  onStatusChange?: (status: "loading" | "ready" | "fallback" | "error") => void;
};

const VIEW_ANGLES: Record<CameraView, number> = { front: 0, side: Math.PI / 2, back: Math.PI };

export function AvatarStudio3D({ avatar, label = "VOCÊ", view = "front", onStatusChange }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const avatarRef = useRef(avatar);
  const viewRef = useRef(view);
  const statusRef = useRef(onStatusChange);
  avatarRef.current = avatar;
  viewRef.current = view;
  statusRef.current = onStatusChange;

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    mount.replaceChildren();
    mount.dataset.avatarStatus = "loading";
    statusRef.current?.("loading");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x231733);
    scene.fog = new THREE.Fog(0x231733, 8, 16);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
    camera.position.set(3.1, 2.8, 6.8);
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      // Keep the last frame only in local/dev previews so visual QA can inspect
      // the actual WebGL output. Production retains the faster default buffer.
      preserveDrawingBuffer: process.env.NODE_ENV === "development",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    renderer.domElement.setAttribute("aria-label", "Prévia 3D interativa do avatar");
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4.7;
    controls.maxDistance = 9;
    controls.minPolarAngle = Math.PI * 0.27;
    controls.maxPolarAngle = Math.PI * 0.58;
    controls.target.set(0, 2.05, 0);
    controls.update();

    scene.add(new THREE.HemisphereLight(0xd8d5ff, 0x171020, 2.35));
    const key = new THREE.DirectionalLight(0xffe4c0, 3.3);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight(0xc477ff, 5, 9);
    rim.position.set(-2.4, 3.5, -2.4);
    scene.add(rim);
    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(1.45, 1.58, 0.2, 36),
      new THREE.MeshStandardMaterial({ color: 0x382650, metalness: 0.25, roughness: 0.45 }),
    );
    platform.position.y = -0.1;
    platform.receiveShadow = true;
    scene.add(platform);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.08, 0.03, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0xf6d365, emissive: 0xf6d365, emissiveIntensity: 0.7, roughness: 0.28 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    scene.add(ring);

    const hideNameTag = (nextRig: ReturnType<typeof createAvatar3D>) => {
      nextRig.label.visible = false;
    };
    let rig = createAvatar3D({ ...avatarRef.current, level: 1 }, label);
    hideNameTag(rig);
    let renderedVisualKey = getAvatarVisualKey(avatarRef.current);
    rig.root.position.y = 0.02;
    scene.add(rig.root);
    mount.dataset.avatarStatus = "ready";
    statusRef.current?.("ready");

    const timer = new THREE.Timer();
    timer.connect(document);
    const resize = () => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();
    let disposed = false;
    let currentView = viewRef.current;

    renderer.setAnimationLoop(() => {
      if (disposed) return;
      timer.update();
      const delta = Math.min(timer.getDelta(), 0.05);
      const elapsed = timer.getElapsed();
      const nextAvatar = avatarRef.current;
      const nextVisualKey = getAvatarVisualKey(nextAvatar);
      if (nextVisualKey !== renderedVisualKey) {
        const previous = rig;
        rig = updateAvatar3D(previous, { ...nextAvatar, level: 1 }, label);
        if (rig !== previous) {
          hideNameTag(rig);
          scene.add(rig.root);
          previous.root.removeFromParent();
          disposeAvatar3D(previous);
        }
        renderedVisualKey = nextVisualKey;
      }
      if (viewRef.current !== currentView) currentView = viewRef.current;
      const targetRotation = VIEW_ANGLES[currentView];
      rig.root.rotation.y = reducedMotion
        ? targetRotation
        : THREE.MathUtils.damp(rig.root.rotation.y, targetRotation, 10, delta);
      animateAvatar3D(rig, elapsed, false, 0, reducedMotion, delta);
      if (!reducedMotion) ring.rotation.z += delta * 0.12;
      controls.update();
      renderer.render(scene, camera);
    });

    return () => {
      disposed = true;
      timer.disconnect();
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      disposeAvatar3D(rig);
      platform.geometry.dispose();
      (platform.material as THREE.Material).dispose();
      ring.geometry.dispose();
      (ring.material as THREE.Material).dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [label]);

  return <div ref={host} className="avatar-studio-3d" data-testid="avatar-studio-3d" data-avatar-status="loading" />;
}
