"use client";

import { useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { CarState } from "@/lib/types";
import { createCar3D, type Car3DRig } from "./car3d";

export type CameraPreset = "iso" | "front" | "side" | "rear" | "interior" | "top";

export type CarStudioHandle = {
  triggerRev: () => void;
  captureScreenshot: () => string | null;
};

type Props = {
  carState: CarState;
  cameraPreset?: CameraPreset;
  turntable?: boolean;
  doorsOpen?: boolean;
  headlightsOn?: boolean;
  onStatusChange?: (status: "loading" | "ready" | "error") => void;
};

const CAMERA_ANGLES: Record<CameraPreset, { pos: [number, number, number]; target: [number, number, number] }> = {
  iso: { pos: [4.4, 2.4, 5.2], target: [0, 0.7, 0] },
  front: { pos: [0.05, 1.25, 5.8], target: [0, 0.7, 0] },
  side: { pos: [6.4, 1.15, 0.0], target: [0, 0.7, 0] },
  rear: { pos: [-0.05, 1.45, -5.8], target: [0, 0.7, 0] },
  interior: { pos: [-0.36, 1.15, 0.0], target: [0, 0.9, 1.5] },
  top: { pos: [0.05, 7.8, 0.2], target: [0, 0.5, 0] },
};

export const CarStudio3D = forwardRef<CarStudioHandle, Props>(function CarStudio3D(
  { carState, cameraPreset = "iso", turntable = false, doorsOpen = false, headlightsOn = true, onStatusChange },
  ref
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<Car3DRig | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const turntableRef = useRef(turntable);
  turntableRef.current = turntable;

  useImperativeHandle(ref, () => ({
    triggerRev: () => {
      if (rigRef.current) {
        rigRef.current.triggerBackfire();
      }
    },
    captureScreenshot: () => {
      if (rendererRef.current) {
        return rendererRef.current.domElement.toDataURL("image/png");
      }
      return null;
    },
  }));

  // Efeito principal de inicialização Three.js
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    mount.replaceChildren();
    onStatusChange?.("loading");

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0a16);
    scene.fog = new THREE.Fog(0x0c0a16, 10, 30);

    const camera = new THREE.PerspectiveCamera(
      38,
      mount.clientWidth / (mount.clientHeight || 1),
      0.1,
      60
    );
    cameraRef.current = camera;
    const initialPreset = CAMERA_ANGLES[cameraPreset] || CAMERA_ANGLES.iso;
    camera.position.set(...initialPreset.pos);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    rendererRef.current = renderer;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controlsRef.current = controls;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.2;
    controls.maxDistance = 14;
    controls.minPolarAngle = Math.PI * 0.1;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(...initialPreset.target);
    controls.update();

    // ================= ILUMINAÇÃO DE ESTÚDIO AUTOMOTIVO =================
    const ambientLight = new THREE.AmbientLight(0xd4d8f0, 1.25);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfffaee, 3.4);
    keyLight.position.set(6.5, 8.5, 7.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xa5c4f5, 2.0);
    fillLight.position.set(-7, 6.5, -5.5);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xff2266, 3.8, 14);
    rimLight.position.set(-3.5, 3.8, -4.5);
    scene.add(rimLight);

    const rimFront = new THREE.PointLight(0x00f0ff, 2.2, 10);
    rimFront.position.set(4, 2.5, 5);
    scene.add(rimFront);

    // Painéis de Luz Softbox de Teto
    const softboxGeom = new THREE.PlaneGeometry(3.5, 6.5);
    const softboxMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const ceilingSoftbox = new THREE.Mesh(softboxGeom, softboxMat);
    ceilingSoftbox.position.set(0, 5.5, 0);
    ceilingSoftbox.rotation.x = Math.PI * 0.5;
    scene.add(ceilingSoftbox);

    // ================= PISO DA GARAGEM SHOWROOM =================
    const floorGeom = new THREE.CylinderGeometry(5.6, 6.0, 0.2, 48);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x141120,
      roughness: 0.28,
      metalness: 0.65,
    });
    const floorMesh = new THREE.Mesh(floorGeom, floorMat);
    floorMesh.position.set(0, -0.1, 0);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const ringGeom = new THREE.TorusGeometry(5.5, 0.045, 8, 48);
    ringGeom.rotateX(Math.PI * 0.5);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x8b5cf6 });
    const ringMesh = new THREE.Mesh(ringGeom, ringMat);
    ringMesh.position.set(0, 0.02, 0);
    scene.add(ringMesh);

    const grid = new THREE.PolarGridHelper(5.2, 12, 8, 32, 0x4c3577, 0x22163c);
    grid.position.set(0, 0.02, 0);
    scene.add(grid);

    // Adicionar Carro 3D
    const rig = createCar3D(carState);
    rigRef.current = rig;
    scene.add(rig.root);

    onStatusChange?.("ready");

    let frameId: number;
    const animate = () => {
      frameId = requestAnimationFrame(animate);

      if (turntableRef.current) {
        rig.root.rotation.y += 0.007;
      }

      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mount) return;
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      camera.aspect = w / (h || 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(mount);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
      controls.dispose();
      rig.dispose();
      renderer.dispose();
      mount.replaceChildren();
    };
  }, []);

  useEffect(() => {
    if (rigRef.current) {
      rigRef.current.update(carState);
    }
  }, [carState]);

  useEffect(() => {
    if (rigRef.current) {
      rigRef.current.setDoorsOpen(doorsOpen);
    }
  }, [doorsOpen]);

  useEffect(() => {
    if (rigRef.current) {
      rigRef.current.setHeadlightsOn(headlightsOn);
    }
  }, [headlightsOn]);

  useEffect(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const preset = CAMERA_ANGLES[cameraPreset] || CAMERA_ANGLES.iso;
    camera.position.set(...preset.pos);
    controls.target.set(...preset.target);
    controls.update();
  }, [cameraPreset]);

  return (
    <div
      ref={mountRef}
      className="relative w-full h-full min-h-[440px] rounded-2xl overflow-hidden shadow-2xl border border-purple-900/30 bg-[#0c0a16]"
    />
  );
});
