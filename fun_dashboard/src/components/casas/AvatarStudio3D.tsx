"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { AvatarState } from "@/lib/types";
import { animateAvatar3D, createAvatar3D, disposeAvatar3D } from "./avatar3d";

type Props = {
  avatar: Pick<AvatarState, "slots">;
  label?: string;
};

export function AvatarStudio3D({ avatar, label = "VOCÊ" }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const avatarRef = useRef(avatar);
  avatarRef.current = avatar;

  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    mount.replaceChildren();
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x2a1c43);
    scene.fog = new THREE.Fog(0x2a1c43, 6, 13);
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 30);
    camera.position.set(3.15, 2.6, 5.7);
    camera.lookAt(0, 1.56, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%";
    renderer.domElement.setAttribute("aria-label", "Prévia 3D do avatar");
    mount.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xd8d5ff, 0x171020, 2.2));
    const key = new THREE.DirectionalLight(0xffe4c0, 3.2);
    key.position.set(4, 7, 5);
    key.castShadow = true;
    scene.add(key);
    const rim = new THREE.PointLight(0xc477ff, 5, 8);
    rim.position.set(-2.4, 3.5, -2.4);
    scene.add(rim);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.5, .22, 36), new THREE.MeshStandardMaterial({ color: 0x3b2a58, metalness: .28, roughness: .42 }));
    platform.position.y = -.11;
    platform.receiveShadow = true;
    scene.add(platform);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.02, .035, 8, 40), new THREE.MeshStandardMaterial({ color: 0xf6d365, emissive: 0xf6d365, emissiveIntensity: .7, roughness: .28 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = .02;
    scene.add(ring);
    const hideStudioNameTag = (nextRig: ReturnType<typeof createAvatar3D>) => {
      nextRig.model.traverse(object => {
        if (object instanceof THREE.Sprite) object.visible = false;
      });
    };
    let rig = createAvatar3D({ ...avatarRef.current, level: 1 }, label);
    hideStudioNameTag(rig);
    let renderedVisualKey = `${avatarRef.current.slots.body || "corpo_beco"}|${avatarRef.current.slots.hair_face || ""}|${avatarRef.current.slots.outfit || ""}|${avatarRef.current.slots.optional_accessory || ""}`;
    rig.root.position.y = .02;
    scene.add(rig.root);
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
    renderer.setAnimationLoop(() => {
      if (disposed) return;
      timer.update();
      const delta = Math.min(timer.getDelta(), .05);
      const elapsed = timer.getElapsed();
      const nextAvatar = avatarRef.current;
      const nextVisualKey = `${nextAvatar.slots.body || "corpo_beco"}|${nextAvatar.slots.hair_face || ""}|${nextAvatar.slots.outfit || ""}|${nextAvatar.slots.optional_accessory || ""}`;
      if (nextVisualKey !== renderedVisualKey) {
        rig.root.removeFromParent();
        disposeAvatar3D(rig);
        rig = createAvatar3D({ ...nextAvatar, level: 1 }, label);
        hideStudioNameTag(rig);
        rig.root.position.y = .02;
        scene.add(rig.root);
        renderedVisualKey = nextVisualKey;
      }
      rig.root.rotation.y = 0;
      animateAvatar3D(rig, elapsed, false, 0, reducedMotion, delta);
      ring.rotation.z += delta * .18;
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true;
      timer.disconnect();
      observer.disconnect();
      renderer.setAnimationLoop(null);
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

  return <div ref={host} className="avatar-studio-3d" data-testid="avatar-studio-3d" />;
}
